/**
 * Pi Agent VSCode Extension — Entry Point
 *
 * All agent logic is delegated to pi-agent-core through the bridge layer.
 */

import * as vscode from 'vscode';
import { createBridge } from './bridge';
import type { PiBridgeContext } from './bridge/types';
import { StatusBarManager } from './ui/statusBar';
import { InlineCompletionProvider } from './ui/inlineCompletion';
import { AgentsTreeProvider } from './ui/agentsTreeProvider';
import { ChangesTreeProvider } from './ui/changesTreeProvider';
import { TodoTreeProvider } from './ui/todoProvider';
import { Logger } from './utils/logger';
import { getConfig, onConfigChange } from './utils/config';
import { registerChatParticipant } from './chat/participant';
import { runCommand } from './chat/commands';

let bridge: PiBridgeContext;
let statusBar: StatusBarManager;
let logger: Logger;
let inlineCompletionDisposable: vscode.Disposable | undefined;
let todoProvider: TodoTreeProvider;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    logger = Logger.getInstance();
    logger.info('Pi Agent activating...');

    // ── Bridge (pi-agent-core AgentHarness) ───────────────────
    try {
        bridge = await createBridge(context);
        logger.info(`Bridge created: model=${bridge.chatModel.id}`);
    } catch (err: any) {
        logger.error(`Bridge creation failed: ${err.message}`);
        vscode.window.showErrorMessage(`Pi Agent failed to start: ${err.message}`);
        return;
    }

    // ── Todo provider ─────────────────────────────────────────
    todoProvider = new TodoTreeProvider();

    // ── Tree views (sidebar) ─────────────────────────────────
    const agentsProvider = new AgentsTreeProvider(bridge.harness as any);
    const changesProvider = new ChangesTreeProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('pi-agent.agentsView', agentsProvider),
        vscode.window.registerTreeDataProvider('pi-agent.changesView', changesProvider),
        vscode.window.registerTreeDataProvider('pi-agent.todoView', todoProvider),
        agentsProvider, changesProvider, todoProvider
    );

    // ── Status bar ───────────────────────────────────────────
    statusBar = new StatusBarManager(bridge.harness as any);
    context.subscriptions.push({ dispose: () => statusBar.dispose() });

    // ── Inline completions ───────────────────────────────────
    const inlineComp = new InlineCompletionProvider(bridge.harness);
    updateInlineCompletions(inlineComp);

    // ── Chat participant ─────────────────────────────────────
    const chatParticipant = registerChatParticipant(bridge, context.extensionUri);
    context.subscriptions.push(chatParticipant);
    logger.info('Chat participant registered: @pi');

    // ── Command palette commands ─────────────────────────────
    const commandOutput = logger.getChannel();
    context.subscriptions.push(commandOutput);

    context.subscriptions.push(
        vscode.commands.registerCommand('pi-agent.openChat', () => {
            vscode.commands.executeCommand('workbench.action.chat.open', '@pi');
        }),
        vscode.commands.registerCommand('pi-agent.explainCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            await runCommand(`Explain this ${lang} code:\n\`\`\`${lang}\n${code}\n\`\`\``, 'Explaining code', bridge.harness, commandOutput);
        }),
        vscode.commands.registerCommand('pi-agent.fixCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            await runCommand(`Fix errors in this ${lang} code:\n\`\`\`${lang}\n${code}\n\`\`\``, 'Fixing code', bridge.harness, commandOutput);
        }),
        vscode.commands.registerCommand('pi-agent.refactorCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection);
            if (!code) { vscode.window.showWarningMessage('Select code to refactor'); return; }
            const lang = editor.document.languageId;
            await runCommand(`Refactor this ${lang} code:\n\`\`\`${lang}\n${code}\n\`\`\``, 'Refactoring code', bridge.harness, commandOutput);
        }),
        vscode.commands.registerCommand('pi-agent.generateTests', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            await runCommand(`Generate tests for this ${lang} code:\n\`\`\`${lang}\n${code}\n\`\`\``, 'Generating tests', bridge.harness, commandOutput);
        }),
        vscode.commands.registerCommand('pi-agent.reviewCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            await runCommand(`Review this ${lang} code for issues:\n\`\`\`${lang}\n${code}\n\`\`\``, 'Reviewing code', bridge.harness, commandOutput);
        }),
        vscode.commands.registerCommand('pi-agent.generateCommitMessage', async () => {
            await runCommand('Generate a conventional commit message. Use git_status and git_diff_staged tools first.', 'Generating commit message', bridge.harness, commandOutput);
        }),
        vscode.commands.registerCommand('pi-agent.newSession', () => {
            vscode.window.showInformationMessage('π Agent: Session cleared');
        }),
        vscode.commands.registerCommand('pi-agent.toggleInlineSuggestions', () => {
            const config = getConfig();
            const newVal = !config.inlineSuggestions.enabled;
            vscode.workspace.getConfiguration('pi-agent').update('inlineSuggestions.enabled', newVal, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('π Inline Suggestions: ' + (newVal ? 'ON' : 'OFF'));
        }),
        vscode.commands.registerCommand('pi-agent.clearTodo', () => {
            todoProvider.clearAll();
            vscode.window.showInformationMessage('π Todo list cleared');
        })
    );

    // ── Config change listener ───────────────────────────────
    context.subscriptions.push(
        onConfigChange(() => {
            statusBar.refreshModel();
            updateInlineCompletions(inlineComp);
        })
    );

    // ── Track document changes for sidebar ───────────────────
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

    context.subscriptions.push({ dispose: () => bridge.dispose() });
    logger.info(`Pi Agent activated — model: ${bridge.chatModel.id}`);
}

function updateInlineCompletions(provider: InlineCompletionProvider): void {
    const config = getConfig();
    if (inlineCompletionDisposable) {
        inlineCompletionDisposable.dispose();
        inlineCompletionDisposable = undefined;
    }
    if (config.inlineSuggestions.enabled) {
        inlineCompletionDisposable = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            provider
        );
    }
}

export function deactivate(): void {
    logger?.info('Pi Agent deactivated');
    statusBar?.dispose();
    bridge?.dispose();
    logger?.dispose();
}
