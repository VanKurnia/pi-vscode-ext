import * as vscode from 'vscode';
import { PiAgentManager } from './agent/manager';
import { LlmClient } from './agent/client';
import { StatusBarManager } from './ui/statusBar';
import { InlineCompletionProvider } from './ui/inlineCompletion';
import { AgentsTreeProvider } from './ui/agentsTreeProvider';
import { ChangesTreeProvider } from './ui/changesTreeProvider';
import { TodoTreeProvider } from './ui/todoProvider';
import { SkillDiscovery } from './agent/skills';
import { Logger } from './utils/logger';
import { getConfig, onConfigChange } from './utils/config';
import { resetBashGuard } from './tools/bashGuard';
import { buildContextString } from './utils/context';
import { registerChatParticipant } from './chat/participant';
import { runCommand } from './chat/commands';

let manager: PiAgentManager;
let statusBar: StatusBarManager;
let logger: Logger;
let inlineCompletionProvider: InlineCompletionProvider;
let inlineCompletionDisposable: vscode.Disposable | undefined;
let todoProvider: TodoTreeProvider;
let skillDiscovery: SkillDiscovery;

export function activate(context: vscode.ExtensionContext): void {
    logger = Logger.getInstance();
    logger.info('Pi Agent activating...');

    // ── Skill discovery ────────────────────────────────────────
    skillDiscovery = new SkillDiscovery();
    const skillDirs = SkillDiscovery.getDefaultDirectories();
    skillDiscovery.discoverSkills(skillDirs).catch(err => {
        logger.warn('Skill discovery failed: ' + err.message);
    });

    // ── Todo provider ──────────────────────────────────────────
    todoProvider = new TodoTreeProvider();

    // ── Manager (with skill + todo deps) ───────────────────────
    manager = new PiAgentManager({ skillDiscovery, todoProvider });

    // ── Tree views (sidebar) ──────────────────────────────────
    const agentsProvider = new AgentsTreeProvider(manager);
    const changesProvider = new ChangesTreeProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('pi-agent.agentsView', agentsProvider),
        vscode.window.registerTreeDataProvider('pi-agent.changesView', changesProvider),
        vscode.window.registerTreeDataProvider('pi-agent.todoView', todoProvider),
        agentsProvider,
        changesProvider,
        todoProvider,
        skillDiscovery
    );

    // ── Status bar ────────────────────────────────────────────
    statusBar = new StatusBarManager(manager);
    context.subscriptions.push({ dispose: () => statusBar.dispose() });

    // ── Inline completions ────────────────────────────────────
    const client = new LlmClient();
    inlineCompletionProvider = new InlineCompletionProvider(client);
    updateInlineCompletions();

    // ── Chat participant ──────────────────────────────────────
    const chatParticipant = registerChatParticipant(manager, context.extensionUri);
    context.subscriptions.push(chatParticipant);
    logger.info('Chat participant registered');

    // ── Command palette commands ──────────────────────────────
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
            await runCommand('Explain this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', 'Explaining code', manager, commandOutput);
        }),
        vscode.commands.registerCommand('pi-agent.fixCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            await runCommand('Fix errors in this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', 'Fixing code', manager, commandOutput);
        }),
        vscode.commands.registerCommand('pi-agent.refactorCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection);
            if (!code) { vscode.window.showWarningMessage('Select code to refactor'); return; }
            const lang = editor.document.languageId;
            await runCommand('Refactor this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', 'Refactoring code', manager, commandOutput);
        }),
        vscode.commands.registerCommand('pi-agent.generateTests', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            await runCommand('Generate tests for this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', 'Generating tests', manager, commandOutput);
        }),
        vscode.commands.registerCommand('pi-agent.reviewCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
            const code = editor.document.getText(editor.selection) || editor.document.getText();
            const lang = editor.document.languageId;
            await runCommand('Review this ' + lang + ' code:\n```' + lang + '\n' + code + '\n```', 'Reviewing code', manager, commandOutput);
        }),
        vscode.commands.registerCommand('pi-agent.generateCommitMessage', async () => {
            await runCommand('Generate a conventional commit message. Use git_status and git_diff_staged tools first.', 'Generating commit message', manager, commandOutput);
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
        }),
        vscode.commands.registerCommand('pi-agent.clearTodo', () => {
            todoProvider.clearAll();
            vscode.window.showInformationMessage('π Todo list cleared');
        })
    );

    // ── Config change listener ────────────────────────────────
    context.subscriptions.push(
        onConfigChange(() => {
            statusBar.refreshModel();
            updateInlineCompletions();
            resetBashGuard();
        })
    );

    // ── Track document changes for sidebar ────────────────────
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
    logger.info('Skills: ' + skillDiscovery.getAllSkills().length + ' discovered');
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

export function deactivate(): void {
    logger?.info('Pi Agent deactivated');
    statusBar?.dispose();
    manager?.dispose();
    logger?.dispose();
}
