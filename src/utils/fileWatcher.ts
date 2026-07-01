import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './logger';

export type WatcherEventType = 'agent-config' | 'skill' | 'extension-config';

export interface FileWatcherEvent {
    type: WatcherEventType;
    filePath: string;
    changeType: 'created' | 'changed' | 'deleted';
}

export interface ReloadHandler {
    reloadAgents(): void;
    reloadSkills(): void;
    reloadConfig(): void;
}

/**
 * File watcher for agent/config hot reload.
 * Watches agent, skill, and config directories and emits debounced events
 * when files change, enabling live reload of agent configurations.
 */
export class FileWatcher implements vscode.Disposable {
    private watchers: vscode.FileSystemWatcher[] = [];
    private disposables: vscode.Disposable[] = [];
    private logger: Logger;
    private debounceTimers = new Map<string, NodeJS.Timeout>();
    private debounceMs: number;
    private _onDidChange = new vscode.EventEmitter<FileWatcherEvent>();
    private reloadHandler?: ReloadHandler;

    public readonly onDidChange = this._onDidChange.event;

    constructor(debounceMs: number = 300) {
        this.logger = Logger.getInstance();
        this.debounceMs = debounceMs;
    }

    /**
     * Set a reload handler that will be called when watched files change.
     * Integrates with SkillDiscovery and AgentDiscovery reload methods.
     */
    setReloadHandler(handler: ReloadHandler): void {
        this.reloadHandler = handler;
    }

    /**
     * Start watching all configured patterns.
     * Should be called during extension activation.
     */
    start(): void {
        this.watchAgentConfigs();
        this.watchSkills();
        this.watchExtensionConfig();
        this.logger.info('FileWatcher started — watching agent, skill, and config directories');
    }

    private watchAgentConfigs(): void {
        // Watch **/*.md in agents directories (user and project level)
        const pattern = '**/*.md';
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.watchers.push(watcher);

        const handler = (uri: vscode.Uri, changeType: 'created' | 'changed' | 'deleted') => {
            const filePath = uri.fsPath;
            // Only trigger for files in agents directories
            if (!filePath.includes(path.join('agents', path.sep)) &&
                !filePath.includes(path.join('.pi', 'agent', 'agents', path.sep))) {
                return;
            }
            this.debouncedEmit('agent-config', filePath, changeType);
        };

        watcher.onDidCreate(uri => handler(uri, 'created'));
        watcher.onDidChange(uri => handler(uri, 'changed'));
        watcher.onDidDelete(uri => handler(uri, 'deleted'));
        this.disposables.push(watcher);
    }

    private watchSkills(): void {
        // Watch **/*.md in skills directories
        const pattern = '**/*.md';
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.watchers.push(watcher);

        const handler = (uri: vscode.Uri, changeType: 'created' | 'changed' | 'deleted') => {
            const filePath = uri.fsPath;
            // Only trigger for files in skills directories
            if (!filePath.includes(path.join('skills', path.sep)) &&
                !filePath.includes(path.join('.pi', 'agent', 'skills', path.sep))) {
                return;
            }
            this.debouncedEmit('skill', filePath, changeType);
        };

        watcher.onDidCreate(uri => handler(uri, 'created'));
        watcher.onDidChange(uri => handler(uri, 'changed'));
        watcher.onDidDelete(uri => handler(uri, 'deleted'));
        this.disposables.push(watcher);
    }

    private watchExtensionConfig(): void {
        // Watch .pi-agent/config.* files
        const watcher = vscode.workspace.createFileSystemWatcher('**/.pi-agent/config.*');
        this.watchers.push(watcher);

        const handler = (uri: vscode.Uri, changeType: 'created' | 'changed' | 'deleted') => {
            this.debouncedEmit('extension-config', uri.fsPath, changeType);
        };

        watcher.onDidCreate(uri => handler(uri, 'created'));
        watcher.onDidChange(uri => handler(uri, 'changed'));
        watcher.onDidDelete(uri => handler(uri, 'deleted'));
        this.disposables.push(watcher);
    }

    private debouncedEmit(type: WatcherEventType, filePath: string, changeType: 'created' | 'changed' | 'deleted'): void {
        const key = `${type}:${filePath}`;

        // Clear existing timer for this file
        const existing = this.debounceTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }

        // Set new debounced timer
        this.debounceTimers.set(key, setTimeout(() => {
            this.debounceTimers.delete(key);

            const event: FileWatcherEvent = { type, filePath, changeType };
            this.logger.info(`[FileWatcher] ${type} ${changeType}: ${path.basename(filePath)}`);
            this._onDidChange.fire(event);

            // Trigger appropriate reload
            if (this.reloadHandler) {
                try {
                    switch (type) {
                        case 'agent-config':
                            this.reloadHandler.reloadAgents();
                            break;
                        case 'skill':
                            this.reloadHandler.reloadSkills();
                            break;
                        case 'extension-config':
                            this.reloadHandler.reloadConfig();
                            break;
                    }
                } catch (err: any) {
                    this.logger.error(`[FileWatcher] Reload failed for ${type}`, err);
                }
            }
        }, this.debounceMs));
    }

    /**
     * Get a summary of currently watched patterns.
     */
    getWatchedPatterns(): string[] {
        return [
            '**/*.md (agents directories) → reload agent configs',
            '**/*.md (skills directories) → reload skills',
            '**/.pi-agent/config.* → reload extension config',
        ];
    }

    dispose(): void {
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();

        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
        this.watchers = [];

        this._onDidChange.dispose();
        this.logger.info('[FileWatcher] Disposed');
    }
}
