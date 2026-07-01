import * as vscode from 'vscode';
import { PiAgentManager } from './agent/manager';
import { LlmClient } from './agent/client';
import { ChatViewProvider } from './ui/chatViewProvider';
import { StatusBarManager } from './ui/statusBar';
import { InlineCompletionProvider } from './ui/inlineCompletion';
import { AgentsTreeProvider } from './ui/agentsTreeProvider';
import { ChangesTreeProvider } from './ui/changesTreeProvider';
import { Logger } from './utils/logger';
import { getConfig, onConfigChange } from './utils/config';
import { buildContextString } from './utils/context';

let manager: PiAgentManager;
let statusBar: StatusBarManager;
let logger: Logger;
let inlineCompletionProvider: InlineCompletionProvider;
let inlineCompletionDisposable: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext) {
    logger = Logger.getInstance();
    logger.info('Pi Agent extension activating...');

    // Create the main manager
    manager = new PiAgentManager();

    // Register chat view provider
    const chatProvider = new ChatViewProvider(context.extensionUri, manager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider)
    );

    // Register tree views
    const agentsProvider = new AgentsTreeProvider(manager);
    const changesProvider = new ChangesTreeProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('pi-agent.agentsView', agentsProvider),
        vscode.window.registerTreeDataProvider('pi-agent.changesView', changesProvider)
    );

    // Status bar
    statusBar = new StatusBarManager(manager);
    context.subscriptions.push({ dispose: () => statusBar.dispose() });

    // Inline completion provider
    const client = new LlmClient();
    inlineCompletionProvider = new InlineCompletionProvider(client);
    updateInlineCompletions();

    // Register VSCode Chat participant (Copilot Chat integration)
    try {
        if ('createChatParticipant' in vscode.chat) {
            const participant = (vscode.chat as any).createChatParticipant(
                'pi.chat',
                async (request: any, _ctx: any, stream: any, _token: any) => {
                    const prompt = request.prompt;
                    if (request.command) {
                        stream.markdown('**/' + request.command + '** — use the Pi Agent sidebar chat for slash commands.\n');
                        return;
                    }
                    try {
                        const ctx = await buildContextString();
                        await manager.processUserMessage(prompt, ctx);
                        stream.markdown('Response sent to Pi Agent sidebar.\n');
                    } catch (err: any) {
                        stream.markdown('Error: ' + err.message + '\n');
                    }
                }
            );
            if (participant) {
                participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.svg');
                context.subscriptions.push(participant);
                logger.info('Chat participant registered');
            }
        }
    } catch (err: any) {
        logger.warn('Could not register chat participant: ' + err.message);
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('pi-agent.openChat', () => chatProvider.show()),
        vscode.commands.registerCommand('pi-agent.explainCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            chatProvider.show();
            await manager.processUserMessage('Explain this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', await buildContextString());
        }),
        vscode.commands.registerCommand('pi-agent.fixCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            chatProvider.show();
            await manager.processUserMessage('Fix errors in this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', await buildContextString());
        }),
        vscode.commands.registerCommand('pi-agent.refactorCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection);
            if (!code) { vscode.window.showWarningMessage('Select code to refactor'); return; }
            const lang = editor.document.languageId;
            chatProvider.show();
            await manager.processUserMessage('Refactor this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', await buildContextString());
        }),
        vscode.commands.registerCommand('pi-agent.generateTests', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            chatProvider.show();
            await manager.processUserMessage('Generate comprehensive tests for this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', await buildContextString());
        }),
        vscode.commands.registerCommand('pi-agent.reviewCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            chatProvider.show();
            await manager.processUserMessage('Review this ' + lang + ' code for issues and improvements:\n```' + lang + '\n' + code + '\n```', await buildContextString());
        }),
        vscode.commands.registerCommand('pi-agent.generateCommitMessage', async () => {
            chatProvider.show();
            await manager.processUserMessage('Generate a conventional commit message for the current staged changes. Use git_status and git_diff_staged tools.', await buildContextString());
        }),
        vscode.commands.registerCommand('pi-agent.newSession', () => {
            manager.clearSession();
        }),
        vscode.commands.registerCommand('pi-agent.planMode', () => {
            const enabled = manager.togglePlanMode();
            vscode.window.showInformationMessage('Plan Mode: ' + (enabled ? 'ON' : 'OFF'));
        }),
        vscode.commands.registerCommand('pi-agent.toggleInlineSuggestions', () => {
            const config = getConfig();
            const newVal = !config.inlineSuggestions.enabled;
            vscode.workspace.getConfiguration('pi-agent').update('inlineSuggestions.enabled', newVal, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Inline Suggestions: ' + (newVal ? 'ON' : 'OFF'));
        }),
        vscode.commands.registerCommand('pi-agent.showContext', async () => {
            const ctx = await buildContextString();
            vscode.window.showInformationMessage('Context: ' + ctx.slice(0, 200));
        }),
        vscode.commands.registerCommand('pi-agent.showChanges', () => {
            vscode.window.showInformationMessage('Changes tracked in sidebar → Changes view');
        })
    );

    // Config change listener
    context.subscriptions.push(
        onConfigChange(() => {
            statusBar.refreshModel();
            updateInlineCompletions();
            logger.info('Configuration updated');
        })
    );

    // Track document changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            const changes = e.contentChanges;
            if (changes.length > 0) {
                let added = 0, removed = 0;
                for (const change of changes) {
                    const newLines = change.text.split('\n').length - 1;
                    const removedLines = change.rangeLength > 0 ? (e.document.getText(change.range).split('\n').length - 1) : 0;
                    added += Math.max(0, newLines);
                    removed += Math.max(0, removedLines);
                }
                if (added > 0 || removed > 0) {
                    changesProvider.trackChange(e.document.fileName, added, removed);
                }
            }
        })
    );

    logger.info('Pi Agent extension activated');
    logger.info('Model: ' + getConfig().api.model + ', API: ' + getConfig().api.baseUrl);
    logger.info('Tools: ' + manager.getToolRegistry().getAll().map(t => t.name).join(', '));
}

function updateInlineCompletions(): void {
    const config = getConfig();
    if (inlineCompletionDisposable) {
        inlineCompletionDisposable.dispose();
        inlineCompletionDisposable = undefined;
    }
    if (config.inlineSuggestions.enabled) {
        inlineCompletionDisposable = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            inlineCompletionProvider
        );
        logger.info('Inline completions enabled');
    }
}

export function deactivate() {
    logger?.info('Pi Agent extension deactivated');
    manager?.stop();
}
