/**
 * Pi Agent Chat Panel — GitHub Copilot-quality webview UI
 *
 * Pure webview implementation (no VS Code Chat API dependency).
 * Premium dark-theme chat with markdown rendering, code highlighting,
 * copy buttons, typing indicators, file mentions, and more.
 */

import * as vscode from 'vscode';
import type { AgentHarness } from '@earendil-works/pi-agent-core';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: number;
    tokenUsage?: { prompt?: number; completion?: number; total?: number };
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class ChatPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'pi-agent.chatPanel';

    private view?: vscode.WebviewView;
    private harness: AgentHarness;
    private history: ChatMessage[] = [];
    private modelName: string;

    constructor(
        private readonly extensionUri: vscode.Uri,
        harness: AgentHarness,
        modelName?: string
    ) {
        this.harness = harness;
        this.modelName = modelName ?? 'Pi Agent';
    }

    /** Update the model name displayed in the panel header. */
    public setModelName(name: string): void {
        this.modelName = name;
        this.postMessage({ type: 'config', modelName: name });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);

        // Send current state on load
        this.postMessage({
            type: 'init',
            history: this.history,
            modelName: this.modelName,
        });

        webviewView.webview.onDidReceiveMessage(async (msg: any) => {
            switch (msg.type) {
                case 'send':
                    await this.handleUserMessage(msg.text);
                    break;
                case 'clear':
                    this.history = [];
                    this.updateWebview();
                    break;
                case 'ready':
                    this.postMessage({
                        type: 'init',
                        history: this.history,
                        modelName: this.modelName,
                    });
                    break;
            }
        });
    }

    // ─── Message handling ────────────────────────────────────────────────────

    private async handleUserMessage(text: string): Promise<void> {
        if (!text.trim()) return;

        const userMsg: ChatMessage = {
            role: 'user',
            content: text,
            timestamp: Date.now(),
        };
        this.history.push(userMsg);
        this.updateWebview();
        this.postMessage({ type: 'thinking' });

        try {
            const response = await this.harness.prompt(text);
            const content = this.extractText(response);
            const tokenUsage = this.extractTokenUsage(response);

            const assistantMsg: ChatMessage = {
                role: 'assistant',
                content,
                timestamp: Date.now(),
                tokenUsage,
            };
            this.history.push(assistantMsg);
        } catch (err: any) {
            this.history.push({
                role: 'assistant',
                content: `**Error:** ${err.message ?? 'Unknown error'}`,
                timestamp: Date.now(),
            });
        }

        this.postMessage({ type: 'done' });
        this.updateWebview();
    }

    private extractText(response: any): string {
        if (typeof response === 'string') return response;
        if (response?.content) {
            if (typeof response.content === 'string') return response.content;
            if (Array.isArray(response.content)) {
                return response.content
                    .filter((c: any) => c.type === 'text')
                    .map((c: any) => c.text)
                    .join('\n');
            }
        }
        if (response?.text) return response.text;
        return JSON.stringify(response, null, 2);
    }

    private extractTokenUsage(response: any): ChatMessage['tokenUsage'] {
        const usage = response?.usage ?? response?.tokenUsage;
        if (!usage) return undefined;
        return {
            prompt: usage.prompt_tokens ?? usage.prompt,
            completion: usage.completion_tokens ?? usage.completion,
            total: usage.total_tokens ?? usage.total,
        };
    }

    // ─── Webview communication ───────────────────────────────────────────────

    private postMessage(msg: any): void {
        this.view?.webview.postMessage(msg);
    }

    private updateWebview(): void {
        this.postMessage({ type: 'update', history: this.history });
    }

    // ─── HTML Generation ─────────────────────────────────────────────────────

    private getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const cspSource = webview.cspSource;
        const styles = getStyles();
        const script = getScript(nonce);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; font-src ${cspSource};">
    <style>${styles}</style>
