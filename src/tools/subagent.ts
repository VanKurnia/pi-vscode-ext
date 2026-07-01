import { Tool, ToolRegistry } from '../agent/tools';
import { LlmClient } from '../agent/client';
import { getChatModel } from '../utils/config';
import { buildSystemPrompt } from '../agent/prompts';
import { Logger } from '../utils/logger';

const MAX_SUBAGENT_ITERATIONS = 5;

export function createSubagentTool(client: LlmClient, toolRegistry?: ToolRegistry): Tool {
    return {
        name: 'subagent',
        description: 'Delegate a task to an isolated AI subagent for independent research, analysis, or code review. The subagent runs a separate LLM conversation with tool access — use for parallel investigation tasks.',
        parameters: {
            type: 'object' as const,
            properties: {
                task: { type: 'string', description: 'The task or question for the subagent' },
                context: { type: 'string', description: 'Additional context to pass to the subagent' },
            },
            required: ['task'],
        },
        async execute(args: any) {
            const logger = Logger.getInstance();
            try {
                const model = getChatModel();
                const systemPrompt = buildSystemPrompt() +
                    '\n\nYou are a subagent — an isolated AI worker. Complete the task thoroughly and return your findings. ' +
                    'You have access to tools (read files, search, bash, git). Use them proactively to investigate. ' +
                    'When done, provide a clear summary of your findings.';

                const messages: any[] = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: args.context ? args.task + '\n\nContext:\n' + args.context : args.task },
                ];

                const tools = toolRegistry?.toFunctionDefinitions() || [];
                let fullContent = '';

                // Tool execution loop (max iterations to prevent runaway)
                for (let i = 0; i < MAX_SUBAGENT_ITERATIONS; i++) {
                    const response = await client.chatCompletion(messages, {
                        model,
                        maxTokens: 4096,
                        tools: tools.length > 0 ? tools : undefined,
                    });

                    const choice = response.choices?.[0]?.message;
                    if (!choice) return { content: 'Subagent returned no response', isError: true };

                    // No tool calls — final response
                    if (!choice.tool_calls || choice.tool_calls.length === 0) {
                        fullContent = choice.content || '';
                        break;
                    }

                    // Add assistant message with tool_calls to conversation
                    messages.push(choice);

                    // Execute each tool call
                    for (const tc of choice.tool_calls) {
                        logger.info(`Subagent tool call: ${tc.function.name}`);
                        let toolArgs: any;
                        try { toolArgs = JSON.parse(tc.function.arguments); } catch { toolArgs = {}; }

                        if (!toolRegistry) {
                            messages.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: 'Tool registry not available in subagent',
                            });
                            continue;
                        }

                        const result = await toolRegistry.executeTool(tc.function.name, toolArgs);
                        messages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: result.content,
                        });
                    }
                }

                return {
                    content: '**Subagent result:**\n\n' + (fullContent || '(no output — max iterations reached)')
                };
            } catch (err: any) {
                return { content: 'Subagent error: ' + err.message, isError: true };
            }
        },
    };
}
