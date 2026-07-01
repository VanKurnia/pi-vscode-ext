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

    constructor(systemPrompt: string) {
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
        return { messageCount: this.messages.length, estimatedTokens: tokens };
    }

    /**
     * Truncate conversation to fit within token limits.
     * Preserves system prompt + most recent messages, drops oldest middle messages.
     */
    truncateToTokenLimit(maxTokens: number): number {
        if (this.messages.length <= 2) return 0; // system + 1 message, nothing to truncate

        const systemMsg = this.messages[0];
        const nonSystem = this.messages.slice(1);

        // Estimate current tokens
        let totalTokens = 0;
        for (const m of this.messages) {
            if (typeof m.content === 'string') totalTokens += Math.ceil(m.content.length / 4);
        }

        if (totalTokens <= maxTokens) return 0;

        // Drop oldest messages (keep tool_call + tool_result pairs together)
        let dropped = 0;
        while (totalTokens > maxTokens * 0.8 && nonSystem.length > 2) {
            const removed = nonSystem.shift();
            if (removed && typeof removed.content === 'string') {
                totalTokens -= Math.ceil(removed.content.length / 4);
            }
            // If this was an assistant message with tool_calls, also remove the following tool results
            if (removed?.role === 'assistant' && removed.tool_calls) {
                while (nonSystem.length > 2 && nonSystem[0]?.role === 'tool') {
                    const toolMsg = nonSystem.shift();
                    if (toolMsg && typeof toolMsg.content === 'string') {
                        totalTokens -= Math.ceil(toolMsg.content.length / 4);
                    }
                    dropped++;
                }
            }
            dropped++;
        }

        this.messages = [systemMsg, ...nonSystem];
        return dropped;
    }

    clear(): void {
        this.messages = [];
        if (this.systemPrompt) this.messages.push({ role: 'system', content: this.systemPrompt });
    }
}