</head>
<body>
    <div id="app">
        <div id="header">
            <div id="header-left">
                <div id="model-icon">\u03C0</div>
                <span id="model-name">Pi Agent</span>
            </div>
            <div id="header-actions">
                <button class="icon-btn" id="clear-btn" title="Clear chat">
                    <svg viewBox="0 0 16 16"><path d="M10 1h-1v1h3a1 1 0 0 1 0 2H4a1 1 0 0 1 0-2h3V1H6a.5.5 0 0 0-.5.5V3H4a2 2 0 0 0-2 2v1h12V5a2 2 0 0 0-2-2h-1.5V1.5A.5.5 0 0 0 10 1zM3 7v6.5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5V7H3zm3 1.5a.5.5 0 0 1 1 0v4a.5.5 0 0 1-1 0v-4zm3 0a.5.5 0 0 1 1 0v4a.5.5 0 0 1-1 0v-4z"/></svg>
                </button>
            </div>
        </div>
        <div id="messages">
            <div id="empty-state">
                <div class="logo">\u03C0</div>
                <h2>Pi Agent</h2>
                <p>Ask me anything about your code. I can explain, fix, refactor, and generate code.</p>
                <div class="shortcuts">
                    <span class="shortcut-chip" data-msg="Explain the selected code">\uD83D\uDCA1 Explain</span>
                    <span class="shortcut-chip" data-msg="Fix errors in the code">\uD83D\uDD27 Fix</span>
                    <span class="shortcut-chip" data-msg="Refactor this code for better readability">\u267B\uFE0F Refactor</span>
                    <span class="shortcut-chip" data-msg="Generate tests for this code">\uD83E\uDDEA Test</span>
                </div>
            </div>
        </div>
        <div id="thinking">
            <div class="thinking-avatar">\u03C0</div>
            <div class="thinking-dots"><span></span><span></span><span></span></div>
            <span class="thinking-label">Thinking\u2026</span>
        </div>
        <div id="mention-popup"></div>
        <div id="input-area">
            <div id="input-wrapper">
                <textarea id="input" rows="1" placeholder="Ask Pi Agent\u2026 (@ to mention files)" autofocus></textarea>
                <button id="send-btn" disabled title="Send message (Enter)">
                    <svg viewBox="0 0 16 16"><path d="M14.85 1.49L.44 7.37c-.56.23-.54.93.03 1.13l5.41 2.1 2.1 5.41c.2.51.89.53 1.13.03l5.88-14.41c.24-.58-.28-1.1-.86-.86z"/></svg>
                </button>
            </div>
            <div id="input-hints">
                <span><kbd>Enter</kbd> send &middot; <kbd>Shift+Enter</kbd> newline</span>
                <span><kbd>@</kbd> mention files</span>
            </div>
        </div>
    </div>
    <script nonce="${nonce}">${script}</script>
