import * as vscode from 'vscode';

export interface PiConfig {
    api: { baseUrl: string; apiKey: string; model: string; chatModel: string; completionModel: string };
    agent: { maxTokens: number; temperature: number; systemPrompt: string };
    inlineSuggestions: { enabled: boolean; debounceMs: number };
    subagents: { maxConcurrency: number; agentsDir: string };
    tools: { enableBashGuard: boolean; enableGit: boolean };
}

export function getConfig(): PiConfig {
    const c = vscode.workspace.getConfiguration('pi-agent');
    return {
        api: {
            baseUrl: c.get<string>('api.baseUrl', 'http://localhost:8080/v1'),
            apiKey: c.get<string>('api.apiKey', ''),
            model: c.get<string>('api.model', 'versatile'),
            chatModel: c.get<string>('api.chatModel', ''),
            completionModel: c.get<string>('api.completionModel', ''),
        },
        agent: {
            maxTokens: c.get<number>('agent.maxTokens', 16384),
            temperature: c.get<number>('agent.temperature', 0.7),
            systemPrompt: c.get<string>('agent.systemPrompt', ''),
        },
        inlineSuggestions: {
            enabled: c.get<boolean>('inlineSuggestions.enabled', false),
            debounceMs: c.get<number>('inlineSuggestions.debounceMs', 500),
        },
        subagents: {
            maxConcurrency: c.get<number>('subagents.maxConcurrency', 4),
            agentsDir: c.get<string>('subagents.agentsDir', ''),
        },
        tools: {
            enableBashGuard: c.get<boolean>('tools.enableBashGuard', true),
            enableGit: c.get<boolean>('tools.enableGit', true),
        },
    };
}

export function getChatModel(): string { const c = getConfig(); return c.api.chatModel || c.api.model; }
export function getCompletionModel(): string { const c = getConfig(); return c.api.completionModel || c.api.model; }

export function onConfigChange(listener: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('pi-agent')) listener(); });
}
