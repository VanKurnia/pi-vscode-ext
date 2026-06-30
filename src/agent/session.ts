export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
    name?: string;
}

export class Session {
    private messages: ChatMessage[] = [];
    private systemPrompt: string;

    constructor(systemPrompt: string, _maxTokens?: number, _model?: string, _provider?: string) {
        this.systemPrompt = systemPrompt;
        if (systemPrompt) {
            this.messages.push({ role: 'system', content: systemPrompt });
        }
    }

    addUserMessage(content: string): void {
        this.messages.push({ role: 'user', content });
    }

    addAssistantMessage(content: string | null, toolCalls?: any[]): void {
        const msg: ChatMessage = { role: 'assistant', content };
        if (toolCalls && toolCalls.length > 0) { msg.tool_calls = toolCalls; }
        this.messages.push(msg);
    }

    addToolResult(toolCallId: string, name: string, content: string): void {
        this.messages.push({ role: 'tool', content, tool_call_id: toolCallId, name });
    }

    getMessagesForApi(): any[] {
        return this.messages.map(m => {
            const msg: any = { role: m.role, content: m.content };
            if (m.tool_calls) msg.tool_calls = m.tool_calls;
            if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
            if (m.name) msg.name = m.name;
            return msg;
        });
    }

    getHistory(): ChatMessage[] { return [...this.messages]; }

    getContext() {
        let tokens = 0;
        for (const m of this.messages) {
            if (typeof m.content === 'string') tokens += Math.ceil(m.content.length / 4);
        }
        return { messageCount: this.messages.length, estimatedTokens: tokens, maxTokens: 4096, model: '', provider: '' };
    }

    clear(): void {
        this.messages = [];
        if (this.systemPrompt) this.messages.push({ role: 'system', content: this.systemPrompt });
    }
}
