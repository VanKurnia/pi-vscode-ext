import * as vscode from 'vscode';
import type { AgentHarness } from '@earendil-works/pi-agent-core';

export class ChatPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'pi-agent.chatPanel';
    private view?: vscode.WebviewView;
    private harness: AgentHarness;
    private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        harness: AgentHarness
    ) {
        this.harness = harness;
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
        webviewView.webview.html = this.getHtml();
        webviewView.webview.onDidReceiveMessage(async (msg: any) => {
            if (msg.type === 'send') { await this.handleUserMessage(msg.text); }
            else if (msg.type === 'clear') { this.history = []; this.updateWebview(); }
        });
    }

    private async handleUserMessage(text: string): Promise<void> {
        if (!text.trim()) return;
        this.history.push({ role: 'user', content: text });
        this.updateWebview();
        this.postMessage({ type: 'thinking' });
        try {
            const response = await this.harness.prompt(text);
            const content = this.extractText(response);
            this.history.push({ role: 'assistant', content });
        } catch (err: any) {
            this.history.push({ role: 'assistant', content: `Error: ${err.message}` });
        }
        this.postMessage({ type: 'done' });
        this.updateWebview();
    }

    private extractText(response: any): string {
        if (typeof response === 'string') return response;
        if (response?.content) {
            if (typeof response.content === 'string') return response.content;
            if (Array.isArray(response.content)) {
                return response.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
            }
        }
        return JSON.stringify(response, null, 2);
    }

    private postMessage(msg: any): void { this.view?.webview.postMessage(msg); }
    private updateWebview(): void { this.postMessage({ type: 'update', history: this.history }); }

    private getHtml(): string {
        const nonce = getNonce();
        return /*html*/`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce ${nonce}';">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-panel-background);display:flex;flex-direction:column;height:100vh}
#messages{flex:1;overflow-y:auto;padding:12px}
.msg{margin-bottom:12px;display:flex;flex-direction:column}
.msg.user{align-items:flex-end}.msg.assistant{align-items:flex-start}
.bubble{max-width:85%;padding:8px 12px;border-radius:12px;line-height:1.5;word-wrap:break-word;white-space:pre-wrap}
.msg.user .bubble{background:var(--vscode-inputValidation-infoBorder);color:#fff;border-bottom-right-radius:4px}
.msg.assistant .bubble{background:var(--vscode-editor-inactiveSelectionBackground);color:var(--vscode-foreground);border-bottom-left-radius:4px}
.bubble code{background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px;font-family:var(--vscode-editor-font-family)}
.bubble pre{background:var(--vscode-textCodeBlock-background);padding:8px;border-radius:6px;overflow-x:auto;margin:4px 0}
.bubble pre code{background:none;padding:0}
.thinking{display:flex;align-items:center;gap:8px;padding:8px 12px;color:var(--vscode-descriptionForeground)}
.spinner{width:16px;height:16px;border:2px solid var(--vscode-descriptionForeground);border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
#input-area{display:flex;padding:8px 12px;gap:6px;border-top:1px solid var(--vscode-widget-border);background:var(--vscode-panel-background)}
#input{flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:6px;padding:6px 10px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);outline:none;resize:none}
#input:focus{border-color:var(--vscode-focusBorder)}
#send{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px}
#send:hover{background:var(--vscode-button-hoverBackground)}
#send:disabled{opacity:.5;cursor:default}
.placeholder{text-align:center;color:var(--vscode-descriptionForeground);padding:40px 20px;font-size:13px}
</style></head><body>
<div id="messages"><div class="placeholder">Ask Pi Agent anything...</div></div>
<div id="input-area">
<textarea id="input" rows="1" placeholder="Type a message..." autofocus></textarea>
<button id="send">Send</button>
</div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();
const messagesDiv=document.getElementById('messages');
const input=document.getElementById('input');
const sendBtn=document.getElementById('send');
let isThinking=false;
function escapeHtml(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML}
function renderMarkdown(t){
let h=escapeHtml(t);
h=h.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g,'<pre><code>$1</code></pre>');
h=h.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
h=h.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');
h=h.replace(/\\*(.+?)\\*/g,'<em>$1</em>');
return h}
function render(history){
if(!history||history.length===0){messagesDiv.innerHTML='<div class="placeholder">Ask Pi Agent anything...</div>';return}
messagesDiv.innerHTML=history.map(m=>'<div class="msg '+m.role+'"><div class="bubble">'+renderMarkdown(m.content)+'</div></div>').join('');
messagesDiv.scrollTop=messagesDiv.scrollHeight}
function send(){const t=input.value.trim();if(!t||isThinking)return;vscode.postMessage({type:'send',text:t});input.value='';autoResize()}
function autoResize(){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,120)+'px'}
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
input.addEventListener('input',autoResize);
sendBtn.addEventListener('click',send);
window.addEventListener('message',e=>{
const msg=e.data;
if(msg.type==='update')render(msg.history);
else if(msg.type==='thinking'){isThinking=true;sendBtn.disabled=true;const d=document.createElement('div');d.className='thinking';d.innerHTML='<div class="spinner"></div> Thinking...';messagesDiv.appendChild(d);messagesDiv.scrollTop=messagesDiv.scrollHeight}
else if(msg.type==='done'){isThinking=false;sendBtn.disabled=false;const t=messagesDiv.querySelector('.thinking');if(t)t.remove()}});
</script></body></html>`;
    }
    public dispose(): void {}
}

function getNonce(): string {
    let t = '';
    const p = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) t += p.charAt(Math.floor(Math.random() * p.length));
    return t;
}
