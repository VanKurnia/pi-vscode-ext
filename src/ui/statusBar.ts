import * as vscode from 'vscode';
import { PiAgentManager } from '../agent/manager';
import { getConfig } from '../utils/config';

export class StatusBarManager {
    private statusItem: vscode.StatusBarItem;
    private modelItem: vscode.StatusBarItem;
    private speedItem: vscode.StatusBarItem;
    private manager: PiAgentManager;

    // Speed tracking state (pi-speeed equivalent)
    private streamStartTime: number = 0;
    private streamCharCount: number = 0;
    private speedUpdateTimer: ReturnType<typeof setInterval> | undefined;
    private sessionTotalChars: number = 0;
    private sessionTotalTime: number = 0;
    private sessionStreamCount: number = 0;

    constructor(manager: PiAgentManager) {
        this.manager = manager;

        // Main status — left, priority 100
        this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusItem.command = 'pi-agent.openChat';
        this.statusItem.text = '$(hubot) Pi Agent';
        this.statusItem.tooltip = 'Pi Agent — Click to open chat';
        this.statusItem.show();

        // Model — left, priority 99
        this.modelItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        this.modelItem.command = 'pi-agent.toggleInlineSuggestions';
        this.refreshModel();
        this.modelItem.show();

        // Speed — left, priority 98 (pi-speeed equivalent)
        this.speedItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
        this.speedItem.text = '';
        this.speedItem.tooltip = 'Token speed';
        // Don't show until streaming starts

        // Listen for events
        this.manager.on('event', (event: any) => {
            if (event.type === 'status') { this.refreshStatus(event.data.status); }
            if (event.type === 'streamStart') { this.onStreamStart(); }
            if (event.type === 'streamChunk') { this.onStreamChunk(event.data.content); }
            if (event.type === 'streamEnd') { this.onStreamEnd(); }
        });

        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('pi-agent')) { this.refreshModel(); }
        });
    }

    refreshStatus(status: string): void {
        switch (status) {
            case 'thinking':
                this.statusItem.text = '$(loading~spin) Pi Agent';
                this.statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case 'error':
                this.statusItem.text = '$(error) Pi Agent';
                this.statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            default:
                this.statusItem.text = '$(hubot) Pi Agent';
                this.statusItem.backgroundColor = undefined;
        }
    }

    refreshModel(): void {
        const config = getConfig();
        const enabled = config.inlineSuggestions.enabled;
        this.modelItem.text = '$(server) ' + config.api.model + (enabled ? ' $(lightbulb)' : '');
        this.modelItem.tooltip = 'Model: ' + config.api.model + ' | Inline: ' + (enabled ? 'ON' : 'OFF') + ' (click to toggle)';
    }

    // ── Speed tracking (pi-speeed equivalent) ──────────────────────────

    private onStreamStart(): void {
        this.streamStartTime = Date.now();
        this.streamCharCount = 0;
        this.speedItem.text = '$(zap) 0 tok/s';
        this.speedItem.tooltip = 'Streaming...';
        this.speedItem.show();

        // Update speed display every 500ms
        this.clearSpeedTimer();
        this.speedUpdateTimer = setInterval(() => this.updateSpeedDisplay(), 500);
    }

    private onStreamChunk(content: string): void {
        if (content) {
            this.streamCharCount += content.length;
        }
    }

    private onStreamEnd(): void {
        this.clearSpeedTimer();

        const elapsed = (Date.now() - this.streamStartTime) / 1000;
        if (elapsed > 0 && this.streamCharCount > 0) {
            const tokens = Math.ceil(this.streamCharCount / 4); // ~4 chars per token
            const tokPerSec = tokens / elapsed;
            this.sessionTotalChars += this.streamCharCount;
            this.sessionTotalTime += elapsed;
            this.sessionStreamCount++;

            // Show final speed, then fade after 5s
            this.speedItem.text = `$(zap) ${tokPerSec.toFixed(1)} tok/s`;
            const avgTokPerSec = Math.ceil(this.sessionTotalChars / 4) / this.sessionTotalTime;
            this.speedItem.tooltip = [
                `This stream: ${tokPerSec.toFixed(1)} tok/s (${tokens} tokens in ${elapsed.toFixed(1)}s)`,
                `Session avg: ${avgTokPerSec.toFixed(1)} tok/s (${this.sessionStreamCount} streams)`,
            ].join('\n');

            // Hide after 5 seconds
            setTimeout(() => {
                this.speedItem.hide();
            }, 5000);
        } else {
            this.speedItem.hide();
        }
    }

    private updateSpeedDisplay(): void {
        if (this.streamStartTime === 0) return;
        const elapsed = (Date.now() - this.streamStartTime) / 1000;
        if (elapsed <= 0) return;

        const tokens = Math.ceil(this.streamCharCount / 4);
        const tokPerSec = tokens / elapsed;
        this.speedItem.text = `$(zap) ${tokPerSec.toFixed(1)} tok/s`;
    }

    private clearSpeedTimer(): void {
        if (this.speedUpdateTimer) {
            clearInterval(this.speedUpdateTimer);
            this.speedUpdateTimer = undefined;
        }
    }

    dispose(): void {
        this.clearSpeedTimer();
        this.statusItem.dispose();
        this.modelItem.dispose();
        this.speedItem.dispose();
    }
}
