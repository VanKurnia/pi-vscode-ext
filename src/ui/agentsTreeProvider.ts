import * as vscode from 'vscode';
import type { AgentHarness } from '@earendil-works/pi-agent-core';

interface SkillItem {
    name: string;
    description?: string;
}

export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentTreeItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private harness: AgentHarness;
    private disposable?: () => void;

    constructor(harness: AgentHarness) {
        this.harness = harness;
        // Refresh tree when resources change
        this.disposable = harness.on('resources_update', () => {
            this._onDidChangeTreeData.fire();
            return undefined;
        });
    }

    refresh(): void { this._onDidChangeTreeData.fire(); }

    getTreeItem(element: AgentTreeItem): vscode.TreeItem { return element; }

    getChildren(element?: AgentTreeItem): Thenable<AgentTreeItem[]> {
        if (!element) {
            const resources = this.harness.getResources();
            const items: AgentTreeItem[] = [];
            const skills = (resources.skills ?? []) as SkillItem[];
            for (const s of skills) {
                items.push(new AgentTreeItem(s.name, s.description || '', 'skill'));
            }
            return Promise.resolve(items);
        }
        return Promise.resolve([]);
    }

    dispose(): void {
        this.disposable?.();
        this._onDidChangeTreeData.dispose();
    }
}

class AgentTreeItem extends vscode.TreeItem {
    constructor(name: string, description: string, kind: string) {
        super(name, vscode.TreeItemCollapsibleState.None);
        this.description = description.slice(0, 50);
        this.tooltip = name + ': ' + description;
        this.contextValue = kind;
        this.iconPath = new vscode.ThemeIcon(kind === 'skill' ? 'star' : 'hubot');
    }
}
