/**
 * Command Bridge — registers agent commands as VSCode command palette actions.
 *
 * Maps high-level agent operations (explain, fix, refactor, etc.) to
 * VSCode commands that can be triggered from the command palette,
 * keyboard shortcuts, or context menus.
 *
 * Usage:
 *   registerAgentCommands(context, harness, outputChannel);
 */

import * as vscode from 'vscode';
import type { AgentHarness } from '@earendil-works/pi-agent-core/node';
import { runCommand } from '../chat/commands';

/**
 * Register all agent commands with the VSCode command palette.
 *
 * Each command:
 * 1. Gets the active editor context (if applicable)
 * 2. Constructs an appropriate prompt
 * 3. Sends it through the harness via runCommand()
 *
 * @param context - VSCode extension context for disposables
 * @param harness - The AgentHarness instance
 * @param output - Output channel for command results
 */
export function registerAgentCommands(
    context: vscode.ExtensionContext,
    harness: AgentHarness,
    output: vscode.OutputChannel
): void {
    context.subscriptions.push(
        // ── Chat ───────────────────────────────────────────
        vscode.commands.registerCommand('pi-agent.openChat', () => {
            vscode.commands.executeCommand('workbench.action.chat.open', '@pi');
        }),

        // ── Code actions (require active editor) ──────────
        vscode.commands.registerCommand('pi-agent.explainCode', () =>
            withActiveEditor('Explaining code', harness, output, (code, lang) =>
                `Explain this ${lang} code:\n\`\`\`${lang}\n${code}\n\`\`\``
            )
        ),
        vscode.commands.registerCommand('pi-agent.fixCode', () =>
            withActiveEditor('Fixing code', harness, output, (code, lang) =>
                `Fix errors in this ${lang} code:\n\`\`\`${lang}\n${code}\n\`\`\``
            )
        ),
        vscode.commands.registerCommand('pi-agent.refactorCode', () =>
            withSelectedCode('Refactoring code', harness, output, (code, lang) =>
                `Refactor this ${lang} code:\n\`\`\`${lang}\n${code}\n\`\`\``
            )
        ),
        vscode.commands.registerCommand('pi-agent.generateTests', () =>
            withActiveEditor('Generating tests', harness, output, (code, lang) =>
                `Generate tests for this ${lang} code:\n\`\`\`${lang}\n${code}\n\`\`\``
            )
        ),
        vscode.commands.registerCommand('pi-agent.reviewCode', () =>
            withActiveEditor('Reviewing code', harness, output, (code, lang) =>
                `Review this ${lang} code for issues:\n\`\`\`${lang}\n${code}\n\`\`\``
            )
        ),

        // ── Non-editor commands ───────────────────────────
        vscode.commands.registerCommand('pi-agent.generateCommitMessage', () =>
            runCommand(
                'Generate a conventional commit message. Use git_status and git_diff_staged tools first.',
                'Generating commit message', harness, output
            )
        ),
        vscode.commands.registerCommand('pi-agent.newSession', () => {
            vscode.window.showInformationMessage('π Agent: Session cleared');
        }),
    );
}

/**
 * Run a command with the active editor's content (full file or selection).
 */
async function withActiveEditor(
    label: string,
    harness: AgentHarness,
    output: vscode.OutputChannel,
    buildPrompt: (code: string, lang: string) => string
): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }
    const code = editor.document.getText(editor.selection) || editor.document.getText();
    const lang = editor.document.languageId;
    await runCommand(buildPrompt(code, lang), label, harness, output);
}

/**
 * Run a command with only the selected code (requires selection).
 */
async function withSelectedCode(
    label: string,
    harness: AgentHarness,
    output: vscode.OutputChannel,
    buildPrompt: (code: string, lang: string) => string
): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }
    const code = editor.document.getText(editor.selection);
    if (!code) {
        vscode.window.showWarningMessage('Select code first');
        return;
    }
    const lang = editor.document.languageId;
    await runCommand(buildPrompt(code, lang), label, harness, output);
}
