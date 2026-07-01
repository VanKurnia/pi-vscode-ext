export interface Tool {
    name: string;
    label?: string;
    description: string;
    /** Short snippet for when to use this tool (pi-agent-setup pattern) */
    promptSnippet?: string;
    /** Guidelines for the LLM on how to use this tool effectively */
    promptGuidelines?: string[];
    parameters: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
    /** Execution mode: sequential (default) or parallel (pi-compatible) */
    executionMode?: 'sequential' | 'parallel';
    execute: (args: any, signal?: AbortSignal) => Promise<{ content: string; isError?: boolean; terminate?: boolean }>;
}

export class ToolRegistry {
    private tools = new Map<string, Tool>();

    register(tool: Tool): void {
        this.tools.set(tool.name, tool);
    }

    get(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    getAll(): Tool[] {
        return Array.from(this.tools.values());
    }

    getNames(): string[] {
        return Array.from(this.tools.keys());
    }

    async executeTool(name: string, args: any, signal?: AbortSignal): Promise<{ content: string; isError?: boolean }> {
        const tool = this.tools.get(name);
        if (!tool) {
            return { content: `Unknown tool: ${name}. Available: ${this.getNames().join(', ')}`, isError: true };
        }
        try {
            return await tool.execute(args, signal);
        } catch (err: any) {
            return { content: `Tool error (${name}): ${err.message || String(err)}`, isError: true };
        }
    }

    toFunctionDefinitions(toolNames?: string[]): any[] {
        const tools = toolNames
            ? this.getAll().filter(t => toolNames.includes(t.name))
            : this.getAll();
        return tools.map(tool => {
            let desc = tool.description;
            if (tool.promptSnippet) {
                desc += ` — ${tool.promptSnippet}`;
            }
            if (tool.promptGuidelines && tool.promptGuidelines.length > 0) {
                desc += '\nGuidelines: ' + tool.promptGuidelines.join('; ');
            }
            return {
                type: 'function',
                function: {
                    name: tool.name,
                    description: desc,
                    parameters: tool.parameters,
                },
            };
        });
    }
}