</body>
</html>`;
    }

    public dispose(): void {
        this.view = undefined;
    }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function getNonce(): string {
    let t = '';
    const p = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        t += p.charAt(Math.floor(Math.random() * p.length));
    }
    return t;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function getStyles(): string {
    return `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
    --pi-bg: var(--vscode-panel-background, #1e1e1e);
    --pi-fg: var(--vscode-foreground, #cccccc);
    --pi-fg-muted: var(--vscode-descriptionForeground, #999999);
    --pi-border: var(--vscode-widget-border, #3c3c3c);
    --pi-input-bg: var(--vscode-input-background, #2d2d2d);
    --pi-input-fg: var(--vscode-input-foreground, #cccccc);
    --pi-input-border: var(--vscode-input-border, #3c3c3c);
    --pi-focus: var(--vscode-focusBorder, #007fd4);
    --pi-accent: var(--vscode-charts-blue, #3794ff);
    --pi-accent-dim: rgba(55, 148, 255, 0.12);
    --pi-error: var(--vscode-errorForeground, #f44747);
    --pi-success: var(--vscode-charts-green, #89d185);
    --pi-code-bg: var(--vscode-textCodeBlock-background, #1e1e1e);
    --pi-surface: var(--vscode-editor-inactiveSelectionBackground, #2a2d2e);
    --pi-hover: var(--vscode-list-hoverBackground, #2a2d2e);
    --pi-button-bg: var(--vscode-button-background, #0e639c);
    --pi-button-fg: var(--vscode-button-foreground, #ffffff);
    --pi-button-hover: var(--vscode-button-hoverBackground, #1177bb);
    --pi-font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    --pi-font-mono: var(--vscode-editor-font-family, 'Cascadia Code', Consolas, 'Courier New', monospace);
    --pi-font-size: var(--vscode-font-size, 13px);
    --pi-radius: 8px;
    --pi-radius-lg: 12px;
    --pi-shadow: 0 1px 2px rgba(0,0,0,0.3);
    --pi-transition: 150ms ease;
}

html, body {
    height: 100%; width: 100%; overflow: hidden;
    font-family: var(--pi-font); font-size: var(--pi-font-size);
    color: var(--pi-fg); background: var(--pi-bg);
    line-height: 1.5; -webkit-font-smoothing: antialiased;
}

#app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

/* ── Header ── */
#header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; border-bottom: 1px solid var(--pi-border);
    background: var(--pi-bg); flex-shrink: 0; min-height: 38px; z-index: 10;
}
#header-left { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; }
#model-icon {
    width: 18px; height: 18px; border-radius: 50%;
    background: linear-gradient(135deg, var(--pi-accent), #a855f7);
    flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    font-size: 10px; color: #fff; font-weight: 700;
}
#model-name { font-size: 12px; font-weight: 600; color: var(--pi-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#header-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.icon-btn {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border: none; background: transparent;
    color: var(--pi-fg-muted); border-radius: 6px; cursor: pointer;
    transition: all var(--pi-transition); flex-shrink: 0;
}
.icon-btn:hover { background: var(--pi-hover); color: var(--pi-fg); }
.icon-btn svg { width: 16px; height: 16px; fill: currentColor; }

/* ── Messages ── */
#messages { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 12px; scroll-behavior: smooth; }
#messages::-webkit-scrollbar { width: 6px; }
#messages::-webkit-scrollbar-track { background: transparent; }
#messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
#messages::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

/* ── Empty state ── */
#empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 16px; padding: 24px; text-align: center; }
#empty-state .logo {
    width: 48px; height: 48px; border-radius: 14px;
    background: linear-gradient(135deg, var(--pi-accent), #a855f7);
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; color: #fff; font-weight: 700;
    box-shadow: 0 4px 16px rgba(55, 148, 255, 0.2);
}
#empty-state h2 { font-size: 16px; font-weight: 600; color: var(--pi-fg); margin: 0; }
#empty-state p { font-size: 12px; color: var(--pi-fg-muted); max-width: 260px; line-height: 1.5; }
#empty-state .shortcuts { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 4px; }
.shortcut-chip {
    display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px;
    background: var(--pi-surface); border: 1px solid var(--pi-border);
    border-radius: 16px; font-size: 11px; color: var(--pi-fg-muted);
    cursor: pointer; transition: all var(--pi-transition);
}
.shortcut-chip:hover { background: var(--pi-hover); color: var(--pi-fg); border-color: var(--pi-focus); }

/* ── Message bubbles ── */
.message { display: flex; flex-direction: column; margin-bottom: 16px; animation: messageIn 0.25s ease-out; }
@keyframes messageIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.message.user { align-items: flex-end; }
.message.assistant { align-items: flex-start; }

.message-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; padding: 0 4px; }
.message-avatar {
    width: 20px; height: 20px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700; flex-shrink: 0;
}
.message.user .message-avatar { background: var(--pi-accent); color: #fff; }
.message.assistant .message-avatar { background: linear-gradient(135deg, var(--pi-accent), #a855f7); color: #fff; }
.message-sender { font-size: 11px; font-weight: 600; color: var(--pi-fg-muted); text-transform: uppercase; letter-spacing: 0.3px; }
.message-time { font-size: 10px; color: var(--pi-fg-muted); opacity: 0.6; }

.message-body {
    max-width: 92%; padding: 10px 14px; border-radius: var(--pi-radius-lg);
    line-height: 1.6; word-wrap: break-word; overflow-wrap: break-word; position: relative;
}
.message.user .message-body {
    background: var(--pi-accent); color: #fff;
    border-bottom-right-radius: 4px; box-shadow: var(--pi-shadow);
}
.message.assistant .message-body {
    background: var(--pi-surface); color: var(--pi-fg);
    border: 1px solid var(--pi-border); border-bottom-left-radius: 4px;
}

.message-token-usage { display: flex; align-items: center; gap: 8px; margin-top: 6px; padding: 0 4px; font-size: 10px; color: var(--pi-fg-muted); opacity: 0.7; }
.token-badge { display: inline-flex; align-items: center; gap: 3px; background: rgba(255,255,255,0.05); padding: 1px 6px; border-radius: 4px; }

/* ── Markdown content ── */
.message-body h1, .message-body h2, .message-body h3,
.message-body h4, .message-body h5, .message-body h6 { margin: 12px 0 6px 0; font-weight: 600; line-height: 1.3; }
.message-body h1:first-child, .message-body h2:first-child, .message-body h3:first-child { margin-top: 0; }
.message-body h1 { font-size: 1.3em; }
.message-body h2 { font-size: 1.15em; }
.message-body h3 { font-size: 1.05em; }
.message-body p { margin: 6px 0; }
.message-body p:first-child { margin-top: 0; }
.message-body p:last-child { margin-bottom: 0; }
.message-body strong { font-weight: 600; }
.message-body em { font-style: italic; }
.message-body a { color: var(--pi-accent); text-decoration: none; }
.message-body a:hover { text-decoration: underline; }
.message-body ul, .message-body ol { margin: 6px 0; padding-left: 20px; }
.message-body li { margin: 3px 0; }
.message-body blockquote { margin: 8px 0; padding: 4px 12px; border-left: 3px solid var(--pi-accent); color: var(--pi-fg-muted); background: rgba(255,255,255,0.02); border-radius: 0 4px 4px 0; }
.message-body hr { border: none; border-top: 1px solid var(--pi-border); margin: 12px 0; }
.message-body table { border-collapse: collapse; margin: 8px 0; width: 100%; font-size: 12px; }
.message-body th, .message-body td { border: 1px solid var(--pi-border); padding: 6px 10px; text-align: left; }
.message-body th { background: rgba(255,255,255,0.04); font-weight: 600; }
.message-body code:not(.code-block-wrapper code) {
    background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 4px;
    font-family: var(--pi-font-mono); font-size: 0.9em; border: 1px solid rgba(255,255,255,0.06);
}
.message.user .message-body code:not(.code-block-wrapper code) { background: rgba(255,255,255,0.2); border-color: rgba(255,255,255,0.1); }

/* ── Code blocks ── */
.code-block-wrapper { position: relative; margin: 10px 0; border-radius: var(--pi-radius); overflow: hidden; border: 1px solid var(--pi-border); background: var(--pi-code-bg); }
.code-block-header { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: rgba(255,255,255,0.04); border-bottom: 1px solid var(--pi-border); }
.code-block-lang { font-size: 11px; font-family: var(--pi-font-mono); color: var(--pi-fg-muted); text-transform: lowercase; font-weight: 500; }
.code-block-copy {
    display: flex; align-items: center; gap: 4px; padding: 3px 8px; border: none;
    background: rgba(255,255,255,0.06); color: var(--pi-fg-muted); border-radius: 4px;
    cursor: pointer; font-size: 11px; font-family: var(--pi-font); transition: all var(--pi-transition);
}
.code-block-copy:hover { background: rgba(255,255,255,0.12); color: var(--pi-fg); }
.code-block-copy.copied { color: var(--pi-success); }
.code-block-copy svg { width: 12px; height: 12px; fill: currentColor; }
.code-block-wrapper pre { margin: 0; padding: 12px; overflow-x: auto; font-family: var(--pi-font-mono); font-size: 12px; line-height: 1.55; tab-size: 4; }
.code-block-wrapper pre::-webkit-scrollbar { height: 4px; }
.code-block-wrapper pre::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
.code-block-wrapper pre code { font-family: inherit; font-size: inherit; color: #d4d4d4; background: none; padding: 0; border: none; }

/* Syntax highlighting tokens */
.tk-kw { color: #569cd6; }
.tk-str { color: #ce9178; }
.tk-num { color: #b5cea8; }
.tk-cmt { color: #6a9955; font-style: italic; }
.tk-fn { color: #dcdcaa; }
.tk-type { color: #4ec9b0; }

/* ── Thinking indicator ── */
#thinking { display: none; align-items: center; gap: 10px; padding: 10px 14px; margin-bottom: 12px; animation: messageIn 0.2s ease-out; }
#thinking.visible { display: flex; }
.thinking-avatar {
    width: 20px; height: 20px; border-radius: 50%;
    background: linear-gradient(135deg, var(--pi-accent), #a855f7);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.thinking-dots { display: flex; align-items: center; gap: 4px; }
.thinking-dots span { width: 6px; height: 6px; background: var(--pi-fg-muted); border-radius: 50%; animation: thinkPulse 1.4s ease-in-out infinite; }
.thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
.thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes thinkPulse { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }
.thinking-label { font-size: 12px; color: var(--pi-fg-muted); font-style: italic; }

/* ── Input area ── */
#input-area { flex-shrink: 0; padding: 10px 12px; border-top: 1px solid var(--pi-border); background: var(--pi-bg); }
#input-wrapper {
    position: relative; display: flex; align-items: flex-end; gap: 8px;
    background: var(--pi-input-bg); border: 1px solid var(--pi-input-border);
    border-radius: var(--pi-radius-lg); padding: 6px 6px 6px 12px;
    transition: border-color var(--pi-transition), box-shadow var(--pi-transition);
}
#input-wrapper:focus-within { border-color: var(--pi-focus); box-shadow: 0 0 0 1px var(--pi-focus); }
#input {
    flex: 1; background: transparent; color: var(--pi-input-fg); border: none; outline: none;
    font-family: var(--pi-font); font-size: var(--pi-font-size); line-height: 1.5;
    resize: none; min-height: 22px; max-height: 150px; padding: 4px 0;
}
#input::placeholder { color: var(--pi-fg-muted); opacity: 0.6; }
#send-btn {
    display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; border: none;
    background: var(--pi-button-bg); color: var(--pi-button-fg);
    border-radius: 8px; cursor: pointer; transition: all var(--pi-transition); flex-shrink: 0;
}
#send-btn:hover:not(:disabled) { background: var(--pi-button-hover); transform: scale(1.05); }
#send-btn:disabled { opacity: 0.4; cursor: default; }
#send-btn svg { width: 16px; height: 16px; fill: currentColor; }
#input-hints {
    display: flex; align-items: center; justify-content: space-between;
    margin-top: 6px; padding: 0 4px; font-size: 10px; color: var(--pi-fg-muted); opacity: 0.6;
}
#input-hints kbd {
    font-family: var(--pi-font-mono); font-size: 10px;
    background: rgba(255,255,255,0.06); padding: 0px 4px;
    border-radius: 3px; border: 1px solid rgba(255,255,255,0.08);
}

/* ── @mention autocomplete ── */
#mention-popup {
    display: none; position: absolute; bottom: 100%; left: 12px; right: 12px;
    max-height: 180px; overflow-y: auto; background: var(--pi-surface);
    border: 1px solid var(--pi-border); border-radius: var(--pi-radius);
    box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 100; margin-bottom: 4px;
}
#mention-popup.visible { display: block; }
.mention-item {
    display: flex; align-items: center; gap: 8px; padding: 6px 10px;
    cursor: pointer; font-size: 12px; transition: background var(--pi-transition);
}
.mention-item:hover, .mention-item.selected { background: var(--pi-hover); }
.mention-icon { width: 16px; height: 16px; fill: var(--pi-fg-muted); flex-shrink: 0; }
.mention-name { color: var(--pi-fg); font-weight: 500; }
.mention-path { color: var(--pi-fg-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Responsive ── */
@media (max-width: 300px) {
    .message-body { max-width: 98%; }
    #empty-state .shortcuts { display: none; }
    #input-hints { display: none; }
}`;
}

// ─── Webview Script ──────────────────────────────────────────────────────────

function getScript(_nonce: string): string {
    // NOTE: All backtick characters in this JS are avoided because the string
    // is embedded inside a TypeScript template literal. Use BT variable for
    // backtick character references.
    return `
(function() {
    'use strict';
    var vscode = acquireVsCodeApi();

    // DOM refs
    var messagesDiv = document.getElementById('messages');
    var thinkingEl = document.getElementById('thinking');
    var input = document.getElementById('input');
    var sendBtn = document.getElementById('send-btn');
    var clearBtn = document.getElementById('clear-btn');
    var modelNameEl = document.getElementById('model-name');
    var mentionPopup = document.getElementById('mention-popup');

    var isThinking = false;
    var history = [];
    var mentionItems = [];
    var mentionIndex = -1;
    var mentionStart = -1;
    // Backtick character for regex usage
    var BT = String.fromCharCode(96);

    // Restore state
    var prevState = vscode.getState();
    if (prevState && prevState.history && prevState.history.length > 0) {
        history = prevState.history;
        renderMessages(history);
    }

    // ── Escape HTML ──
    function escapeHtml(text) {
        var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(/[&<>"']/g, function(c) { return map[c]; });
    }

    // ── Markdown Renderer ──
    function renderMarkdown(text) {
        // 1) Extract fenced code blocks
        var codeBlocks = [];
        var tripleBT = BT + BT + BT;
        var cbRegex = new RegExp(tripleBT + '(\\\\w*)\\\\n?([\\\\s\\\\S]*?)' + tripleBT, 'g');
        var html = text.replace(cbRegex, function(_, lang, code) {
            var idx = codeBlocks.length;
            codeBlocks.push({ lang: lang || '', code: code.replace(/\\\\n$/, '') });
            return '\\x00CB_' + idx + '\\x00';
        });

        // 2) Extract inline code
        var inlineCodes = [];
        var inlineRegex = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');
        html = html.replace(inlineRegex, function(_, code) {
            var idx = inlineCodes.length;
            inlineCodes.push(code);
            return '\\x00IC_' + idx + '\\x00';
        });

        // 3) Escape HTML
        html = escapeHtml(html);

        // 4) Headers
        html = html.replace(/^######\\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\\s+(.+)$/gm, '<h1>$1</h1>');

        // 5) Horizontal rule
        html = html.replace(/^---+$/gm, '<hr>');

        // 6) Bold + italic combos
        html = html.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
        html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

        // 7) Links
        html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');

        // 8) Blockquotes
        html = html.replace(/^&gt;\\s+(.+)$/gm, '<blockquote>$1</blockquote>');

        // 9) Unordered lists
        html = html.replace(/^\\s*[-*+]\\s+(.+)$/gm, '<li>$1</li>');

        // 10) Ordered lists
        html = html.replace(/^\\s*\\d+\\.\\s+(.+)$/gm, '<oli>$1</oli>');

        // 11) Paragraphs & line breaks
        html = html.replace(/\\n\\n/g, '</p><p>');
        html = html.replace(/\\n/g, '<br>');
        html = '<p>' + html + '</p>';
        html = html.replace(/<p><\\/p>/g, '');
        html = html.replace(/<p>(<h[1-6]>)/g, '$1');
        html = html.replace(/(<\\/h[1-6]>)<\\/p>/g, '$1');
        html = html.replace(/<p>(<blockquote>)/g, '$1');
        html = html.replace(/(<\\/blockquote>)<\\/p>/g, '$1');
        html = html.replace(/<p>(<hr>)<\\/p>/g, '$1');

        // Wrap consecutive li's in ul/ol
        html = html.replace(/(<li>[\\s\\S]*?<\\/li>)/g, function(m) {
            if (m.indexOf('<oli>') === -1) return '<ul>' + m + '</ul>';
            return m;
        });
        html = html.replace(/<oli>(.*?)<\\/oli>/g, '<li>$1</li>');
        html = html.replace(/(<li>[\\s\\S]*?<\\/li>)/g, function(m) {
            return '<ol>' + m + '</ol>';
        });

        // 12) Restore code blocks
        var copyIconSvg = '<svg viewBox="0 0 16 16"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5z"/></svg>';

        window.__codeBlocks = [];
        for (var ci = 0; ci < codeBlocks.length; ci++) {
            var cb = codeBlocks[ci];
            window.__codeBlocks.push(cb.code);
            var escapedCode = escapeHtml(cb.code);
            var langLabel = cb.lang ? escapeHtml(cb.lang) : 'code';
            var highlighted = syntaxHighlight(escapedCode, cb.lang);
            var wrapper =
                '<div class="code-block-wrapper">' +
                '<div class="code-block-header">' +
                '<span class="code-block-lang">' + langLabel + '</span>' +
                '<button class="code-block-copy" onclick="window._copyCode(' + ci + ', this)">' + copyIconSvg + ' Copy</button>' +
                '</div>' +
                '<pre><code>' + highlighted + '</code></pre>' +
                '</div>';
            html = html.replace('\\x00CB_' + ci + '\\x00', wrapper);
        }

        // 13) Restore inline code
        for (var ii = 0; ii < inlineCodes.length; ii++) {
            html = html.replace('\\x00IC_' + ii + '\\x00', '<code>' + escapeHtml(inlineCodes[ii]) + '</code>');
        }

        return html;
    }

    // ── Syntax highlighting ──
    function syntaxHighlight(code, lang) {
        if (!lang) return code;
        // Comments: // and /* */
        code = code.replace(/(\\/\\/.*$)/gm, '<span class="tk-cmt">$1</span>');
        code = code.replace(/(\\/\\*[\\s\\S]*?\\*\\/)/g, '<span class="tk-cmt">$1</span>');
        // Strings: &quot; and &#039; (already HTML-escaped)
        code = code.replace(/(&quot;[^&]*?&quot;)/g, '<span class="tk-str">$1</span>');
        code = code.replace(/(&#039;[^&]*?&#039;)/g, '<span class="tk-str">$1</span>');
        // Keywords
        var keywords = [
            'const','let','var','function','return','if','else','for','while',
            'class','extends','new','this','import','export','from','default','async','await',
            'try','catch','finally','throw','typeof','instanceof','switch','case',
            'break','continue','yield','void','delete','debugger',
            'true','false','null','undefined',
            'interface','type','enum','static','abstract','readonly','as','is','keyof','never','any',
            'def','self','lambda','pass','raise','elif','except','not','and','or',
            'fn','mut','pub','mod','use','struct','impl','trait','where','match','crate','super','dyn',
            'SELECT','FROM','WHERE','INSERT','UPDATE','DELETE','JOIN','LEFT','RIGHT',
            'INNER','OUTER','GROUP','ORDER','BY','HAVING','LIMIT'
        ];
        var kwRegex = new RegExp('\\\\b(' + keywords.join('|') + ')\\\\b', 'g');
        code = code.replace(kwRegex, '<span class="tk-kw">$1</span>');
        // Numbers
        code = code.replace(/\\b(\\d+\\.?\\d*)\\b/g, '<span class="tk-num">$1</span>');
        // Function calls
        code = code.replace(/\\b([a-zA-Z_$][\\w$]*)\\s*(?=\\()/g, '<span class="tk-fn">$1</span>');
        return code;
    }

    // ── Copy code ──
    window._copyCode = function(idx, btn) {
        var code = (window.__codeBlocks && window.__codeBlocks[idx]) || '';
        navigator.clipboard.writeText(code).then(function() {
            btn.classList.add('copied');
            var checkSvg = '<svg viewBox="0 0 16 16"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>';
            btn.innerHTML = checkSvg + ' Copied!';
            setTimeout(function() {
                btn.classList.remove('copied');
                var copySvg = '<svg viewBox="0 0 16 16"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5z"/></svg>';
                btn.innerHTML = copySvg + ' Copy';
            }, 2000);
        });
    };

    // ── Render Messages ──
    function renderMessages(history) {
        window.__codeBlocks = [];
        if (!history || history.length === 0) {
            messagesDiv.innerHTML = '';
            messagesDiv.appendChild(createEmptyState());
            return;
        }

        var frag = document.createDocumentFragment();
        for (var i = 0; i < history.length; i++) {
            var msg = history[i];
            var el = document.createElement('div');
            el.className = 'message ' + msg.role;

            var isUser = msg.role === 'user';
            var avatar = isUser ? 'Y' : '\\u03C0';
            var sender = isUser ? 'You' : 'Pi Agent';
            var time = msg.timestamp ? formatTime(msg.timestamp) : '';

            var headerHtml = '<div class="message-header">' +
                '<div class="message-avatar">' + avatar + '</div>' +
                '<span class="message-sender">' + sender + '</span>' +
                (time ? '<span class="message-time">' + time + '</span>' : '') +
                '</div>';

            var bodyContent;
            if (isUser) {
                bodyContent = escapeHtml(msg.content).replace(/\\n/g, '<br>');
            } else {
                bodyContent = renderMarkdown(msg.content);
            }

            var bodyHtml = '<div class="message-body">' + bodyContent + '</div>';

            var tokenHtml = '';
            if (msg.tokenUsage && msg.tokenUsage.total) {
                tokenHtml = '<div class="message-token-usage">' +
                    '<span class="token-badge">' + msg.tokenUsage.total + ' tokens</span>' +
                    (msg.tokenUsage.prompt ? '<span class="token-badge">&uarr; ' + msg.tokenUsage.prompt + '</span>' : '') +
                    (msg.tokenUsage.completion ? '<span class="token-badge">&darr; ' + msg.tokenUsage.completion + '</span>' : '') +
                    '</div>';
            }

            el.innerHTML = headerHtml + bodyHtml + tokenHtml;
            frag.appendChild(el);
        }

        messagesDiv.innerHTML = '';
        messagesDiv.appendChild(frag);
        scrollToBottom();
    }

    function createEmptyState() {
        var div = document.createElement('div');
        div.id = 'empty-state';
        div.innerHTML =
            '<div class="logo">\\u03C0</div>' +
            '<h2>Pi Agent</h2>' +
            '<p>Ask me anything about your code. I can explain, fix, refactor, and generate code.</p>' +
            '<div class="shortcuts">' +
            '<span class="shortcut-chip" data-msg="Explain the selected code">\\uD83D\\uDCA1 Explain</span>' +
            '<span class="shortcut-chip" data-msg="Fix errors in the code">\\uD83D\\uDD27 Fix</span>' +
            '<span class="shortcut-chip" data-msg="Refactor this code for better readability">\\u267B\\uFE0F Refactor</span>' +
            '<span class="shortcut-chip" data-msg="Generate tests for this code">\\uD83E\\uDDEA Test</span>' +
            '</div>';
        bindShortcutChips(div);
        return div;
    }

    function formatTime(ts) {
        var d = new Date(ts);
        var h = d.getHours().toString().padStart(2, '0');
        var m = d.getMinutes().toString().padStart(2, '0');
        return h + ':' + m;
    }

    function scrollToBottom() {
        requestAnimationFrame(function() {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        });
    }

    // ── Send ──
    function send() {
        var text = input.value.trim();
        if (!text || isThinking) return;
        vscode.postMessage({ type: 'send', text: text });
        input.value = '';
        autoResize();
        updateSendState();
        hideMentionPopup();
    }

    function updateSendState() {
        sendBtn.disabled = !input.value.trim() || isThinking;
    }

    function autoResize() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 150) + 'px';
    }

    // ── @mention ──
    function showMentionPopup(query) {
        vscode.postMessage({ type: 'listFiles', query: query });
    }

    function hideMentionPopup() {
        mentionPopup.classList.remove('visible');
        mentionPopup.innerHTML = '';
        mentionIndex = -1;
        mentionItems = [];
    }

    function updateMentionSelection() {
        var items = mentionPopup.querySelectorAll('.mention-item');
        for (var i = 0; i < items.length; i++) {
            items[i].classList.toggle('selected', i === mentionIndex);
        }
        if (mentionIndex >= 0 && items[mentionIndex]) {
            items[mentionIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    function insertMention(name) {
        var val = input.value;
        var before = val.substring(0, mentionStart);
        var after = val.substring(input.selectionStart);
        input.value = before + '@' + name + ' ' + after;
        hideMentionPopup();
        input.focus();
        var newPos = before.length + name.length + 2;
        input.setSelectionRange(newPos, newPos);
        autoResize();
        updateSendState();
    }

    function checkMention() {
        var val = input.value;
        var pos = input.selectionStart;
        var atPos = -1;
        for (var i = pos - 1; i >= 0; i--) {
            if (val[i] === '@') { atPos = i; break; }
            if (val[i] === ' ' || val[i] === '\\n') break;
        }
        if (atPos >= 0 && (atPos === 0 || val[atPos - 1] === ' ' || val[atPos - 1] === '\\n')) {
            mentionStart = atPos;
            var mentionQuery = val.substring(atPos + 1, pos);
            showMentionPopup(mentionQuery);
        } else {
            hideMentionPopup();
        }
    }

    // ── Event Listeners ──
    input.addEventListener('keydown', function(e) {
        if (mentionPopup.classList.contains('visible')) {
            if (e.key === 'ArrowDown') { e.preventDefault(); mentionIndex = Math.min(mentionIndex + 1, mentionItems.length - 1); updateMentionSelection(); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); mentionIndex = Math.max(mentionIndex - 1, 0); updateMentionSelection(); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { if (mentionIndex >= 0 && mentionItems[mentionIndex]) { e.preventDefault(); insertMention(mentionItems[mentionIndex].name); return; } }
            if (e.key === 'Escape') { e.preventDefault(); hideMentionPopup(); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    input.addEventListener('input', function() { autoResize(); updateSendState(); checkMention(); });
    sendBtn.addEventListener('click', send);
    clearBtn.addEventListener('click', function() { vscode.postMessage({ type: 'clear' }); });

    // Delegated shortcut chip clicks
    document.addEventListener('click', function(e) {
        var chip = e.target.closest('.shortcut-chip');
        if (chip) {
            var msg = chip.getAttribute('data-msg');
            if (msg) { input.value = msg; updateSendState(); input.focus(); }
        }
    });

    function bindShortcutChips(root) {
        var chips = root.querySelectorAll ? root.querySelectorAll('.shortcut-chip') : [];
        for (var c = 0; c < chips.length; c++) {
            (function(chip) {
                chip.addEventListener('click', function() {
                    var m = chip.getAttribute('data-msg');
                    if (m) { input.value = m; updateSendState(); input.focus(); }
                });
            })(chips[c]);
        }
    }

    // ── Messages from extension ──
    window.addEventListener('message', function(e) {
        var msg = e.data;
        switch (msg.type) {
            case 'init':
                if (msg.modelName) modelNameEl.textContent = msg.modelName;
                if (msg.history) { history = msg.history; vscode.setState({ history: history }); renderMessages(history); }
                break;
            case 'update':
                if (msg.history) { history = msg.history; vscode.setState({ history: history }); renderMessages(history); }
                break;
            case 'config':
                if (msg.modelName) modelNameEl.textContent = msg.modelName;
                break;
            case 'thinking':
                isThinking = true;
                updateSendState();
                thinkingEl.classList.add('visible');
                var empty = document.getElementById('empty-state');
                if (empty) empty.remove();
                scrollToBottom();
                break;
            case 'done':
                isThinking = false;
                updateSendState();
                thinkingEl.classList.remove('visible');
                break;
            case 'fileResults':
                mentionItems = msg.files || [];
                mentionIndex = mentionItems.length > 0 ? 0 : -1;
                if (mentionItems.length === 0) { hideMentionPopup(); return; }
                var fileIconSvg = '<svg class="mention-icon" viewBox="0 0 16 16"><path d="M3.75 1.5a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25V1.75z"/></svg>';
                var popupHtml = '';
                for (var fi = 0; fi < mentionItems.length; fi++) {
                    var f = mentionItems[fi];
                    popupHtml += '<div class="mention-item' + (fi === 0 ? ' selected' : '') + '" data-idx="' + fi + '">' +
                        fileIconSvg +
                        '<span class="mention-name">' + escapeHtml(f.name) + '</span>' +
                        '<span class="mention-path">' + escapeHtml(f.path || '') + '</span>' +
                        '</div>';
                }
                mentionPopup.innerHTML = popupHtml;
                mentionPopup.classList.add('visible');
                var mItems = mentionPopup.querySelectorAll('.mention-item');
                for (var mi = 0; mi < mItems.length; mi++) {
                    (function(item) {
                        item.addEventListener('click', function() {
                            var idx = parseInt(item.getAttribute('data-idx'));
                            if (mentionItems[idx]) insertMention(mentionItems[idx].name);
                        });
                    })(mItems[mi]);
                }
                break;
        }
    });

    // ── Initialize ──
    vscode.postMessage({ type: 'ready' });
    autoResize();
    updateSendState();
    bindShortcutChips(document);
})();
`;
}
