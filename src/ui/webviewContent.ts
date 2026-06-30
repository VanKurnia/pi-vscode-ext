/**
 * webviewContent.ts
 * Generates the self-contained HTML for the Pi Agent chat webview.
 * Features: message bubbles, code blocks with copy, tool call cards,
 * typing indicator, markdown rendering, responsive dark theme.
 */

import * as vscode from 'vscode';

/**
 * Generate a CSP nonce for script security.
 */
export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Returns the JavaScript code that runs inside the webview.
 * Separated to avoid template-literal escaping issues with regexes.
 */
function getWebviewScript(): string {
    return `
    (function() {
        'use strict';

        const vscode = acquireVsCodeApi();

        const messagesContainer = document.getElementById('messages-container');
        const messagesDiv = document.getElementById('messages');
        const welcomeDiv = document.getElementById('welcome');
        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        const typingIndicator = document.getElementById('typing-indicator');
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');

        let isStreaming = false;
        let currentStreamEl = null;

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function renderMarkdown(text) {
            if (!text) return '';

            // Normalize line endings
            text = text.replace(/\\r\\n/g, '\\n');

            // Code blocks (\`\`\`lang\\ncode\\n\`\`\`)
            text = text.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, function(match, lang, code) {
                var langLabel = lang || 'code';
                var escapedCode = escapeHtml(code.trimEnd());
                return '<div class="code-block-wrapper">' +
                    '<div class="code-block-header">' +
                        '<span class="code-block-lang">' + escapeHtml(langLabel) + '</span>' +
                        '<button class="code-block-copy" onclick="copyCode(this)">\\u29C9 Copy</button>' +
                    '</div>' +
                    '<code class="code-block-code">' + escapedCode + '</code>' +
                '</div>';
            });

            // Inline code
            text = text.replace(/\`([^\\n\`]+)\`/g, '<code>$1</code>');

            // Bold
            text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');

            // Italic
            text = text.replace(/\\*(.+?)\\*/g, '<em>$1</em>');

            // Links
            text = text.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

            // Unordered lists
            text = text.replace(/(^|\\n)([ \\t]*[-*+] .+(?:\\n[ \\t]*[-*+] .+)*)/g, function(match, prefix, list) {
                var items = list.split('\\n').map(function(line) {
                    return '<li>' + line.replace(/^[ \\t]*[-*+] /, '') + '</li>';
                }).join('');
                return prefix + '<ul>' + items + '</ul>';
            });

            // Ordered lists
            text = text.replace(/(^|\\n)([ \\t]*\\d+\\. .+(?:\\n[ \\t]*\\d+\\. .+)*)/g, function(match, prefix, list) {
                var items = list.split('\\n').map(function(line) {
                    return '<li>' + line.replace(/^[ \\t]*\\d+\\. /, '') + '</li>';
                }).join('');
                return prefix + '<ol>' + items + '</ol>';
            });

            // Paragraphs (double newline)
            text = text.split('\\n\\n').map(function(p) {
                p = p.trim();
                if (!p) return '';
                if (p.indexOf('<div') === 0 || p.indexOf('<ul') === 0 || p.indexOf('<ol') === 0 || p.indexOf('<h') === 0) {
                    return p;
                }
                return '<p>' + p.replace(/\\n/g, '<br>') + '</p>';
            }).join('');

            return text;
        }

        window.copyCode = function(btn) {
            var code = btn.closest('.code-block-wrapper').querySelector('.code-block-code');
            if (code) {
                navigator.clipboard.writeText(code.textContent);
                var orig = btn.textContent;
                btn.textContent = '\\u2713 Copied';
                setTimeout(function() { btn.textContent = orig; }, 1500);
            }
        };

        function ensureWelcomeHidden() {
            if (welcomeDiv) { welcomeDiv.style.display = 'none'; }
        }

        function scrollToBottom() {
            requestAnimationFrame(function() {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            });
        }

        function addMessage(role, content, meta) {
            ensureWelcomeHidden();
            var messageEl = document.createElement('div');
            messageEl.className = 'message ' + role;

            var avatarLabel = role === 'user' ? '\\uD83E\\uDDD1' : role === 'system' ? '\\u2699' : '\\u03C0';
            var headerLabel = role === 'user' ? 'You' : role === 'system' ? 'System' : 'Pi Agent';

            messageEl.innerHTML =
                '<div class="message-avatar">' + avatarLabel + '</div>' +
                '<div class="message-body">' +
                    '<div class="message-header">' + escapeHtml(headerLabel) + (meta ? ' \\u00B7 ' + escapeHtml(meta) : '') + '</div>' +
                    '<div class="message-content">' + renderMarkdown(content) + '</div>' +
                '</div>';

            messagesDiv.appendChild(messageEl);
            scrollToBottom();
            return messageEl;
        }

        function addToolCall(name, args, status, result) {
            ensureWelcomeHidden();
            var toolEl = document.createElement('div');
            toolEl.className = 'tool-call';

            var statusClass = status === 'running' ? 'running' : status === 'error' ? 'error' : 'success';
            var statusLabel = status === 'running' ? 'Running\\u2026' : status === 'error' ? 'Error' : 'Done';

            var bodyContent = '';
            if (args) {
                var argsStr = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
                bodyContent += '<div class="tool-input"><strong>Input:</strong>\\n' + escapeHtml(argsStr) + '</div>';
            }
            if (result) {
                var resStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                bodyContent += '\\n<div class="tool-output"><strong>Output:</strong>\\n' + escapeHtml(resStr) + '</div>';
            }

            toolEl.innerHTML =
                '<div class="tool-call-header" onclick="this.parentElement.classList.toggle(\\'expanded\\')">' +
                    '<span class="tool-call-icon">\\u26A1</span>' +
                    '<span class="tool-call-name">' + escapeHtml(name) + '</span>' +
                    '<span class="tool-call-status ' + statusClass + '">' + statusLabel + '</span>' +
                    '<span class="tool-call-chevron">\\u25B6</span>' +
                '</div>' +
                '<div class="tool-call-body">' + bodyContent + '</div>';

            messagesDiv.appendChild(toolEl);
            scrollToBottom();
            return toolEl;
        }

        function addError(text) {
            ensureWelcomeHidden();
            var errEl = document.createElement('div');
            errEl.className = 'error-message';
            errEl.textContent = text;
            messagesDiv.appendChild(errEl);
            scrollToBottom();
        }

        function beginStream() {
            ensureWelcomeHidden();
            isStreaming = true;
            sendBtn.disabled = true;

            var messageEl = document.createElement('div');
            messageEl.className = 'message assistant';

            messageEl.innerHTML =
                '<div class="message-avatar">\\u03C0</div>' +
                '<div class="message-body">' +
                    '<div class="message-header">Pi Agent</div>' +
                    '<div class="message-content streaming-cursor"></div>' +
                '</div>';

            messagesDiv.appendChild(messageEl);
            currentStreamEl = messageEl.querySelector('.message-content');
            scrollToBottom();
        }

        function appendStream(text) {
            if (!currentStreamEl) { beginStream(); }
            currentStreamEl.dataset.raw = (currentStreamEl.dataset.raw || '') + text;
            currentStreamEl.innerHTML = escapeHtml(currentStreamEl.dataset.raw);
            scrollToBottom();
        }

        function endStream() {
            if (currentStreamEl) {
                currentStreamEl.classList.remove('streaming-cursor');
                currentStreamEl.innerHTML = renderMarkdown(currentStreamEl.dataset.raw || '');
                currentStreamEl = null;
            }
            isStreaming = false;
            sendBtn.disabled = false;
            scrollToBottom();
        }

        function showTyping(show) {
            typingIndicator.classList.toggle('visible', show);
            if (show) { scrollToBottom(); }
        }

        function sendMessage() {
            var text = input.value.trim();
            if (!text || isStreaming) { return; }

            addMessage('user', text);
            vscode.postMessage({ type: 'userMessage', data: { text: text } });

            input.value = '';
            input.style.height = 'auto';
            input.focus();
        }

        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        input.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        sendBtn.addEventListener('click', sendMessage);

        var shortcuts = document.querySelectorAll('.shortcut[data-action]');
        for (var i = 0; i < shortcuts.length; i++) {
            (function(el) {
                el.addEventListener('click', function() {
                    var prompts = {
                        explain: '/explain',
                        fix: '/fix',
                        test: '/test',
                        refactor: '/refactor'
                    };
                    input.value = prompts[el.dataset.action] || '';
                    input.focus();
                });
            })(shortcuts[i]);
        }

        window.addEventListener('message', function(event) {
            var msg = event.data;
            if (!msg || !msg.type) { return; }

            switch (msg.type) {
                case 'agentResponse':
                    if (msg.data && msg.data.streaming) {
                        appendStream(msg.data.text || '');
                    } else {
                        endStream();
                        addMessage('assistant', msg.data.text || '', msg.data.meta);
                    }
                    break;

                case 'streamStart':
                    beginStream();
                    break;

                case 'streamChunk':
                    appendStream(msg.data.text || '');
                    break;

                case 'streamEnd':
                    endStream();
                    break;

                case 'toolCall':
                    addToolCall(
                        msg.data.name,
                        msg.data.arguments,
                        msg.data.status || 'running',
                        msg.data.result
                    );
                    break;

                case 'toolResult':
                    var toolCalls = messagesDiv.querySelectorAll('.tool-call');
                    var lastTool = toolCalls[toolCalls.length - 1];
                    if (lastTool && lastTool.querySelector('.tool-call-name').textContent === msg.data.name) {
                        var statusEl = lastTool.querySelector('.tool-call-status');
                        statusEl.className = 'tool-call-status ' + (msg.data.error ? 'error' : 'success');
                        statusEl.textContent = msg.data.error ? 'Error' : 'Done';
                        var bodyEl = lastTool.querySelector('.tool-call-body');
                        if (msg.data.result) {
                            var resText = typeof msg.data.result === 'string' ? msg.data.result : JSON.stringify(msg.data.result, null, 2);
                            bodyEl.innerHTML += '\\n<div class="tool-output"><strong>Output:</strong>\\n' + escapeHtml(resText) + '</div>';
                        }
                        if (msg.data.error) {
                            bodyEl.innerHTML += '\\n<div class="tool-input" style="color: var(--vscode-errorForeground)"><strong>Error:</strong>\\n' + escapeHtml(msg.data.error) + '</div>';
                        }
                        lastTool.classList.add('expanded');
                    }
                    break;

                case 'error':
                    endStream();
                    addError(msg.data.message || msg.data.text || 'An error occurred');
                    break;

                case 'clear':
                    messagesDiv.innerHTML = '';
                    if (welcomeDiv) { welcomeDiv.style.display = ''; }
                    endStream();
                    break;

                case 'status':
                    statusDot.className = 'status-dot ' + (msg.data.state || '');
                    statusText.textContent = msg.data.text || 'Ready';
                    showTyping(msg.data.state === 'thinking');
                    break;

                case 'typing':
                    showTyping(!!msg.data.show);
                    break;
            }
        });

        vscode.postMessage({ type: 'ready' });
    })();
    `;
}

