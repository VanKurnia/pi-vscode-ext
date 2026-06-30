export interface Tool {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
    execute: (args: any) => Promise<{ content: string; isError?: boolean }>;
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

    async executeTool(name: string, args: any): Promise<{ content: string; isError?: boolean }> {
        const tool = this.tools.get(name);
        if (!tool) {
            return { content: `Unknown tool: ${name}. Available: ${this.getNames().join(', ')}`, isError: true };
        }
        try {
            return await tool.execute(args);
        } catch (err: any) {
            return { content: `Tool error (${name}): ${err.message || String(err)}`, isError: true };
        }
    }

    toFunctionDefinitions(): any[] {
        return this.getAll().map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        }));
    }
}
