import * as vscode from 'vscode';
import { PiAgentManager, AgentEventData } from '../agent/manager';
import { getChatWebviewContent } from './webviewContent';
import { Logger } from '../utils/logger';
import { buildContextString } from '../utils/context';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'pi-agent.chatView';
    private webviewView?: vscode.WebviewView;
    private manager: PiAgentManager;
    private logger = Logger.getInstance();
    private pendingMessages: any[] = [];

    constructor(private readonly extensionUri: vscode.Uri, manager: PiAgentManager) {
        this.manager = manager;
        this.manager.on('event', (event: AgentEventData) => {
            this.handleAgentEvent(event);
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.webviewView = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.html = getChatWebviewContent(webviewView.webview, this.extensionUri);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (!message || !message.type) { return; }

            switch (message.type) {
                case 'userMessage': {
                    const text = message.data?.text;
                    if (text) {
                        this.logger.info('User message: ' + text);
                        await this.handleUserMessage(text);
                    }
                    break;
                }
                case 'stop':
                    this.manager.stop();
                    break;
                case 'ready':
                    this.logger.info('Webview ready');
                    // Flush pending messages
                    for (const msg of this.pendingMessages) {
                        this.webviewView?.webview.postMessage(msg);
                    }
                    this.pendingMessages = [];
                    break;
            }
        });
    }

    private async handleUserMessage(text: string): Promise<void> {
        if (text.startsWith('/')) { await this.handleCommand(text); return; }
        try {
            await this.manager.processUserMessage(text, await buildContextString());
        } catch (err: any) {
            this.logger.error('Error: ' + err.message, err);
            this.postMessage({ type: 'error', data: { message: err.message } });
        }
    }

    private async handleCommand(text: string): Promise<void> {
        const parts = text.slice(1).split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');

        this.postMessage({ type: 'userMessage', data: { text: text, isCommand: true } });

        switch (command) {
            case 'explain': {
                const editor = vscode.window.activeTextEditor;
                const code = editor?.document.getText(editor.selection) || editor?.document.getText() || '';
                const lang = editor?.document.languageId || '';
                const prompt = code
                    ? 'Explain this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```'
                    : 'No code selected. Please select code first.';
                if (code) { await this.manager.processUserMessage(prompt); }
                else { this.postMessage({ type: 'error', data: { message: prompt } }); }
                break;
            }
            case 'fix': {
                const editor = vscode.window.activeTextEditor;
                const code = editor?.document.getText(editor.selection) || editor?.document.getText() || '';
                const lang = editor?.document.languageId || '';
                if (code) {
                    await this.manager.processUserMessage('Fix errors in this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```');
                } else {
                    this.postMessage({ type: 'error', data: { message: 'No code selected. Select code first.' } });
                }
                break;
            }
            case 'refactor': {
                const editor = vscode.window.activeTextEditor;
                const code = editor?.document.getText(editor.selection) || '';
                const lang = editor?.document.languageId || '';
                if (code) {
                    await this.manager.processUserMessage('Refactor this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```');
                } else {
                    this.postMessage({ type: 'error', data: { message: 'No code selected. Select code first.' } });
                }
                break;
            }
            case 'test': {
                const editor = vscode.window.activeTextEditor;
                const code = editor?.document.getText(editor.selection) || editor?.document.getText() || '';
                const lang = editor?.document.languageId || '';
                if (code) {
                    await this.manager.processUserMessage('Generate comprehensive tests for this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```');
                } else {
                    this.postMessage({ type: 'error', data: { message: 'No code selected. Select code first.' } });
                }
                break;
            }
            case 'review': {
                const editor = vscode.window.activeTextEditor;
                const code = editor?.document.getText(editor.selection) || editor?.document.getText() || '';
                const lang = editor?.document.languageId || '';
                if (code) {
                    await this.manager.processUserMessage('Review this ' + lang + ' code for issues, improvements, and best practices:\n```' + lang + '\n' + code + '\n```');
                } else {
                    this.postMessage({ type: 'error', data: { message: 'No code selected. Select code first.' } });
                }
                break;
            }
            case 'commit': {
                await this.manager.processUserMessage('Generate a conventional commit message for the current staged changes. Use git_diff_staged and git_status tools.');
                break;
            }
            case 'plan': {
                const enabled = this.manager.togglePlanMode();
                this.postMessage({ type: 'status', data: { state: 'idle', text: enabled ? 'Plan Mode ON' : 'Plan Mode OFF' } });
                if (args) {
                    await this.manager.processUserMessage(
                        'Create a detailed, step-by-step implementation plan for: ' + args + '\n\nUse numbered steps. Be specific about files, functions, and changes needed.'
                    );
                }
                break;
            }
            case 'scout': {
                if (args) { await this.manager.processAgentMessage('scout', args); }
                else { this.postMessage({ type: 'error', data: { message: 'Usage: /scout <what to investigate>' } }); }
                break;
            }
            case 'research': {
                if (args) { await this.manager.processAgentMessage('researcher', args); }
                else { this.postMessage({ type: 'error', data: { message: 'Usage: /research <topic>' } }); }
                break;
            }
            case 'clear': this.manager.clearSession(); break;
            case 'help': {
                this.postMessage({ type: 'assistantMessage', data: { text: this.getHelpText() } });
                break;
            }
            default: this.postMessage({ type: 'error', data: { message: 'Unknown command: /' + command + '. Type /help for available commands.' } });
        }
    }

    private getHelpText(): string {
        return [
            '**Available Commands:**',
            '',
            '| Command | Description |',
            '|---------|-------------|',
            '| `/explain` | Explain selected code |',
            '| `/fix` | Fix errors in selected code |',
            '| `/refactor` | Refactor selected code |',
            '| `/test` | Generate tests for selected code |',
            '| `/review` | Review selected code |',
            '| `/commit` | Generate commit message |',
            '| `/plan [task]` | Toggle plan mode (+ optional task) |',
            '| `/scout <query>` | Quick codebase reconnaissance |',
            '| `/research <topic>` | Research a topic |',
            '| `/clear` | Clear chat history |',
            '| `/help` | Show this help |',
        ].join('\n');
    }

    private handleAgentEvent(event: AgentEventData): void {
        switch (event.type) {
            case 'streamStart':
                this.postMessage({ type: 'streamStart' });
                break;
            case 'streamChunk':
                this.postMessage({ type: 'streamChunk', data: { text: event.data.content } });
                break;
            case 'streamEnd':
                this.postMessage({ type: 'streamEnd' });
                break;
            case 'assistantMessage':
                this.postMessage({ type: 'streamEnd' });
                break;
            case 'toolCall':
                this.postMessage({
                    type: 'toolCall',
                    data: { name: event.data.name, arguments: event.data.arguments, status: 'running' }
                });
                break;
            case 'toolResult':
                this.postMessage({
                    type: 'toolResult',
                    data: {
                        name: event.data.name,
                        result: typeof event.data.result === 'object' ? event.data.result.content : event.data.result,
                        error: event.data.result?.isError ? event.data.result.content : null,
                    }
                });
                break;
            case 'error':
                this.postMessage({ type: 'streamEnd' });
                this.postMessage({ type: 'error', data: { message: event.data.message } });
                break;
            case 'clear':
                this.postMessage({ type: 'clear' });
                break;
            case 'status':
                this.postMessage({
                    type: 'status',
                    data: {
                        state: event.data.status,
                        text: event.data.status === 'thinking' ? 'Thinking...'
                            : event.data.status === 'idle' ? 'Ready' : event.data.status
                    }
                });
                break;
        }
    }

    private postMessage(message: any): void {
        if (this.webviewView) {
            try { this.webviewView.webview.postMessage(message); }
            catch { this.logger.warn('Failed to post message to webview'); }
        } else {
            this.pendingMessages.push(message);
        }
    }

    public show(): void { this.webviewView?.show?.(true); }
}