/**
 * Returns the complete HTML content for the chat webview.
 */
export function getChatWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    const cspSource = webview.cspSource;
    const webviewScript = getWebviewScript();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src ${cspSource} 'unsafe-inline';
        font-src ${cspSource};
        img-src ${cspSource} https: data:;
        script-src 'nonce-${nonce}';
    ">
    <title>Pi Agent Chat</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
            height: 100%;
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--vscode-foreground, #cccccc);
            background: var(--vscode-sideBar-background, #1e1e1e);
            line-height: 1.5;
            overflow: hidden;
        }

        #app {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        #messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 12px 16px;
            scroll-behavior: smooth;
        }

        /* Welcome */
        #welcome {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            text-align: center;
            padding: 24px;
            opacity: 0.8;
        }
        #welcome .logo {
            font-size: 48px;
            margin-bottom: 16px;
        }
        #welcome h2 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground, #e0e0e0);
        }
        #welcome p {
            font-size: 13px;
            color: var(--vscode-descriptionForeground, #999);
            max-width: 280px;
            line-height: 1.6;
        }
        #welcome .shortcuts {
            margin-top: 20px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        #welcome .shortcut {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 4px;
            background: var(--vscode-input-background, #2d2d2d);
            border: 1px solid var(--vscode-input-border, #444);
            font-size: 12px;
            color: var(--vscode-textLink-foreground, #4fc1ff);
            cursor: pointer;
            transition: background 0.15s;
        }
        #welcome .shortcut:hover {
            background: var(--vscode-list-hoverBackground, #2a2d2e);
        }

        /* Messages */
        .message {
            display: flex;
            gap: 10px;
            margin-bottom: 16px;
            animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .message-avatar {
            flex-shrink: 0;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            font-weight: 700;
            margin-top: 2px;
        }
        .message.user .message-avatar {
            background: var(--vscode-badge-background, #4d4d4d);
            color: var(--vscode-badge-foreground, #fff);
        }
        .message.assistant .message-avatar {
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: #fff;
        }
        .message.system .message-avatar {
            background: var(--vscode-terminal-ansiYellow, #e5c07b);
            color: #1e1e1e;
        }

        .message-body {
            flex: 1;
            min-width: 0;
        }
        .message-header {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
            color: var(--vscode-descriptionForeground, #888);
        }
        .message-content {
            padding: 10px 14px;
            border-radius: 8px;
            line-height: 1.6;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        .message.user .message-content {
            background: var(--vscode-input-background, #2d2d2d);
            border: 1px solid var(--vscode-input-border, #444);
        }
        .message.assistant .message-content {
            background: var(--vscode-editor-inactiveSelectionBackground, #262626);
            border: 1px solid transparent;
        }
        .message.system .message-content {
            background: transparent;
            border: 1px dashed var(--vscode-input-border, #444);
            font-style: italic;
            font-size: 12px;
        }

        /* Markdown */
        .message-content p { margin-bottom: 8px; }
        .message-content p:last-child { margin-bottom: 0; }
        .message-content strong { font-weight: 600; }
        .message-content em { font-style: italic; }
        .message-content ul, .message-content ol {
            padding-left: 20px;
            margin-bottom: 8px;
        }
        .message-content li { margin-bottom: 2px; }
        .message-content a {
            color: var(--vscode-textLink-foreground, #4fc1ff);
            text-decoration: none;
        }
        .message-content a:hover { text-decoration: underline; }

        /* Inline code */
        .message-content code:not(.code-block-code) {
            font-family: var(--vscode-editor-font-family, 'Fira Code', monospace);
            font-size: 0.9em;
            padding: 1px 5px;
            border-radius: 3px;
            background: var(--vscode-textCodeBlock-background, #3c3c3c);
            color: var(--vscode-textPreformat-foreground, #e06c75);
        }

        /* Code blocks */
        .code-block-wrapper {
            position: relative;
            margin: 8px 0;
            border-radius: 6px;
            overflow: hidden;
            background: var(--vscode-editor-background, #1e1e1e);
            border: 1px solid var(--vscode-editorWidget-border, #444);
        }
        .code-block-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 8px;
            background: var(--vscode-editorWidget-background, #252526);
            border-bottom: 1px solid var(--vscode-editorWidget-border, #444);
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #888);
        }
        .code-block-lang {
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .code-block-copy {
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground, #888);
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: all 0.15s;
        }
        .code-block-copy:hover {
            background: var(--vscode-toolbar-hoverBackground, #3c3c3c);
            color: var(--vscode-foreground, #ccc);
        }
        .code-block-code {
            display: block;
            padding: 12px;
            overflow-x: auto;
            font-family: var(--vscode-editor-font-family, 'Fira Code', monospace);
            font-size: var(--vscode-editor-font-size, 13px);
            line-height: 1.5;
            color: var(--vscode-editor-foreground, #d4d4d4);
            tab-size: 4;
            white-space: pre;
        }

        /* Tool call cards */
        .tool-call {
            margin: 8px 0;
            border-radius: 6px;
            border: 1px solid var(--vscode-editorWidget-border, #444);
            overflow: hidden;
            background: var(--vscode-editorWidget-background, #252526);
        }
        .tool-call-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            cursor: pointer;
            user-select: none;
            transition: background 0.15s;
        }
        .tool-call-header:hover {
            background: var(--vscode-list-hoverBackground, #2a2d2e);
        }
        .tool-call-icon { font-size: 14px; }
        .tool-call-name {
            font-weight: 600;
            font-size: 12px;
            color: var(--vscode-textLink-foreground, #4fc1ff);
            flex: 1;
        }
        .tool-call-status {
            font-size: 11px;
            padding: 1px 6px;
            border-radius: 3px;
        }
        .tool-call-status.running {
            background: var(--vscode-progressBar-background, #0078d4);
            color: #fff;
        }
        .tool-call-status.success {
            background: var(--vscode-terminal-ansiGreen, #4ec9b0);
            color: #1e1e1e;
        }
        .tool-call-status.error {
            background: var(--vscode-errorForeground, #f44747);
            color: #fff;
        }
        .tool-call-chevron {
            font-size: 10px;
            transition: transform 0.2s;
            color: var(--vscode-descriptionForeground, #888);
        }
        .tool-call.expanded .tool-call-chevron {
            transform: rotate(90deg);
        }
        .tool-call-body {
            display: none;
            padding: 8px 12px;
            border-top: 1px solid var(--vscode-editorWidget-border, #444);
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            line-height: 1.5;
            max-height: 300px;
            overflow-y: auto;
            white-space: pre-wrap;
            color: var(--vscode-descriptionForeground, #aaa);
        }
        .tool-call.expanded .tool-call-body {
            display: block;
        }
        .tool-call-body .tool-input {
            color: var(--vscode-terminal-ansiYellow, #e5c07b);
        }
        .tool-call-body .tool-output {
            color: var(--vscode-foreground, #ccc);
        }

        /* Streaming cursor */
        .streaming-cursor::after {
            content: '\\25CA';
            animation: blink 0.8s step-end infinite;
            color: var(--vscode-editor-foreground, #ccc);
        }
        @keyframes blink {
            50% { opacity: 0; }
        }

        /* Typing indicator */
        .typing-indicator {
            display: none;
            align-items: center;
            gap: 10px;
            padding: 8px 0;
            margin-bottom: 16px;
        }
        .typing-indicator.visible {
            display: flex;
        }
        .typing-dots {
            display: flex;
            gap: 4px;
            padding: 8px 14px;
            background: var(--vscode-editor-inactiveSelectionBackground, #262626);
            border-radius: 8px;
        }
        .typing-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--vscode-descriptionForeground, #888);
            animation: typingBounce 1.4s ease-in-out infinite;
        }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typingBounce {
            0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
            30% { transform: translateY(-4px); opacity: 1; }
        }

        /* Status bar */
        .status-bar {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #888);
            border-top: 1px solid var(--vscode-panel-border, #333);
            background: var(--vscode-sideBar-background, #1e1e1e);
        }
        .status-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--vscode-terminal-ansiGreen, #4ec9b0);
        }
        .status-dot.thinking { background: var(--vscode-progressBar-background, #0078d4); animation: pulse 1.5s infinite; }
        .status-dot.error { background: var(--vscode-errorForeground, #f44747); }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }

        /* Input area */
        #input-area {
            padding: 12px 16px;
            border-top: 1px solid var(--vscode-panel-border, #333);
            background: var(--vscode-sideBar-background, #1e1e1e);
        }
        #input-wrapper {
            display: flex;
            align-items: flex-end;
            gap: 8px;
            background: var(--vscode-input-background, #2d2d2d);
            border: 1px solid var(--vscode-input-border, #444);
            border-radius: 8px;
            padding: 8px;
            transition: border-color 0.2s;
        }
        #input-wrapper:focus-within {
            border-color: var(--vscode-focusBorder, #0078d4);
        }
        #message-input {
            flex: 1;
            background: none;
            border: none;
            outline: none;
            color: var(--vscode-input-foreground, #ccc);
            font-family: var(--vscode-font-family, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            line-height: 1.5;
            resize: none;
            min-height: 20px;
            max-height: 120px;
            padding: 0;
        }
        #message-input::placeholder {
            color: var(--vscode-input-placeholderForeground, #666);
        }
        #send-btn {
            flex-shrink: 0;
            width: 32px;
            height: 32px;
            border: none;
            border-radius: 6px;
            background: var(--vscode-button-background, #0078d4);
            color: var(--vscode-button-foreground, #fff);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            transition: background 0.15s;
        }
        #send-btn:hover {
            background: var(--vscode-button-hoverBackground, #1a8cff);
        }
        #send-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background, #424242);
            border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground, #555);
        }

        /* Error */
        .error-message {
            background: rgba(244, 71, 71, 0.1);
            border: 1px solid var(--vscode-errorForeground, #f44747);
            color: var(--vscode-errorForeground, #f44747);
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            margin: 8px 0;
        }
    </style>
</head>
<body>
    <div id="app">
        <div id="messages-container">
            <div id="welcome">
                <div class="logo">&#x03C0;</div>
                <h2>Pi Agent</h2>
                <p>Ask me anything about your code. I can explain, fix, refactor, write tests, and more.</p>
                <div class="shortcuts">
                    <span class="shortcut" data-action="explain">&#x1F4A1; Explain code</span>
                    <span class="shortcut" data-action="fix">&#x1F527; Fix errors</span>
                    <span class="shortcut" data-action="test">&#x1F9EA; Write tests</span>
                    <span class="shortcut" data-action="refactor">&#x267B; Refactor</span>
                </div>
            </div>
            <div id="messages"></div>
            <div id="typing-indicator" class="typing-indicator">
                <div class="message-avatar" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; font-size: 14px; font-weight: 700;">&#x03C0;</div>
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        </div>
        <div id="input-area">
            <div id="input-wrapper">
                <textarea id="message-input"
                    rows="1"
                    placeholder="Ask Pi Agent&#x2026; (Shift+Enter for newline)"
                    autocomplete="off"
                    spellcheck="false"></textarea>
                <button id="send-btn" title="Send message (Enter)">&#x25B6;</button>
            </div>
        </div>
        <div class="status-bar">
            <span class="status-dot" id="status-dot"></span>
            <span id="status-text">Ready</span>
        </div>
    </div>

    <script nonce="${nonce}">
${webviewScript}
    </script>
</body>
</html>`;
}
