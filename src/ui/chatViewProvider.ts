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
                // Webview sends { type: 'userMessage', data: { text: '...' } }
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
                    break;
            }
        });
    }

    private async handleUserMessage(text: string): Promise<void> {
        if (text.startsWith('/')) { await this.handleCommand(text); return; }
        try {
            await this.manager.processUserMessage(text, buildContextString());
        } catch (err: any) {
            this.logger.error('Error processing message: ' + err.message, err);
            this.postMessage({ type: 'error', data: { message: err.message } });
        }
    }

    private async handleCommand(text: string): Promise<void> {
        const parts = text.slice(1).split(/\s+/);
        const command = parts[0];
        const args = parts.slice(1).join(' ');

        switch (command) {
            case 'explain': vscode.commands.executeCommand('pi-agent.explainCode'); break;
            case 'fix': vscode.commands.executeCommand('pi-agent.fixCode'); break;
            case 'refactor': vscode.commands.executeCommand('pi-agent.refactorCode'); break;
            case 'test': vscode.commands.executeCommand('pi-agent.generateTests'); break;
            case 'review': vscode.commands.executeCommand('pi-agent.reviewCode'); break;
            case 'commit': vscode.commands.executeCommand('pi-agent.generateCommitMessage'); break;
            case 'plan': vscode.commands.executeCommand('pi-agent.planMode'); break;
            case 'scout':
                if (args) { await this.manager.processAgentMessage('scout', args); }
                else { this.postMessage({ type: 'error', data: { message: 'Usage: /scout <what to investigate>' } }); }
                break;
            case 'research':
                if (args) { await this.manager.processAgentMessage('researcher', args); }
                else { this.postMessage({ type: 'error', data: { message: 'Usage: /research <topic>' } }); }
                break;
            case 'clear': this.manager.clearSession(); break;
            default: this.postMessage({ type: 'error', data: { message: 'Unknown command: /' + command } });
        }
    }

    private handleAgentEvent(event: AgentEventData): void {
        if (!this.webviewView) {
            this.logger.warn('No webviewView available for event: ' + event.type);
            return;
        }

        switch (event.type) {
            case 'userMessage':
                // Already displayed by webview
                break;
            case 'streamStart':
                this.postMessage({ type: 'streamStart' });
                break;
            case 'streamChunk':
                this.postMessage({ type: 'streamChunk', data: { text: event.data.content } });
                break;
            case 'assistantMessage':
                // End stream first, then show final message
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
                        result: event.data.result?.content || event.data.result,
                        error: event.data.result?.isError ? event.data.result.content : null,
                    }
                });
                break;
            case 'error':
                this.postMessage({ type: 'error', data: { message: event.data.message } });
                break;
            case 'clear':
                this.postMessage({ type: 'clear' });
                break;
            case 'status':
                this.postMessage({
                    type: 'status',
                    data: { state: event.data.status, text: event.data.status === 'thinking' ? 'Thinking...' : 'Ready' }
                });
                break;
        }
    }

    private postMessage(message: any): void {
        try { this.webviewView?.webview.postMessage(message); }
        catch (err) { this.logger.warn('Failed to post message to webview: ' + err); }
    }

    public show(): void { this.webviewView?.show?.(true); }
}
