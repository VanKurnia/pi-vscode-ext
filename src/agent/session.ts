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
    /** Summary of messages dropped during compaction (pi-blackhole pattern) */
    private compactedSummary: string = '';
    private totalDropped: number = 0;

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
     * Builds a compact summary of dropped messages (pi-blackhole compaction pattern).
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
        // Build summary entries from dropped messages
        const summaryEntries: string[] = [];
        let dropped = 0;
        while (totalTokens > maxTokens * 0.8 && nonSystem.length > 2) {
            const removed = nonSystem.shift();
            if (removed) {
                // Capture key info from dropped messages
                if (removed.role === 'user' && typeof removed.content === 'string') {
                    const preview = removed.content.slice(0, 100);
                    summaryEntries.push(`[user] ${preview}${removed.content.length > 100 ? '...' : ''}`);
                } else if (removed.role === 'assistant' && typeof removed.content === 'string' && removed.content) {
                    const preview = removed.content.slice(0, 80);
                    summaryEntries.push(`[assistant] ${preview}${removed.content.length > 80 ? '...' : ''}`);
                } else if (removed.role === 'assistant' && removed.tool_calls) {
                    const toolNames = removed.tool_calls.map(tc => tc.function.name).join(', ');
                    summaryEntries.push(`[assistant] called: ${toolNames}`);
                } else if (removed.role === 'tool' && removed.name) {
                    summaryEntries.push(`[tool:${removed.name}] result`);
                }
                if (typeof removed.content === 'string') {
                    totalTokens -= Math.ceil(removed.content.length / 4);
                }
            }
            // If this was an assistant message with tool_calls, also remove the following tool results
            if (removed?.role === 'assistant' && removed.tool_calls) {
                while (nonSystem.length > 2 && nonSystem[0]?.role === 'tool') {
                    const toolMsg = nonSystem.shift();
                    if (toolMsg) {
                        if (toolMsg.name) summaryEntries.push(`[tool:${toolMsg.name}] result`);
                        if (typeof toolMsg.content === 'string') {
                            totalTokens -= Math.ceil(toolMsg.content.length / 4);
                        }
                    }
                    dropped++;
                }
            }
            dropped++;
        }

        // Update compacted summary (keep last 20 entries to avoid bloat)
        if (summaryEntries.length > 0) {
            this.totalDropped += summaryEntries.length;
            const newSummary = summaryEntries.join('\n');
            this.compactedSummary = this.compactedSummary
                ? this.compactedSummary + '\n' + newSummary
                : newSummary;
            // Trim summary to avoid growing indefinitely
            const summaryLines = this.compactedSummary.split('\n');
            if (summaryLines.length > 30) {
                this.compactedSummary = `[${this.totalDropped - summaryLines.length + 30} earlier entries omitted]\n` + summaryLines.slice(-30).join('\n');
            }
        }

        // Inject compacted summary as a system message if we have one
        this.messages = [systemMsg, ...nonSystem];
        if (this.compactedSummary) {
            // Update or insert the compaction summary after system prompt
            const summaryMsg: ChatMessage = {
                role: 'system',
                content: `[Compacted conversation summary — ${this.totalDropped} earlier messages were summarized to save context]\n${this.compactedSummary}`,
            };
            // Remove any existing compacted summary first
            const firstNonSystem = this.messages.findIndex((m, i) => i > 0 && m.role === 'system' && m.content?.startsWith('[Compacted'));
            if (firstNonSystem > 0) {
                this.messages.splice(firstNonSystem, 1);
            }
            this.messages.splice(1, 0, summaryMsg);
        }

        return dropped;
    }

    clear(): void {
        this.messages = [];
        if (this.systemPrompt) this.messages.push({ role: 'system', content: this.systemPrompt });
    }
}
