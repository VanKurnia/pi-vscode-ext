import * as vscode from 'vscode';
import { PiAgentManager } from '../agent/manager';
import { buildContextString } from '../utils/context';

/**
 * Slash command handler for the ChatParticipant.
 * Routes /commands to the appropriate manager method.
 */
export async function handleSlashCommand(
    command: string,
    prompt: string,
    stream: vscode.ChatResponseStream,
    manager: PiAgentManager
): Promise<vscode.ChatResult> {
    const ctx = await buildContextString();

    const getEditorCode = (): { code: string; lang: string } | null => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return null;
        const code = editor.document.getText(editor.selection) || editor.document.getText();
        return { code, lang: editor.document.languageId };
    };

    switch (command) {
        case 'explain': {
            const ed = getEditorCode();
            if (!ed || !ed.code) { stream.markdown('⚠️ No code selected. Select code in the editor first.'); return {}; }
            stream.progress('Explaining code...');
            await manager.processUserMessage('Explain this ' + ed.lang + ' code:\n```' + ed.lang + '\n' + ed.code + '\n```', ctx);
            return {};
        }
        case 'fix': {
            const ed = getEditorCode();
            if (!ed || !ed.code) { stream.markdown('⚠️ No code selected.'); return {}; }
            stream.progress('Analyzing code...');
            await manager.processUserMessage('Fix errors in this ' + ed.lang + ' code:\n```' + ed.lang + '\n' + ed.code + '\n```', ctx);
            return {};
        }
        case 'refactor': {
            const ed = getEditorCode();
            if (!ed || !ed.code) { stream.markdown('⚠️ No code selected.'); return {}; }
            stream.progress('Refactoring...');
            await manager.processUserMessage('Refactor this ' + ed.lang + ' code:\n```' + ed.lang + '\n' + ed.code + '\n```', ctx);
            return {};
        }
        case 'test': {
            const ed = getEditorCode();
            if (!ed || !ed.code) { stream.markdown('⚠️ No code selected.'); return {}; }
            stream.progress('Generating tests...');
            await manager.processUserMessage('Generate tests for this ' + ed.lang + ' code:\n```' + ed.lang + '\n' + ed.code + '\n```', ctx);
            return {};
        }
        case 'review': {
            const ed = getEditorCode();
            if (!ed || !ed.code) { stream.markdown('⚠️ No code selected.'); return {}; }
            stream.progress('Reviewing code...');
            await manager.processUserMessage('Review this ' + ed.lang + ' code for issues:\n```' + ed.lang + '\n' + ed.code + '\n```', ctx);
            return {};
        }
        case 'commit': {
            stream.progress('Generating commit message...');
            await manager.processUserMessage('Generate a conventional commit message. Use git_status and git_diff_staged first.', ctx);
            return {};
        }
        case 'plan': {
            const enabled = manager.togglePlanMode();
            stream.markdown('**Plan Mode:** ' + (enabled ? '✅ ON' : '❌ OFF') + '\n\n');
            if (prompt.trim()) {
                stream.progress('Creating plan...');
                await manager.processUserMessage('Create a detailed step-by-step plan for: ' + prompt, ctx);
            }
            return {};
        }
        case 'scout': {
            if (!prompt.trim()) { stream.markdown('Usage: `/scout <what to investigate>`'); return {}; }
            stream.progress('Scouting...');
            await manager.processAgentMessage('scout', prompt);
            return {};
        }
        case 'research': {
            if (!prompt.trim()) { stream.markdown('Usage: `/research <topic>`'); return {}; }
            stream.progress('Researching...');
            await manager.processAgentMessage('researcher', prompt);
            return {};
        }
        case 'clear': {
            manager.clear();
            stream.markdown('✅ Session cleared.\n');
            return {};
        }
        default: {
            stream.markdown('Unknown command: `/' + command + '`\n\n');
            stream.markdown(helpMarkdown());
            return {};
        }
    }
}

/** Help text for available commands */
export function helpMarkdown(): string {
    return [
        '**Available Commands:**',
        '',
        '| Command | Description |',
        '|---------|-------------|',
        '| `/explain` | Explain selected code |',
        '| `/fix` | Fix errors in selected code |',
        '| `/refactor` | Refactor selected code |',
        '| `/test` | Generate tests for selected code |',
        '| `/review` | Review code for issues |',
        '| `/commit` | Generate commit message |',
        '| `/plan [task]` | Toggle plan mode |',
        '| `/scout <query>` | Codebase reconnaissance |',
        '| `/research <topic>` | Research a topic |',
        '| `/clear` | Clear chat history |',
        '',
    ].join('\n');
}

/**
 * Run a prompt through the manager and stream output to an OutputChannel.
 * Used by command palette commands (explainCode, fixCode, etc.)
 */
export async function runCommand(
    prompt: string,
    label: string,
    manager: PiAgentManager,
    commandOutput: vscode.OutputChannel
): Promise<void> {
    commandOutput.clear();
    commandOutput.appendLine('⏳ ' + label + '...\n');

    const handler = (event: any) => {
        switch (event.type) {
            case 'streamChunk':
                if (event.data.content) { commandOutput.append(event.data.content); }
                break;
            case 'toolCall':
                commandOutput.appendLine('\n⚡ Tool: ' + event.data.name);
                break;
            case 'toolResult':
                commandOutput.appendLine(event.data.isError ? '  ❌ Error' : '  ✅ Done');
                break;
            case 'assistantMessage':
                if (event.data.content) { commandOutput.appendLine('\n' + event.data.content); }
                break;
            case 'error':
                commandOutput.appendLine('\n❌ Error: ' + event.data.message);
                break;
        }
    };
    manager.on('event', handler);

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'π ' + label },
        async () => {
            await manager.processUserMessage(prompt, await buildContextString());
        }
    );

    manager.removeListener('event', handler);
    commandOutput.appendLine('\n✅ Done. View full output: Pi Agent channel');
    commandOutput.show(true);
}
