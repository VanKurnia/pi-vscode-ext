import { Tool, ToolRegistry } from '../agent/tools';
import { LlmClient } from '../agent/client';
import { getChatModel } from '../utils/config';
import { buildSystemPrompt } from '../agent/prompts';

export function createSubagentTool(client: LlmClient, toolRegistry?: ToolRegistry): Tool {
    return {
        name: 'subagent',
        description: 'Delegate a task to an isolated AI subagent for independent research, analysis, or code review. The subagent runs a separate LLM conversation — use for parallel investigation tasks.',
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
                const systemPrompt = buildSystemPrompt() +
                    '\n\nYou are a subagent — an isolated AI worker. Complete the task thoroughly and return your findings. ' +
                    'You have access to tools (read files, search, bash, git). Use them proactively to investigate.';

                const messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: args.context ? args.task + '\n\nContext:\n' + args.context : args.task },
                ];

                // Pass tools to subagent so it can actually work
                const tools = toolRegistry?.toFunctionDefinitions() || [];
                const response = await client.chatCompletion(messages, {
                    model,
                    maxTokens: 4096,
                    tools: tools.length > 0 ? tools : undefined,
                });

                const choice = response.choices?.[0]?.message;
                if (!choice) return { content: 'Subagent returned no response', isError: true };

                // If subagent wants to call tools, just report the request (don't recurse)
                if (choice.tool_calls && choice.tool_calls.length > 0) {
                    const toolNames = choice.tool_calls.map((tc: any) => tc.function.name).join(', ');
                    return {
                        content: '**Subagent analysis:**\n\n' +
                            (choice.content || '') +
                            '\n\n*(Subagent requested tools: ' + toolNames + ' — use these tools directly instead)*'
                    };
                }

                return { content: '**Subagent result:**\n\n' + (choice.content || '(no output)') };
            } catch (err: any) {
                return { content: 'Subagent error: ' + err.message, isError: true };
            }
        },
    };
}
