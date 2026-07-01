import * as vscode from 'vscode';

interface TrackedChange {
    filePath: string;
    added: number;
    removed: number;
    timestamp: number;
}

export class ChangesTreeProvider implements vscode.TreeDataProvider<ChangeTreeItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<ChangeTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private changes: Map<string, TrackedChange> = new Map();
    private refreshTimer: ReturnType<typeof setTimeout> | undefined;

    refresh(): void { this._onDidChangeTreeData.fire(); }

    trackChange(filePath: string, added: number, removed: number): void {
        const existing = this.changes.get(filePath);
        if (existing) { existing.added += added; existing.removed += removed; existing.timestamp = Date.now(); }
        else { this.changes.set(filePath, { filePath, added, removed, timestamp: Date.now() }); }
        // Debounce refreshes to avoid excessive tree view redraws on every keystroke
        if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
        this.refreshTimer = setTimeout(() => { this.refresh(); }, 500);
    }

    clear(): void { this.changes.clear(); if (this.refreshTimer) { clearTimeout(this.refreshTimer); } this.refresh(); }

    getTrackedChanges(): TrackedChange[] {
        return Array.from(this.changes.values()).sort((a, b) => b.timestamp - a.timestamp);
    }

    getTreeItem(element: ChangeTreeItem): vscode.TreeItem { return element; }

    getChildren(element?: ChangeTreeItem): Thenable<ChangeTreeItem[]> {
        if (!element) {
            const changes = this.getTrackedChanges();
            if (changes.length === 0) { return Promise.resolve([new ChangeTreeItem('No tracked changes', '', 0, 0)]); }
            return Promise.resolve(changes.map(c => new ChangeTreeItem(c.filePath, c.filePath, c.added, c.removed)));
        }
        return Promise.resolve([]);
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
        if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
    }
}

class ChangeTreeItem extends vscode.TreeItem {
    constructor(label: string, filePath: string, added: number, removed: number) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = added > 0 || removed > 0 ? '+' + added + '/-' + removed : '';
        this.contextValue = 'change';
        this.iconPath = added > 0
            ? new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('testing.iconPassed'))
            : new vscode.ThemeIcon('diff-modified');
        if (filePath) {
            this.resourceUri = vscode.Uri.file(filePath);
            this.command = { command: 'vscode.open', title: 'Open File', arguments: [vscode.Uri.file(filePath)] };
        }
    }
}
