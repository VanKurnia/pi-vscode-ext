import * as vscode from 'vscode';
// PiAgentManager replaced by bridge — using any for now
import { getConfig } from '../utils/config.js';
import type { AgentHarness, AgentHarnessEvent } from '@earendil-works/pi-agent-core';

export class StatusBarManager {
    private statusItem: vscode.StatusBarItem;
    private modelItem: vscode.StatusBarItem;
    private speedItem: vscode.StatusBarItem;
    private gitItem: vscode.StatusBarItem;       // pi-zentui: git branch + status
    private contextItem: vscode.StatusBarItem;    // pi-zentui: context usage
    private harness: AgentHarness;

    // Speed tracking state (pi-speeed equivalent)
    private streamStartTime: number = 0;
    private streamCharCount: number = 0;
    private speedUpdateTimer: ReturnType<typeof setInterval> | undefined;
    private sessionTotalChars: number = 0;
    private sessionTotalTime: number = 0;
    private sessionStreamCount: number = 0;

    // Git tracking (pi-zentui equivalent)
    private gitRefreshTimer: ReturnType<typeof setInterval> | undefined;
    private hideSpeedTimer: ReturnType<typeof setTimeout> | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor(harness: AgentHarness) {
        this.harness = harness;

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

        // Git — right, priority 100 (pi-zentui: branch + status)
        this.gitItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.gitItem.text = '$(git-branch)';
        this.gitItem.tooltip = 'Git branch';
        this.gitItem.show();
        this.refreshGit();

        // Context usage — right, priority 99 (pi-zentui: token count)
        this.contextItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.contextItem.text = '';
        this.contextItem.tooltip = 'Session context usage';
        this.refreshContext();

        // Listen for events
        this.harness.subscribe((event: AgentHarnessEvent) => {
            // Map harness events to status bar updates
            if (event.type === 'before_agent_start') {
                this.refreshStatus('thinking');
            }
            if (event.type === 'settled' || event.type === 'abort') {
                this.refreshStatus('idle');
                this.cleanupSpeedAfterAbort();
            }
            if (event.type === 'before_provider_request') {
                this.onStreamStart();
            }
            if (event.type === 'after_provider_response') {
                this.onStreamEnd();
            }
            if (event.type === 'context' || event.type === 'session_compact') {
                this.refreshContext();
            }
        });

        // Refresh git on file changes (debounced to 2s) — tracked for disposal
        let gitRefreshTimeout: ReturnType<typeof setTimeout> | undefined;
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(() => {
                if (gitRefreshTimeout) clearTimeout(gitRefreshTimeout);
                gitRefreshTimeout = setTimeout(() => this.refreshGit(), 2000);
            }),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('pi-agent')) { this.refreshModel(); }
            })
        );

        // Periodic git refresh every 30s
        this.gitRefreshTimer = setInterval(() => this.refreshGit(), 30000);
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

    // ── Git status (pi-zentui equivalent) ──────────────────────────────

    private async refreshGit(): Promise<void> {
        try {
            const gitExt = vscode.extensions.getExtension<{ repositories: Array<{ state: { HEAD?: { name?: string; commit?: string }; workingTreeChanges: number; indexChanges: number; mergeChanges: number; untrackedChanges: number } }> }>('vscode.git');
            if (!gitExt) { this.gitItem.text = '$(git-branch) no git'; return; }

            if (!gitExt.isActive) { await gitExt.activate(); }
            const api = gitExt.exports;
            const repo = api.repositories[0];
            if (!repo) { this.gitItem.text = '$(git-branch) no repo'; return; }

            const head = repo.state.HEAD;
            const branch = head?.name || head?.commit?.slice(0, 7) || 'detached';

            // Git status indicators (pi-zentui style: !?↑+✘»=$=)
            const indicators: string[] = [];
            const state = repo.state;
            if (state.indexChanges > 0) indicators.push('+'.repeat(Math.min(state.indexChanges, 3)));      // staged
            if (state.workingTreeChanges > 0) indicators.push('!'.repeat(Math.min(state.workingTreeChanges, 3))); // modified
            if (state.untrackedChanges > 0) indicators.push('?');                                             // untracked
            if (state.mergeChanges > 0) indicators.push('=');                                                 // conflicts

            const indicatorStr = indicators.length > 0 ? ' [' + indicators.join('') + ']' : '';
            this.gitItem.text = '$(git-branch) ' + branch + indicatorStr;
            this.gitItem.tooltip = 'Branch: ' + branch
                + (state.indexChanges > 0 ? '\nStaged: ' + state.indexChanges : '')
                + (state.workingTreeChanges > 0 ? '\nModified: ' + state.workingTreeChanges : '')
                + (state.untrackedChanges > 0 ? '\nUntracked: ' + state.untrackedChanges : '')
                + (state.mergeChanges > 0 ? '\nConflicts: ' + state.mergeChanges : '');
        } catch {
            this.gitItem.text = '$(git-branch) git';
        }
    }

    // ── Context usage (pi-zentui equivalent) ───────────────────────────

    private refreshContext(): void {
        try {
            const model = this.harness.getModel();
            const resources = this.harness.getResources();
            const skillCount = (resources.skills ?? []).length;
            const modelName = (model as any)?.name || (model as any)?.id || 'unknown';
            this.contextItem.text = `$(database) ${skillCount} skills`;
            this.contextItem.tooltip = `Model: ${modelName}\nSkills: ${skillCount}`;
            this.contextItem.backgroundColor = undefined;
            this.contextItem.show();
        } catch {
            // ignore
        }
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

            // Hide after 5 seconds, then refresh context
            this.hideSpeedTimer = setTimeout(() => {
                this.hideSpeedTimer = undefined;
                this.speedItem.hide();
                this.refreshContext();
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

    /** Clean up speed timer when stream is aborted (streamEnd never fires) */
    private cleanupSpeedAfterAbort(): void {
        if (this.speedUpdateTimer) {
            this.clearSpeedTimer();
            this.speedItem.hide();
            this.streamStartTime = 0;
            this.refreshContext();
        }
    }

    dispose(): void {
        this.clearSpeedTimer();
        if (this.hideSpeedTimer) { clearTimeout(this.hideSpeedTimer); this.hideSpeedTimer = undefined; }
        if (this.gitRefreshTimer) { clearInterval(this.gitRefreshTimer); }
        for (const d of this.disposables) { d.dispose(); }
        this.disposables = [];
        this.statusItem.dispose();
        this.modelItem.dispose();
        this.speedItem.dispose();
        this.gitItem.dispose();
        this.contextItem.dispose();
    }
}
