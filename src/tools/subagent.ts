import { Tool, ToolRegistry } from '../agent/tools';
// LlmClient replaced by bridge — using any for now
import { getChatModel } from '../utils/config';
// buildSystemPrompt removed — using pi-agent-core system prompts
import { discoverAgents, AgentConfig, resolveModel } from '../agent/agents';
import { Logger } from '../utils/logger';
import * as vscode from 'vscode';

const MAX_SUBAGENT_ITERATIONS = 5;

export function createSubagentTool(client: LlmClient, toolRegistry?: ToolRegistry): Tool {
    return {
        name: 'subagent',
        description: `Delegate a task to an isolated AI subagent. Supports two modes:
- Named agent: specify "agent" to use a preconfigured agent (worker, scout, researcher) with its own system prompt and filtered tool set.
- Ad-hoc: specify just "task" for a generic subagent with all tools.`,
        parameters: {
            type: 'object' as const,
            properties: {
                agent: { type: 'string', description: 'Name of a preconfigured agent (worker, scout, researcher). Optional — omit for ad-hoc mode.' },
                task: { type: 'string', description: 'The task or question for the subagent' },
                context: { type: 'string', description: 'Additional context to pass to the subagent' },
            },
            required: ['task'],
        },
        async execute(args: any) {
            const logger = Logger.getInstance();
            try {
                let systemPrompt: string;
                let toolNames: string[] | undefined;
                let model: string;

                // Named agent mode — use preconfigured agent with filtered tools
                if (args.agent) {
                    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                    const agents = discoverAgents(ws);
                    const agentConfig = agents.find(a => a.name === args.agent);
                    if (!agentConfig) {
                        const available = agents.map(a => a.name).join(', ') || 'none';
                        return { content: `Unknown agent: "${args.agent}". Available agents: ${available}`, isError: true };
                    }
                    systemPrompt = agentConfig.systemPrompt || buildSystemPrompt();
                    toolNames = agentConfig.tools.length > 0 ? agentConfig.tools : undefined;
                    model = resolveModel(agentConfig.model) || getChatModel();
                    logger.info(`Subagent dispatch: agent=${agentConfig.name}, tools=[${(toolNames || []).join(', ')}], model=${model}`);
                } else {
                    // Ad-hoc mode — use default system prompt with all tools
                    systemPrompt = buildSystemPrompt() +
                        '\n\nYou are a subagent — an isolated AI worker. Complete the task thoroughly and return your findings. ' +
                        'You have access to tools (read files, search, bash, git). Use them proactively to investigate. ' +
                        'When done, provide a clear summary of your findings.';
                    toolNames = undefined; // all tools
                    model = getChatModel();
                }

                const messages: any[] = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: args.context ? args.task + '\n\nContext:\n' + args.context : args.task },
                ];

                // Get filtered tool definitions based on agent config
                const tools = toolRegistry?.toFunctionDefinitions(toolNames) || [];
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

                const label = args.agent ? `${args.agent} agent` : 'Subagent';
                return {
                    content: `**${label} result:**\n\n` + (fullContent || '(no output — max iterations reached)')
                };
            } catch (err: any) {
                return { content: 'Subagent error: ' + err.message, isError: true };
            }
        },
    };
}
