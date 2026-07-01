/**
 * Slash command handler for the ChatParticipant.
 * Routes /commands to AgentHarness.prompt() with appropriate prompts.
 */

import * as vscode from 'vscode';
import type { AgentHarness } from '@earendil-works/pi-agent-core/node';
import { streamFromHarness } from '../bridge/stream-bridge';
import type { PlanModeManager } from './planMode';
import type { SpeedTracker } from '../tools/speedMeter';

const noopToken: vscode.CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} }),
};

function getEditorCode(): { code: string; lang: string } | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    const code = editor.document.getText(editor.selection) || editor.document.getText();
    return { code, lang: editor.document.languageId };
}

export async function handleSlashCommand(
    command: string,
    prompt: string,
    stream: vscode.ChatResponseStream,
    harness: AgentHarness,
    planMode?: PlanModeManager,
    speedTracker?: SpeedTracker
): Promise<vscode.ChatResult> {
    switch (command) {
        case 'explain': {
            const ed = getEditorCode();
            if (!ed?.code) { stream.markdown('⚠️ No code selected.'); return {}; }
            await streamFromHarness(harness, `Explain this ${ed.lang} code:\n\`\`\`${ed.lang}\n${ed.code}\n\`\`\``, stream, noopToken);
            return {};
        }
        case 'fix': {
            const ed = getEditorCode();
            if (!ed?.code) { stream.markdown('⚠️ No code selected.'); return {}; }
            await streamFromHarness(harness, `Fix errors in this ${ed.lang} code:\n\`\`\`${ed.lang}\n${ed.code}\n\`\`\``, stream, noopToken);
            return {};
        }
        case 'refactor': {
            const ed = getEditorCode();
            if (!ed?.code) { stream.markdown('⚠️ No code selected.'); return {}; }
            await streamFromHarness(harness, `Refactor this ${ed.lang} code:\n\`\`\`${ed.lang}\n${ed.code}\n\`\`\``, stream, noopToken);
            return {};
        }
        case 'test': {
            const ed = getEditorCode();
            if (!ed?.code) { stream.markdown('⚠️ No code selected.'); return {}; }
            await streamFromHarness(harness, `Generate tests for this ${ed.lang} code:\n\`\`\`${ed.lang}\n${ed.code}\n\`\`\``, stream, noopToken);
            return {};
        }
        case 'review': {
            const ed = getEditorCode();
            if (!ed?.code) { stream.markdown('⚠️ No code selected.'); return {}; }
            await streamFromHarness(harness, `Review this ${ed.lang} code for issues:\n\`\`\`${ed.lang}\n${ed.code}\n\`\`\``, stream, noopToken);
            return {};
        }
        case 'commit': {
            await streamFromHarness(harness, 'Generate a conventional commit message. Use git_status and git_diff_staged tools first.', stream, noopToken);
            return {};
        }
        case 'plan': {
            if (!prompt.trim()) {
                stream.markdown('Usage: `/plan <task description>`');
                return {};
            }
            if (planMode) {
                const planInstruction = planMode.startPlan();
                const fullPrompt = `${planInstruction}\n\nUser request: ${prompt}`;
                await streamFromHarness(harness, fullPrompt, stream, noopToken);
                stream.markdown('\n\n---\n*Plan mode active. Use `/plan` again with your next step to continue.*');
            } else {
                await streamFromHarness(harness, `Create a detailed step-by-step plan for: ${prompt}`, stream, noopToken);
            }
            return {};
        }
        case 'compact': {
            try {
                stream.markdown('🔄 Running VCC compaction...\n');
                const result = await harness.compact('__pi_vcc__');
                const tokBefore = result.tokensBefore >= 1000
                    ? `${(result.tokensBefore / 1000).toFixed(1)}k`
                    : String(result.tokensBefore);
                stream.markdown(`✅ **VCC compacted** — ${tokBefore} tokens → summary generated\n`);
            } catch (err: any) {
                if (err.message === 'Compaction cancelled' || err.message === 'Already compacted') {
                    stream.markdown('⚠️ Nothing to compact.\n');
                } else {
                    stream.markdown(`❌ Compaction failed: ${err.message}\n`);
                }
            }
            return {};
        }
        case 'speed': {
            const report = speedTracker?.getLastReport();
            if (report) {
                stream.markdown(`⚡ **Last generation speed:** ${report.display}\n`);
            } else {
                stream.markdown('No speed data yet. Send a message first.\n');
            }
            return {};
        }
        case 'scout': {
            if (!prompt.trim()) { stream.markdown('Usage: `/scout <what to investigate>`'); return {}; }
            await streamFromHarness(harness, `Scout the codebase: ${prompt}. Find relevant files, patterns, and architecture.`, stream, noopToken);
            return {};
        }
        case 'research': {
            if (!prompt.trim()) { stream.markdown('Usage: `/research <topic>`'); return {}; }
            await streamFromHarness(harness, `Research: ${prompt}. Provide a comprehensive summary.`, stream, noopToken);
            return {};
        }
        case 'clear': {
            if (planMode) { planMode.reset(); }
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
        '| `/plan <task>` | Create a step-by-step plan |',
        '| `/compact` | Run VCC compaction (structured summary) |',
        '| `/speed` | Show last generation speed |',
        '| `/scout <query>` | Codebase reconnaissance |',
        '| `/research <topic>` | Research a topic |',
        '| `/clear` | Clear chat history |',
        '',
    ].join('\n');
}

export async function runCommand(
    prompt: string,
    label: string,
    harness: AgentHarness,
    commandOutput: vscode.OutputChannel
): Promise<void> {
    commandOutput.clear();
    commandOutput.appendLine(`⏳ ${label}...\n`);

    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `π ${label}` },
            async () => {
                const response = await harness.prompt(prompt);
                for (const part of response.content) {
                    if (part.type === 'text') {
                        commandOutput.appendLine(part.text);
                    }
                }
            }
        );
    } catch (err: any) {
        commandOutput.appendLine(`\n❌ Error: ${err.message}`);
    }

    commandOutput.appendLine('\n✅ Done.');
    commandOutput.show(true);
}
