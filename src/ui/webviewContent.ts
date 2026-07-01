import * as vscode from 'vscode';

export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); }
    return text;
}

function getWebviewScript(): string {
    return `
    (function() {
        'use strict';
        const vscode = acquireVsCodeApi();
        const messagesDiv = document.getElementById('messages');
        const welcomeDiv = document.getElementById('welcome');
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        const statusEl = document.getElementById('status-bar');

        let isStreaming = false;
        let streamEl = null;
        let streamRaw = '';
        let toolCallEls = {};

        function esc(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

        function renderMd(text) {
            if (!text) return '';
            text = text.replace(/\\r\\n/g, '\\n');
            // Code blocks
            text = text.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, function(m, lang, code) {
                return '<div class="cb"><div class="cb-h"><span>' + esc(lang||'code') + '</span><button onclick="copyCode(this)">Copy</button></div><pre class="cb-c"><code>' + esc(code.trimEnd()) + '</code></pre></div>';
            });
            // Tables
            text = text.replace(/(^|\\n)(\\|.+(?:\\n\\|.+)*)/g, function(m, pfx, table) {
                var rows = table.split('\\n').filter(function(r){return r.trim();});
                if (rows.length < 2) return m;
                var html = '<div class="table-wrap"><table>';
                rows.forEach(function(row, i) {
                    var cells = row.split('|').filter(function(c){return c.trim() !== '';});
                    if (cells.length && cells.every(function(c){return /^[-:\\s]+$/.test(c.trim());})) return;
                    var tag = i === 0 ? 'th' : 'td';
                    html += '<tr>' + cells.map(function(c){return '<'+tag+'>'+c.trim()+'</'+tag+'>';}).join('') + '</tr>';
                });
                html += '</table></div>';
                return pfx + html;
            });
            // Inline code
            text = text.replace(/\`([^\\n\`]+)\`/g, '<code class="ic">$1</code>');
            // Bold + italic
            text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
            text = text.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
            // Headers
            text = text.replace(/^### (.+)$/gm, '<h4>$1</h4>');
            text = text.replace(/^## (.+)$/gm, '<h3>$1</h3>');
            text = text.replace(/^# (.+)$/gm, '<h2>$1</h2>');
            // Links
            text = text.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');
            // Lists
            text = text.replace(/(^|\\n)([ \\t]*[-*+] .+(?:\\n[ \\t]*[-*+] .+)*)/g, function(m, pfx, list) {
                return pfx + '<ul>' + list.split('\\n').map(function(l){return '<li>'+l.replace(/^[ \\t]*[-*+] /,'')+'</li>';}).join('') + '</ul>';
            });
            text = text.replace(/(^|\\n)([ \\t]*\\d+\\. .+(?:\\n[ \\t]*\\d+\\. .+)*)/g, function(m, pfx, list) {
                return pfx + '<ol>' + list.split('\\n').map(function(l){return '<li>'+l.replace(/^[ \\t]*\\d+\\. /,'')+'</li>';}).join('') + '</ol>';
            });
            // Paragraphs
            text = text.split('\\n\\n').map(function(p) {
                p = p.trim();
                if (!p) return '';
                if (/^<(div|ul|ol|table|h[234])/.test(p)) return p;
                return '<p>' + p.replace(/\\n/g, '<br>') + '</p>';
            }).join('');
            return text;
        }

        window.copyCode = function(btn) {
            var code = btn.closest('.cb').querySelector('.cb-c');
            if (code) {
                navigator.clipboard.writeText(code.textContent);
                btn.textContent = 'Copied!';
                setTimeout(function(){btn.textContent='Copy';}, 1500);
            }
        };

        function hideWelcome() { if (welcomeDiv) welcomeDiv.style.display='none'; }
        function scroll() { requestAnimationFrame(function(){messagesDiv.scrollTop=messagesDiv.scrollHeight;}); }

        function addMsg(role, content, agent) {
            hideWelcome();
            var el = document.createElement('div');
            el.className = 'msg ' + role;
            var avatar = role==='user' ? 'U' : 'π';
            var name = role==='user' ? 'You' : (agent || 'Pi Agent');
            el.innerHTML = '<div class="msg-avatar">'+avatar+'</div><div class="msg-body"><div class="msg-name">'+esc(name)+'</div><div class="msg-content">'+renderMd(content)+'</div></div>';
            messagesDiv.appendChild(el);
            scroll();
            return el;
        }

        function addToolEl(name, args, status, id) {
            hideWelcome();
            var el = document.createElement('div');
            el.className = 'tool-card';
            var icon = {'read_file':'📄','write_file':'✏️','edit_file':'🔧','bash':'💻','grep':'🔍','find':'📁','git_status':'🔀','git_diff':'📊','git_diff_staged':'📊','git_add':'➕','git_commit':'💾','git_log':'📜','git_reset':'↩️','git_branch':'🌿','git_checkout':'🔀','git_show':'👁️','subagent':'🤖','ls':'📂','questionnaire':'❓'}[name] || '⚡';
            el.innerHTML = '<div class="tool-h" onclick="this.parentElement.classList.toggle(\'open\')"><span class="tool-icon">'+icon+'</span><span class="tool-name">'+esc(name)+'</span><span class="tool-status '+status+'">'+status+'</span><span class="tool-arrow">▶</span></div><div class="tool-body"></div>';
            el.dataset.toolId = id || name;
            messagesDiv.appendChild(el);
            toolCallEls[el.dataset.toolId] = el;
            scroll();
            return el;
        }

        function updateTool(id, status, result, error) {
            var el = toolCallEls[id];
            if (!el) return;
            var statusEl = el.querySelector('.tool-status');
            statusEl.className = 'tool-status '+status;
            statusEl.textContent = status;
            var body = el.querySelector('.tool-body');
            if (result) {
                var resText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                if (resText.length > 500) resText = resText.slice(0,500) + '...';
                body.innerHTML = '<pre class="tool-result">' + esc(resText) + '</pre>';
            }
            if (error) {
                body.innerHTML = '<pre class="tool-error">' + esc(error) + '</pre>';
            }
            el.classList.add('open');
            scroll();
        }

        function addError(text) {
            hideWelcome();
            var el = document.createElement('div');
            el.className = 'err-msg';
            el.innerHTML = '<span class="err-icon">⚠</span><span>'+esc(text)+'</span>';
            messagesDiv.appendChild(el);
            scroll();
        }

        function beginStream() {
            hideWelcome();
            isStreaming = true;
            sendBtn.disabled = true;
            streamRaw = '';
            var el = document.createElement('div');
            el.className = 'msg assistant';
            el.innerHTML = '<div class="msg-avatar">π</div><div class="msg-body"><div class="msg-name">Pi Agent</div><div class="msg-content streaming"></div></div>';
            messagesDiv.appendChild(el);
            streamEl = el.querySelector('.msg-content');
            scroll();
        }

        function appendStream(text) {
            if (!streamEl) beginStream();
            streamRaw += text;
            streamEl.innerHTML = renderMd(streamRaw);
            scroll();
        }

        function endStream() {
            if (streamEl) {
                streamEl.classList.remove('streaming');
                streamEl.innerHTML = renderMd(streamRaw);
                streamEl = null;
                streamRaw = '';
            }
            isStreaming = false;
            sendBtn.disabled = false;
            scroll();
        }

        function send() {
            var text = input.value.trim();
            if (!text || isStreaming) return;
            addMsg('user', text);
            vscode.postMessage({ type: 'userMessage', data: { text: text } });
            input.value = '';
            input.style.height = 'auto';
            input.focus();
        }

        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        });
        input.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 200) + 'px';
        });
        sendBtn.addEventListener('click', send);

        // Quick actions
        document.querySelectorAll('.qa').forEach(function(el) {
            el.addEventListener('click', function() {
                var cmd = el.dataset.cmd;
                input.value = cmd || '';
                input.focus();
                if (cmd && cmd.startsWith('/')) { /* just fill, user sends */ }
            });
        });

        window.addEventListener('message', function(event) {
            var msg = event.data;
            if (!msg || !msg.type) return;
            switch (msg.type) {
                case 'userMessage':
                    if (msg.data && msg.data.isCommand) { addMsg('user', msg.data.text); }
                    break;
                case 'streamStart': beginStream(); break;
                case 'streamChunk': appendStream(msg.data.text || ''); break;
                case 'streamEnd': endStream(); break;
                case 'assistantMessage':
                    if (msg.data && msg.data.text) { endStream(); addMsg('assistant', msg.data.text, msg.data.agent); }
                    break;
                case 'toolCall':
                    addToolEl(msg.data.name, msg.data.arguments, 'running', msg.data.id || msg.data.name);
                    break;
                case 'toolResult':
                    updateTool(msg.data.id || msg.data.name, 'done', msg.data.result, msg.data.error);
                    break;
                case 'error':
                    endStream();
                    addError(msg.data.message || 'Unknown error');
                    break;
                case 'clear':
                    messagesDiv.innerHTML = '';
                    toolCallEls = {};
                    if (welcomeDiv) welcomeDiv.style.display = '';
                    endStream();
                    break;
                case 'status':
                    statusEl.querySelector('.st-text').textContent = msg.data.text || 'Ready';
                    var dot = statusEl.querySelector('.st-dot');
                    dot.className = 'st-dot ' + (msg.data.state || '');
                    break;
            }
        });

        vscode.postMessage({ type: 'ready' });
        input.focus();
    })();`;
}

