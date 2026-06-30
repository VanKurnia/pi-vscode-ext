import * as vscode from 'vscode';
import { PiAgentManager } from './agent/manager';
import { LlmClient } from './agent/client';
import { ChatViewProvider } from './ui/chatViewProvider';
import { StatusBarManager } from './ui/statusBar';
import { InlineCompletionProvider } from './ui/inlineCompletion';
import { AgentsTreeProvider } from './ui/agentsTreeProvider';
import { ChangesTreeProvider } from './ui/changesTreeProvider';
import { registerCommands } from './commands';
import { Logger } from './utils/logger';
import { getConfig, onConfigChange } from './utils/config';

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

    // Register commands
    registerCommands(context, manager, logger);

    // Status bar
    statusBar = new StatusBarManager(manager);
    context.subscriptions.push({
        dispose: () => statusBar.dispose(),
    });

    // Inline completion provider
    const client = new LlmClient();
    inlineCompletionProvider = new InlineCompletionProvider(client);
    updateInlineCompletions();

    // Chat participant (VSCode 1.90+)
    try {
        if ('createChatParticipant' in vscode.chat) {
            const participant = (vscode.chat as any).createChatParticipant(
                'pi.chat',
                async (request: any, _context: any, stream: any, _token: any) => {
                    const prompt = request.prompt;

                    // Handle slash commands
                    if (request.command) {
                        switch (request.command) {
                            case 'explain':
                            case 'fix':
                            case 'refactor':
                            case 'test':
                            case 'review':
                            case 'commit':
                            case 'plan':
                                stream.markdown(`Running /${request.command}...\\n`);
                                await manager.processUserMessage(`/${request.command} ${prompt}`);
                                break;
                            case 'scout':
                                await manager.processAgentMessage('scout', prompt);
                                break;
                            case 'research':
                                await manager.processAgentMessage('researcher', prompt);
                                break;
                            default:
                                stream.markdown(`Unknown command: ${request.command}\\n`);
                        }
                        return;
                    }

                    // Regular chat message
                    const { buildContextString } = require('./utils/context');
                    stream.markdown('⚡ *Thinking...*\\n');
                    await manager.processUserMessage(prompt, buildContextString());
                }
            );

            if (participant) {
                participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.svg');
                context.subscriptions.push(participant);
                logger.info('Chat participant registered');
            }
        }
    } catch (err: any) {
        logger.warn(`Could not register chat participant: ${err.message}`);
    }

    // Config change listener
    context.subscriptions.push(
        onConfigChange(() => {
            statusBar.refreshModel();
            updateInlineCompletions();
            logger.info('Configuration updated');
        })
    );

    // Track document changes for filechanges view
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            const changes = e.contentChanges;
            if (changes.length > 0) {
                let added = 0;
                let removed = 0;
                for (const change of changes) {
                    const newLines = change.text.split('\n').length - 1;
                    const removedLines = change.rangeLength > 0
                        ? (e.document.getText(change.range).split('\n').length - 1)
                        : 0;
                    added += Math.max(0, newLines);
                    removed += Math.max(0, removedLines);
                }
                if (added > 0 || removed > 0) {
                    changesProvider.trackChange(e.document.fileName, added, removed);
                }
            }
        })
    );

    logger.info('Pi Agent extension activated successfully');
    logger.info(`Model: ${getConfig().api.model}, API: ${getConfig().api.baseUrl}`);
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
