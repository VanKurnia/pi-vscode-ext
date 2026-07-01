import { Tool, ToolRegistry } from '../agent/tools';
import type { AgentHarness } from '@earendil-works/pi-agent-core/node';
import type { TextContent } from '@earendil-works/pi-ai';
import { getChatModel } from '../utils/config';
import { discoverAgents, AgentConfig, resolveModel } from '../agent/agents';
import { Logger } from '../utils/logger';
import * as vscode from 'vscode';

export function createSubagentTool(harness: AgentHarness, toolRegistry?: ToolRegistry): Tool {
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
                let systemPrefix: string;
                let toolNames: string[] | undefined;

                // Named agent mode — use preconfigured agent with filtered tools
                if (args.agent) {
                    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                    const agents = discoverAgents(ws);
                    const agentConfig = agents.find(a => a.name === args.agent);
                    if (!agentConfig) {
                        const available = agents.map(a => a.name).join(', ') || 'none';
                        return { content: `Unknown agent: "${args.agent}". Available agents: ${available}`, isError: true };
                    }
                    systemPrefix = agentConfig.systemPrompt || 'You are a helpful AI coding assistant.';
                    toolNames = agentConfig.tools.length > 0 ? agentConfig.tools : undefined;
                    logger.info(`Subagent dispatch: agent=${agentConfig.name}, tools=[${(toolNames || []).join(', ')}]`);
                } else {
                    // Ad-hoc mode — use default system prompt with all tools
                    systemPrefix = 'You are a subagent — an isolated AI worker. Complete the task thoroughly and return your findings. ' +
                        'You have access to tools (read files, search, bash, git). Use them proactively to investigate. ' +
                        'When done, provide a clear summary of your findings.';
                    toolNames = undefined; // all tools
                }

                // Build the full prompt with system instructions and task
                const taskText = args.context
                    ? `${systemPrefix}\n\nTask: ${args.task}\n\nContext:\n${args.context}`
                    : `${systemPrefix}\n\nTask: ${args.task}`;

                // Filter tools if a named agent specifies them
                const savedToolNames: string[] | undefined = toolNames;
                if (savedToolNames) {
                    try {
                        await harness.setActiveTools(savedToolNames);
                    } catch (err) {
                        logger.warn(`Subagent: failed to set active tools: ${err}`);
                    }
                }

                // Execute via harness.prompt()
                const response = await harness.prompt(taskText);

                // Restore all tools if we filtered them
                if (savedToolNames) {
                    try {
                        // Reset to all tools — get current tool names from registry
                        const allToolNames = toolRegistry?.getNames() || [];
                        if (allToolNames.length > 0) {
                            await harness.setActiveTools(allToolNames);
                        }
                    } catch (err) {
                        logger.warn(`Subagent: failed to restore tools: ${err}`);
                    }
                }

                // Extract text content from the AssistantMessage response
                const fullContent = response.content
                    .filter((c): c is TextContent => c.type === 'text')
                    .map(c => c.text)
                    .join('\n');

                const label = args.agent ? `${args.agent} agent` : 'Subagent';
                return {
                    content: `**${label} result:**\n\n` + (fullContent || '(no output)')
                };
            } catch (err: any) {
                return { content: 'Subagent error: ' + err.message, isError: true };
            }
        },
    };
}