export function getChatWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    const csp = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; font-src ${csp}; img-src ${csp} https: data:; script-src 'nonce-${nonce}';">
<title>Pi Agent</title>
<style>
:root {
    --bg: var(--vscode-sideBar-background, #1e1e1e);
    --fg: var(--vscode-foreground, #cccccc);
    --muted: var(--vscode-descriptionForeground, #888);
    --input-bg: var(--vscode-input-background, #2d2d2d);
    --input-border: var(--vscode-input-border, #444);
    --hover: var(--vscode-list-hoverBackground, #2a2d2e);
    --link: var(--vscode-textLink-foreground, #4fc1ff);
    --accent: #6366f1;
    --accent2: #8b5cf6;
    --err: var(--vscode-errorForeground, #f44747);
    --success: #4ec9b0;
    --warn: #cca700;
    --radius: 8px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif); font-size: var(--vscode-font-size, 13px); color: var(--fg); background: var(--bg); line-height: 1.55; overflow: hidden; }

#app { display: flex; flex-direction: column; height: 100vh; }
#messages { flex: 1; overflow-y: auto; padding: 10px 12px; scroll-behavior: smooth; }

/* Welcome */
#welcome { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; padding: 20px; }
#welcome .logo { font-size: 40px; margin-bottom: 12px; background: linear-gradient(135deg, var(--accent), var(--accent2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800; }
#welcome h2 { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
#welcome p { font-size: 12px; color: var(--muted); max-width: 260px; }
.qa-grid { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; width: 100%; max-width: 280px; }
.qa { padding: 8px 10px; border-radius: var(--radius); background: var(--input-bg); border: 1px solid var(--input-border); font-size: 12px; color: var(--link); cursor: pointer; text-align: left; transition: all 0.15s; }
.qa:hover { background: var(--hover); border-color: var(--accent); }
.qa .qa-icon { display: block; font-size: 16px; margin-bottom: 2px; }
.qa .qa-label { font-weight: 500; }
.qa .qa-desc { color: var(--muted); font-size: 11px; }

/* Messages */
.msg { display: flex; gap: 8px; margin-bottom: 12px; animation: fadeIn 0.15s ease; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
.msg-avatar { flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; margin-top: 2px; }
.msg.user .msg-avatar { background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); }
.msg.assistant .msg-avatar { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; }
.msg-body { flex: 1; min-width: 0; }
.msg-name { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 3px; color: var(--muted); }
.msg-content { font-size: 13px; line-height: 1.6; }
.msg-content p { margin-bottom: 8px; }
.msg-content p:last-child { margin-bottom: 0; }
.msg-content h2 { font-size: 15px; font-weight: 700; margin: 12px 0 6px; }
.msg-content h3 { font-size: 14px; font-weight: 600; margin: 10px 0 4px; }
.msg-content h4 { font-size: 13px; font-weight: 600; margin: 8px 0 4px; }
.msg-content ul, .msg-content ol { margin: 6px 0 6px 20px; }
.msg-content li { margin-bottom: 2px; }
.msg-content a { color: var(--link); text-decoration: none; }
.msg-content a:hover { text-decoration: underline; }
.msg-content strong { font-weight: 600; }
.msg-content .ic { background: var(--input-bg); padding: 1px 5px; border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
.msg-content.streaming::after { content: '▊'; animation: blink 0.8s step-end infinite; color: var(--accent); }
@keyframes blink { 50% { opacity: 0; } }

/* Code blocks */
.cb { margin: 8px 0; border-radius: var(--radius); overflow: hidden; border: 1px solid var(--input-border); }
.cb-h { display: flex; justify-content: space-between; align-items: center; padding: 4px 10px; background: var(--input-bg); font-size: 11px; color: var(--muted); }
.cb-h button { background: none; border: 1px solid var(--input-border); color: var(--muted); padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; }
.cb-h button:hover { color: var(--fg); border-color: var(--fg); }
.cb-c { padding: 10px 12px; overflow-x: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 1.5; background: var(--vscode-editor-background, #1e1e1e); }
.cb-c code { white-space: pre; }

/* Tables */
.table-wrap { margin: 8px 0; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { border: 1px solid var(--input-border); padding: 5px 8px; text-align: left; }
th { background: var(--input-bg); font-weight: 600; }

/* Tool cards */
.tool-card { margin: 6px 0; border-radius: var(--radius); border: 1px solid var(--input-border); overflow: hidden; animation: fadeIn 0.15s ease; }
.tool-h { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; background: var(--input-bg); user-select: none; }
.tool-h:hover { background: var(--hover); }
.tool-icon { font-size: 14px; }
.tool-name { font-size: 12px; font-weight: 600; font-family: var(--vscode-editor-font-family, monospace); flex: 1; }
.tool-status { font-size: 10px; padding: 1px 6px; border-radius: 10px; font-weight: 600; text-transform: uppercase; }
.tool-status.running { background: var(--warn); color: #000; }
.tool-status.done { background: var(--success); color: #000; }
.tool-status.error { background: var(--err); color: #fff; }
.tool-arrow { font-size: 10px; transition: transform 0.2s; color: var(--muted); }
.tool-card.open .tool-arrow { transform: rotate(90deg); }
.tool-body { display: none; padding: 8px 10px; font-size: 12px; }
.tool-card.open .tool-body { display: block; }
.tool-result { white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; padding: 6px 8px; background: var(--vscode-editor-background, #1e1e1e); border-radius: 4px; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; line-height: 1.4; }
.tool-error { color: var(--err); white-space: pre-wrap; padding: 6px 8px; background: rgba(244,71,71,0.08); border-radius: 4px; font-size: 11px; }

/* Error */
.err-msg { display: flex; align-items: flex-start; gap: 6px; padding: 8px 10px; margin: 6px 0; border-radius: var(--radius); background: rgba(244,71,71,0.1); border: 1px solid rgba(244,71,71,0.3); color: var(--err); font-size: 12px; animation: fadeIn 0.15s ease; }
.err-icon { font-size: 14px; flex-shrink: 0; }

/* Input area */
#input-area { padding: 8px 12px 6px; border-top: 1px solid var(--input-border); }
#input-wrap { display: flex; align-items: flex-end; gap: 6px; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: var(--radius); padding: 6px 8px; transition: border-color 0.15s; }
#input-wrap:focus-within { border-color: var(--accent); }
#chat-input { flex: 1; background: none; border: none; color: var(--fg); font-family: inherit; font-size: 13px; line-height: 1.5; resize: none; outline: none; min-height: 20px; max-height: 200px; }
#chat-input::placeholder { color: var(--muted); }
#send-btn { flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: var(--accent); border: none; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; transition: all 0.15s; }
#send-btn:hover { background: var(--accent2); }
#send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Status bar */
#status-bar { display: flex; align-items: center; gap: 6px; padding: 4px 12px; font-size: 11px; color: var(--muted); }
.st-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
.st-dot.thinking { background: var(--warn); animation: pulse 1s infinite; }
.st-dot.error { background: var(--err); }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--input-border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--muted); }
</style>
</head>
<body>
<div id="app">
    <div id="messages">
        <div id="welcome">
            <div class="logo">π Agent</div>
            <h2>How can I help you?</h2>
            <p>AI coding assistant with tools, agents, and more</p>
            <div class="qa-grid">
                <div class="qa" data-cmd="/explain">
                    <span class="qa-icon">💡</span>
                    <span class="qa-label">/explain</span>
                    <span class="qa-desc">Explain code</span>
                </div>
                <div class="qa" data-cmd="/fix">
                    <span class="qa-icon">🔧</span>
                    <span class="qa-label">/fix</span>
                    <span class="qa-desc">Fix errors</span>
                </div>
                <div class="qa" data-cmd="/test">
                    <span class="qa-icon">🧪</span>
                    <span class="qa-label">/test</span>
                    <span class="qa-desc">Generate tests</span>
                </div>
                <div class="qa" data-cmd="/review">
                    <span class="qa-icon">👁</span>
                    <span class="qa-label">/review</span>
                    <span class="qa-desc">Review code</span>
                </div>
                <div class="qa" data-cmd="/plan ">
                    <span class="qa-icon">📋</span>
                    <span class="qa-label">/plan</span>
                    <span class="qa-desc">Create plan</span>
                </div>
                <div class="qa" data-cmd="/commit">
                    <span class="qa-icon">💾</span>
                    <span class="qa-label">/commit</span>
                    <span class="qa-desc">Commit msg</span>
                </div>
            </div>
        </div>
    </div>
    <div id="input-area">
        <div id="input-wrap">
            <textarea id="chat-input" rows="1" placeholder="Ask Pi Agent... (/ for commands)" spellcheck="true"></textarea>
            <button id="send-btn" title="Send">▶</button>
        </div>
    </div>
    <div id="status-bar">
        <span class="st-dot"></span>
        <span class="st-text">Ready</span>
    </div>
</div>
<script nonce="${nonce}">${getWebviewScript()}</script>
</body>
</html>`;
}
