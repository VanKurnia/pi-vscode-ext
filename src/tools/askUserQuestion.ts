import * as vscode from 'vscode';
import { Tool } from '../agent/tools';

export function createAskUserQuestionTool(): Tool {
    return {
        name: 'ask_user_question',
        description: 'Ask the user a question during task execution. Supports multiple-choice options or free-form text input. Use this when you need user guidance, clarification, or a decision.',
        promptSnippet: 'Ask the user for input',
        promptGuidelines: ['Use when you need a decision, clarification, or approval before proceeding', 'Ask exactly one question per call'],
        parameters: {
            type: 'object' as const,
            properties: {
                question: { type: 'string', description: 'The question to ask the user' },
                options: {
                    type: 'array',
                    description: 'Optional multiple-choice options. Omit for free-form text input.',
                    items: {
                        type: 'object',
                        properties: {
                            label: { type: 'string', description: 'Display label for the option' },
                            value: { type: 'string', description: 'Optional machine-readable value. Defaults to label.' },
                            description: { type: 'string', description: 'Optional extra detail shown below the option' },
                        },
                        required: ['label'],
                    },
                },
                details: { type: 'string', description: 'Optional extra context shown under the question' },
            },
            required: ['question'],
        },
        async execute(args: any) {
            try {
                const question = args.question;
                const details = args.details || '';
                const options = args.options as Array<{ label: string; value?: string; description?: string }> | undefined;

                if (options && options.length > 0) {
                    // Multiple-choice mode — use QuickPick
                    const items: vscode.QuickPickItem[] = options.map(opt => ({
                        label: opt.label,
                        description: opt.description,
                        // Store the value separately for retrieval
                        value: opt.value || opt.label,
                    } as any));

                    // Add "Other" option for free-form input
                    items.push({ label: '$(edit) Other...', description: 'Type a custom answer' });

                    const fullPrompt = details ? `${question}\n${details}` : question;
                    const selected = await vscode.window.showQuickPick(items, {
                        title: fullPrompt,
                        placeHolder: 'Select an option',
                    });

                    if (!selected) {
                        return { content: 'User cancelled the question.' };
                    }

                    if (selected.label.includes('Other')) {
                        // Free-form input
                        const customInput = await vscode.window.showInputBox({
                            prompt: question,
                            placeHolder: 'Type your answer...',
                        });
                        if (customInput === undefined) {
                            return { content: 'User cancelled the question.' };
                        }
                        return { content: `User answered: ${customInput}` };
                    }

                    const value = (selected as any).value || selected.label;
                    return { content: `User selected: ${value}` };
                } else {
                    // Free-form text mode — use InputBox
                    const fullPrompt = details ? `${question}\n${details}` : question;
                    const answer = await vscode.window.showInputBox({
                        prompt: fullPrompt,
                        placeHolder: 'Type your answer...',
                    });

                    if (answer === undefined) {
                        return { content: 'User cancelled the question.' };
                    }
                    return { content: `User answered: ${answer}` };
                }
            } catch (err: any) {
                return { content: `Error asking question: ${err.message}`, isError: true };
            }
        },
    };
}
