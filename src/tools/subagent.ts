import { Tool } from '../agent/tools';
import { LlmClient } from '../agent/client';
import { getChatModel } from '../utils/config';
import { buildSystemPrompt } from '../agent/prompts';

export function createSubagentTool(client: LlmClient): Tool {
    return {
        name: 'subagent',
        description: 'Delegate a task to an isolated AI subagent. Use this for independent research, investigation, or parallel work. The subagent has access to the same tools.',
        parameters: {
            type: 'object' as const,
            properties: {
                task: { type: 'string', description: 'The task or question for the subagent' },
                context: { type: 'string', description: 'Additional context to pass to the subagent' },
            },
            required: ['task'],
        },
        async execute(args: any) {
            try {
                const model = getChatModel();
                const systemPrompt = buildSystemPrompt() + '\n\nYou are a subagent. Complete the task given to you and return your findings. Be thorough and detailed.';

                const messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: args.context ? args.task + '\n\nContext:\n' + args.context : args.task },
                ];

                const response = await client.chatCompletion(messages, { model, maxTokens: 4096 });
                const content = response.choices?.[0]?.message?.content || '(no output from subagent)';

                return { content: '**Subagent result:**\n\n' + content };
            } catch (err: any) {
                return { content: 'Subagent error: ' + err.message, isError: true };
            }
        },
    };
}
