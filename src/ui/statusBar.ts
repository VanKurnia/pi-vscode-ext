import * as vscode from 'vscode';
import { PiAgentManager } from '../agent/manager';
import { getConfig } from '../utils/config';

export class StatusBarManager {
    private statusItem: vscode.StatusBarItem;
    private modelItem: vscode.StatusBarItem;
    private manager: PiAgentManager;

    constructor(manager: PiAgentManager) {
        this.manager = manager;

        this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusItem.command = 'pi-agent.openChat';
        this.statusItem.text = '$(hubot) Pi Agent';
        this.statusItem.tooltip = 'Pi Agent - Click to open chat';
        this.statusItem.show();

        this.modelItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        this.modelItem.command = 'pi-agent.toggleInlineSuggestions';
        this.refreshModel();
        this.modelItem.show();

        this.manager.on('event', (event: any) => {
            if (event.type === 'status') { this.refreshStatus(event.data.status); }
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

    dispose(): void {
        this.statusItem.dispose();
        this.modelItem.dispose();
    }
}
