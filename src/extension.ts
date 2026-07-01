import * as vscode from 'vscode';
import { PiAgentManager } from './agent/manager';
import { LlmClient } from './agent/client';
import { StatusBarManager } from './ui/statusBar';
import { InlineCompletionProvider } from './ui/inlineCompletion';
import { AgentsTreeProvider } from './ui/agentsTreeProvider';
import { ChangesTreeProvider } from './ui/changesTreeProvider';
import { Logger } from './utils/logger';
import { getConfig, onConfigChange } from './utils/config';
import { resetBashGuard } from './tools/bashGuard';
import { buildContextString } from './utils/context';

let manager: PiAgentManager;
let statusBar: StatusBarManager;
let logger: Logger;
let inlineCompletionProvider: InlineCompletionProvider;
let inlineCompletionDisposable: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext) {
    logger = Logger.getInstance();
    logger.info('Pi Agent activating...');

    // Create the main manager
    manager = new PiAgentManager();

    // Register tree views (sidebar)
    const agentsProvider = new AgentsTreeProvider(manager);
    const changesProvider = new ChangesTreeProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('pi-agent.agentsView', agentsProvider),
        vscode.window.registerTreeDataProvider('pi-agent.changesView', changesProvider),
        agentsProvider,
        changesProvider
    );

    // Status bar
    statusBar = new StatusBarManager(manager);
    context.subscriptions.push({ dispose: () => statusBar.dispose() });

    // Inline completion provider
    const client = new LlmClient();
    inlineCompletionProvider = new InlineCompletionProvider(client);
    updateInlineCompletions();

    // ═══════════════════════════════════════════════════════════════
    // PRIMARY CHAT: Native VS Code ChatParticipant
    // ═══════════════════════════════════════════════════════════════
    const chatParticipant = vscode.chat.createChatParticipant(
        'pi-agent.chat',
        async (
            request: vscode.ChatRequest,
            chatContext: vscode.ChatContext,
            stream: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ): Promise<vscode.ChatResult> => {
            const prompt = request.prompt;

            // ── Slash commands ──────────────────────────────────
            if (request.command) {
                return await handleSlashCommand(request.command, prompt, stream);
            }

            // ── Regular message ─────────────────────────────────
            if (!prompt.trim()) {
                stream.markdown('Type a message or use a command:\n\n');
                stream.markdown(helpMarkdown());
                return {};
            }

            stream.progress('Thinking...');
            const ctx = await buildContextString();

            // Wire manager events to stream
            const disposables: vscode.Disposable[] = [];
            const toolInvocations = new Map<string, any>();

            const eventHandler = (event: any) => {
                switch (event.type) {
                    case 'streamChunk':
                        if (event.data.content) {
                            stream.markdown(event.data.content);
                        }
                        break;
                    case 'toolCall': {
                        const name = event.data.name;
                        const args = event.data.arguments;
                        stream.markdown('\n\n⚡ **`' + name + '`**');
                        if (args) {
                            const argsStr = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
                            if (argsStr.length < 200) {
                                stream.markdown(' `' + argsStr.replace(/\n/g, ' ').slice(0, 100) + '`');
                            }
                        }
                        stream.markdown('\n');
                        toolInvocations.set(event.data.id || name, event.data);
                        break;
                    }
                    case 'toolResult': {
                        const id = event.data.id || event.data.name;
                        const result = event.data.result;
                        const isError = event.data.error;
                        if (isError) {
                            stream.markdown('  ❌ Error: ' + (typeof isError === 'string' ? isError : 'Tool failed') + '\n');
                        } else {
                            stream.markdown('  ✅\n');
                        }
                        break;
                    }
                    case 'error':
                        stream.markdown('\n\n❌ **Error:** ' + event.data.message + '\n');
                        break;
                }
            };
            manager.on('event', eventHandler);
            disposables.push({ dispose: () => { manager.removeListener('event', eventHandler); } });

            try {
                // Handle abort
                token.onCancellationRequested(() => { manager.stop(); });

                await manager.processUserMessage(prompt, ctx);
            } catch (err: any) {
                stream.markdown('\n\n❌ **Error:** ' + err.message + '\n');
            } finally {
                disposables.forEach(d => d.dispose());
            }

            return {};
        }
    );

    chatParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.svg');

    // Followup suggestions after each response
    chatParticipant.followupProvider = {
        provideFollowups(_result: vscode.ChatResult, _ctx: vscode.ChatContext, _token: vscode.CancellationToken): vscode.ChatFollowup[] {
            return [
                { prompt: '/fix', label: '🔧 Fix issues', command: 'fix' },
                { prompt: '/refactor', label: '♻️ Refactor', command: 'refactor' },
                { prompt: '/test', label: '🧪 Generate tests', command: 'test' },
                { prompt: '/review', label: '👁️ Review code', command: 'review' },
            ];
        }
    };

    context.subscriptions.push(chatParticipant);
    logger.info('Chat participant registered');

    // Output channel for standalone command results (reuse Logger's channel)
    const commandOutput = logger.getChannel();
    context.subscriptions.push(commandOutput);

    // Helper: run a prompt and show output in a notification
    async function runCommand(prompt: string, label: string) {
        commandOutput.clear();
        commandOutput.appendLine('⏳ ' + label + '...\n');

        // Wire events to output channel
        const handler = (event: any) => {
            switch (event.type) {
                case 'streamChunk':
                    if (event.data.content) { commandOutput.append(event.data.content); }
                    break;
                case 'toolCall':
                    commandOutput.appendLine('\n⚡ Tool: ' + event.data.name);
                    break;
                case 'toolResult':
                    commandOutput.appendLine(event.data.error ? '  ❌ Error' : '  ✅ Done');
                    break;
                case 'assistantMessage':
                    if (event.data.content) { commandOutput.appendLine('\n' + event.data.content); }
                    break;
                case 'error':
                    commandOutput.appendLine('\n❌ Error: ' + event.data.message);
                    break;
            }
        };
        manager.on('event', handler);

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'π ' + label },
            async () => {
                await manager.processUserMessage(prompt, await buildContextString());
            }
        );

        manager.removeListener('event', handler);
        commandOutput.appendLine('\n✅ Done. View full output: Pi Agent channel');
        commandOutput.show(true);
    }

    // ═══════════════════════════════════════════════════════════════
    // COMMANDS
    // ═══════════════════════════════════════════════════════════════
    context.subscriptions.push(
        vscode.commands.registerCommand('pi-agent.openChat', () => {
            vscode.commands.executeCommand('workbench.action.chat.open', '@pi');
        }),
        vscode.commands.registerCommand('pi-agent.explainCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            await runCommand('Explain this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', 'Explaining code');
        }),
        vscode.commands.registerCommand('pi-agent.fixCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            await runCommand('Fix errors in this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', 'Fixing code');
        }),
        vscode.commands.registerCommand('pi-agent.refactorCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection);
            if (!code) { vscode.window.showWarningMessage('Select code to refactor'); return; }
            const lang = editor.document.languageId;
            await runCommand('Refactor this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', 'Refactoring code');
        }),
        vscode.commands.registerCommand('pi-agent.generateTests', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            await runCommand('Generate tests for this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', 'Generating tests');
        }),
        vscode.commands.registerCommand('pi-agent.reviewCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            await runCommand('Review this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', 'Reviewing code');
        }),
        vscode.commands.registerCommand('pi-agent.generateCommitMessage', async () => {
            await runCommand('Generate a conventional commit message. Use git_status and git_diff_staged tools first.', 'Generating commit message');
        }),
        vscode.commands.registerCommand('pi-agent.newSession', () => {
            manager.clear();
            vscode.window.showInformationMessage('π Agent: Session cleared');
        }),
        vscode.commands.registerCommand('pi-agent.planMode', () => {
            const enabled = manager.togglePlanMode();
            vscode.window.showInformationMessage('π Plan Mode: ' + (enabled ? 'ON' : 'OFF'));
        }),
        vscode.commands.registerCommand('pi-agent.toggleInlineSuggestions', () => {
            const config = getConfig();
            const newVal = !config.inlineSuggestions.enabled;
            vscode.workspace.getConfiguration('pi-agent').update('inlineSuggestions.enabled', newVal, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('π Inline Suggestions: ' + (newVal ? 'ON' : 'OFF'));
        }),
        vscode.commands.registerCommand('pi-agent.showContext', async () => {
            const ctx = await buildContextString();
            vscode.window.showInformationMessage('π Context: ' + ctx.slice(0, 200));
        })
    );

    // Config change listener
    context.subscriptions.push(
        onConfigChange(() => {
            statusBar.refreshModel();
            updateInlineCompletions();
            resetBashGuard();
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

    context.subscriptions.push({ dispose: () => manager.dispose() });

    logger.info('Pi Agent activated — model: ' + getConfig().api.model);
    logger.info('Tools: ' + manager.getToolRegistry().getAll().map(t => t.name).join(', '));
}

// ═══════════════════════════════════════════════════════════════
// SLASH COMMAND HANDLER
// ═══════════════════════════════════════════════════════════════
async function handleSlashCommand(
    command: string,
    prompt: string,
    stream: vscode.ChatResponseStream
): Promise<vscode.ChatResult> {
    const ctx = await buildContextString();

    const getEditorCode = (): { code: string; lang: string } | null => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return null;
        const code = editor.document.getText(editor.selection) || editor.document.getText();
        return { code, lang: editor.document.languageId };
    };

    switch (command) {
        case 'explain': {
            const ed = getEditorCode();
            if (!ed || !ed.code) { stream.markdown('⚠️ No code selected. Select code in the editor first.'); return {}; }
            stream.progress('Explaining code...');
            await manager.processUserMessage('Explain this ' + ed.lang + ' code:\n```' + ed.lang + '\n' + ed.code + '\n```', ctx);
            return {};
        }
        case 'fix': {
            const ed = getEditorCode();
            if (!ed || !ed.code) { stream.markdown('⚠️ No code selected.'); return {}; }
            stream.progress('Analyzing code...');
            await manager.processUserMessage('Fix errors in this ' + ed.lang + ' code:\n```' + ed.lang + '\n' + ed.code + '\n```', ctx);
            return {};
        }
        case 'refactor': {
            const ed = getEditorCode();
            if (!ed || !ed.code) { stream.markdown('⚠️ No code selected.'); return {}; }
            stream.progress('Refactoring...');
            await manager.processUserMessage('Refactor this ' + ed.lang + ' code:\n```' + ed.lang + '\n' + ed.code + '\n```', ctx);
            return {};
        }
        case 'test': {
            const ed = getEditorCode();
            if (!ed || !ed.code) { stream.markdown('⚠️ No code selected.'); return {}; }
            stream.progress('Generating tests...');
            await manager.processUserMessage('Generate tests for this ' + ed.lang + ' code:\n```' + ed.lang + '\n' + ed.code + '\n```', ctx);
            return {};
        }
        case 'review': {
            const ed = getEditorCode();
            if (!ed || !ed.code) { stream.markdown('⚠️ No code selected.'); return {}; }
            stream.progress('Reviewing code...');
            await manager.processUserMessage('Review this ' + ed.lang + ' code for issues:\n```' + ed.lang + '\n' + ed.code + '\n```', ctx);
            return {};
        }
        case 'commit': {
            stream.progress('Generating commit message...');
            await manager.processUserMessage('Generate a conventional commit message. Use git_status and git_diff_staged first.', ctx);
            return {};
        }
        case 'plan': {
            const enabled = manager.togglePlanMode();
            stream.markdown('**Plan Mode:** ' + (enabled ? '✅ ON' : '❌ OFF') + '\n\n');
            if (prompt.trim()) {
                stream.progress('Creating plan...');
                await manager.processUserMessage('Create a detailed step-by-step plan for: ' + prompt, ctx);
            }
            return {};
        }
        case 'scout': {
            if (!prompt.trim()) { stream.markdown('Usage: `/scout <what to investigate>`'); return {}; }
            stream.progress('Scouting...');
            await manager.processAgentMessage('scout', prompt);
            return {};
        }
        case 'research': {
            if (!prompt.trim()) { stream.markdown('Usage: `/research <topic>`'); return {}; }
            stream.progress('Researching...');
            await manager.processAgentMessage('researcher', prompt);
            return {};
        }
        case 'clear': {
            manager.clear();
            stream.markdown('✅ Session cleared.\n');
            return {};
        }
        default: {
            stream.markdown('Unknown command: `/' + command + '`\n\n');
            stream.markdown(helpMarkdown());
            return {};
        }
    }
}

function helpMarkdown(): string {
    return [
        '**Available Commands:**',
        '',
        '| Command | Description |',
        '|---------|-------------|',
        '| `/explain` | Explain selected code |',
        '| `/fix` | Fix errors in selected code |',
        '| `/refactor` | Refactor selected code |',
        '| `/test` | Generate tests for selected code |',
        '| `/review` | Review code for issues |',
        '| `/commit` | Generate commit message |',
        '| `/plan [task]` | Toggle plan mode |',
        '| `/scout <query>` | Codebase reconnaissance |',
        '| `/research <topic>` | Research a topic |',
        '| `/clear` | Clear chat history |',
        '',
    ].join('\n');
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
    logger?.info('Pi Agent deactivated');
    manager?.stop();
    logger?.dispose();
}
