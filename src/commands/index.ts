import * as vscode from 'vscode';
import { PiAgentManager } from '../agent/manager';
import { Logger } from '../utils/logger';
import { buildContextString } from '../utils/context';

export function registerCommands(context: vscode.ExtensionContext, manager: PiAgentManager, logger: Logger): void {
    context.subscriptions.push(vscode.commands.registerCommand('pi-agent.openChat', () => {
        vscode.commands.executeCommand('pi-agent.chatView.focus');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pi-agent.explainCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
        const selection = editor.document.getText(editor.selection);
        const lang = editor.document.languageId;
        const fname = editor.document.fileName;
        const prompt = selection
            ? `Explain the following ${lang} code from \`${fname}\`:\n\n\`\`\`${lang}\n${selection}\n\`\`\``
            : `Explain the file \`${fname}\` and its purpose.`;
        await manager.processUserMessage(prompt, buildContextString());
        vscode.commands.executeCommand('pi-agent.chatView.focus');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pi-agent.fixCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
        const selection = editor.document.getText(editor.selection);
        if (!selection) { vscode.window.showWarningMessage('Select code to fix'); return; }
        const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
        const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error)
            .map(d => `Line ${d.range.start.line + 1}: ${d.message}`).join('\n');
        const prompt = `Fix this code${errors ? '\n\nErrors:\n' + errors : ''}:\n\n\`\`\`${editor.document.languageId}\n${selection}\n\`\`\``;
        await manager.processUserMessage(prompt, buildContextString());
        vscode.commands.executeCommand('pi-agent.chatView.focus');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pi-agent.refactorCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
        const selection = editor.document.getText(editor.selection);
        if (!selection) { vscode.window.showWarningMessage('Select code to refactor'); return; }
        const prompt = `Refactor this ${editor.document.languageId} code:\n\n\`\`\`${editor.document.languageId}\n${selection}\n\`\`\``;
        await manager.processUserMessage(prompt, buildContextString());
        vscode.commands.executeCommand('pi-agent.chatView.focus');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pi-agent.generateTests', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
        const code = editor.document.getText(editor.selection) || editor.document.getText();
        const prompt = `Generate comprehensive tests for \`${editor.document.fileName}\`:\n\n\`\`\`${editor.document.languageId}\n${code}\n\`\`\`\nInclude edge cases and error scenarios.`;
        await manager.processUserMessage(prompt, buildContextString());
        vscode.commands.executeCommand('pi-agent.chatView.focus');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pi-agent.reviewCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('No active editor'); return; }
        const code = editor.document.getText(editor.selection) || editor.document.getText();
        const prompt = `Review this code from \`${editor.document.fileName}\` for correctness, performance, security, and style:\n\n\`\`\`${editor.document.languageId}\n${code}\n\`\`\``;
        await manager.processUserMessage(prompt, buildContextString());
        vscode.commands.executeCommand('pi-agent.chatView.focus');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pi-agent.generateCommitMessage', async () => {
        await manager.processUserMessage('Generate a conventional commit message for staged changes. Run git_diff_staged first.', buildContextString());
        vscode.commands.executeCommand('pi-agent.chatView.focus');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pi-agent.showChanges', () => {
        vscode.commands.executeCommand('pi-agent.changesView.focus');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pi-agent.planMode', async () => {
        await manager.processUserMessage('Enter plan mode. Analyze the workspace and create a step-by-step implementation plan.', buildContextString());
        vscode.commands.executeCommand('pi-agent.chatView.focus');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pi-agent.showContext', () => {
        const ctx = manager.getSessionContext();
        const msg = `## Context Usage\n**Messages:** ${ctx.messageCount}\n**Est. Tokens:** ~${ctx.estimatedTokens}\n**Model:** ${ctx.model}`;
        manager.processUserMessage(msg, buildContextString());
        vscode.commands.executeCommand('pi-agent.chatView.focus');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pi-agent.newSession', () => {
        manager.clearSession();
        vscode.window.showInformationMessage('Pi Agent: New session started');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('pi-agent.toggleInlineSuggestions', () => {
        const config = vscode.workspace.getConfiguration('pi-agent');
        const current = config.get<boolean>('inlineSuggestions.enabled', false);
        config.update('inlineSuggestions.enabled', !current, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Pi Agent: Inline suggestions ${!current ? 'enabled' : 'disabled'}`);
    }));
}
