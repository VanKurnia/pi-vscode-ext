import * as vscode from 'vscode';
import { AgentConfig } from '../agent/agents.js';

export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentTreeItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private manager: any;

    constructor(manager: any) { this.manager = manager; }

    refresh(): void { this.manager.refreshAgents(); this._onDidChangeTreeData.fire(); }

    getTreeItem(element: AgentTreeItem): vscode.TreeItem { return element; }

    getChildren(element?: AgentTreeItem): Thenable<AgentTreeItem[]> {
        if (!element) {
            const agents: AgentConfig[] = this.manager.getAgents();
            return Promise.resolve(agents.map((a: AgentConfig) => new AgentTreeItem(a)));
        }
        return Promise.resolve([]);
    }

    dispose(): void { this._onDidChangeTreeData.dispose(); }
}

class AgentTreeItem extends vscode.TreeItem {
    constructor(agent: AgentConfig) {
        super(agent.name, vscode.TreeItemCollapsibleState.None);
        this.description = agent.description.slice(0, 50);
        this.tooltip = agent.name + ': ' + agent.description + '\nModel: ' + (agent.model || 'default') + '\nTools: ' + (agent.tools.join(', ') || 'all');
        this.contextValue = 'agent';
        this.iconPath = new vscode.ThemeIcon('hubot');
        this.command = { command: 'pi-agent.openChat', title: 'Chat with Agent' };
    }
}
