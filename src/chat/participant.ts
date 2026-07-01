import * as vscode from 'vscode';
import { PiAgentManager } from '../agent/manager';
import { buildContextString } from '../utils/context';
import { handleSlashCommand, helpMarkdown } from './commands';

/**
 * Register the native VS Code ChatParticipant.
 * Returns the participant for disposal tracking.
 */
export function registerChatParticipant(
    manager: PiAgentManager,
    extensionUri: vscode.Uri
): vscode.ChatParticipant {
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
                return await handleSlashCommand(request.command, prompt, stream, manager);
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
                        break;
                    }
                    case 'toolResult': {
                        if (event.data.isError) {
                            stream.markdown('  ❌ Error: ' + (typeof event.data.isError === 'string' ? event.data.isError : 'Tool failed') + '\n');
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

    chatParticipant.iconPath = vscode.Uri.joinPath(extensionUri, 'images', 'icon.svg');

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

    return chatParticipant;
}
