export interface TokenUsage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
    name?: string;
    /** Actual token usage from provider (pi-compatible) */
    usage?: TokenUsage;
    /** Stop reason from provider */
    stopReason?: string;
}

/** Prefix/suffix matching pi's compaction format */
const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:\n\n<summary>\n`;
const COMPACTION_SUMMARY_SUFFIX = `\n</summary>`;

export class Session {
    private messages: ChatMessage[] = [];
    private systemPrompt: string;
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

    addAssistantMessage(content: string | null, toolCalls?: any[], usage?: TokenUsage, stopReason?: string): void {
        const msg: ChatMessage = { role: 'assistant', content };
        if (toolCalls && toolCalls.length > 0) { msg.tool_calls = toolCalls; }
        if (usage) { msg.usage = usage; }
        if (stopReason) { msg.stopReason = stopReason; }
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

    getContext(): { messageCount: number; estimatedTokens: number; usageTokens: number } {
        let estimatedTokens = 0;
        let usageTokens = 0;
        for (const m of this.messages) {
            if (typeof m.content === 'string') estimatedTokens += Math.ceil(m.content.length / 4);
            if (m.usage?.totalTokens) usageTokens = m.usage.totalTokens;
        }
        return { messageCount: this.messages.length, estimatedTokens, usageTokens };
    }

    /**
     * Calculate context tokens using actual provider usage when available (pi-compatible).
     * Falls back to char-based estimation.
     */
    calculateContextTokens(): number {
        // Find last valid assistant usage
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const m = this.messages[i];
            if (m.role === 'assistant' && m.usage?.totalTokens && m.stopReason !== 'aborted' && m.stopReason !== 'error') {
                return m.usage.totalTokens;
            }
        }
        // Fallback: estimate from content
        let tokens = 0;
        for (const m of this.messages) {
            if (typeof m.content === 'string') tokens += Math.ceil(m.content.length / 4);
            if (m.tool_calls) {
                for (const tc of m.tool_calls) {
                    tokens += Math.ceil((tc.function.arguments?.length || 0) / 4);
                }
            }
        }
        return tokens;
    }

    /**
     * Serialize conversation for compaction summarization (pi-compatible).
     * Converts messages to plain text with role labels.
     */
    serializeForCompaction(maxCharsPerResult: number = 2000): string {
        const parts: string[] = [];
        for (const msg of this.messages) {
            if (msg.role === 'system') continue;
            if (msg.role === 'user' && typeof msg.content === 'string') {
                parts.push(`[User]: ${msg.content}`);
            } else if (msg.role === 'assistant') {
                if (msg.content) parts.push(`[Assistant]: ${msg.content}`);
                if (msg.tool_calls) {
                    const calls = msg.tool_calls.map(tc => `${tc.function.name}(${tc.function.arguments})`).join('; ');
                    parts.push(`[Assistant tool calls]: ${calls}`);
                }
            } else if (msg.role === 'tool' && msg.name) {
                const content = msg.content || '';
                const truncated = content.length > maxCharsPerResult
                    ? content.slice(0, maxCharsPerResult) + `\n\n[... ${content.length - maxCharsPerResult} more characters truncated]`
                    : content;
                parts.push(`[Tool ${msg.name}]: ${truncated}`);
            }
        }
        return parts.join('\n\n');
    }

    /**
     * Check if compaction is needed based on actual token usage.
     * Returns true if context exceeds (contextWindow - reserveTokens).
     */
    needsCompaction(contextWindow: number, reserveTokens: number = 16384): boolean {
        const currentTokens = this.calculateContextTokens();
        return currentTokens > (contextWindow - reserveTokens);
    }

    /**
     * Replace compacted messages with LLM-generated summary (pi-compatible).
     * Keeps the system prompt and most recent messages.
     * Returns the compaction summary for the caller to send to LLM.
     */
    applyCompaction(summary: string, keepRecentCount: number = 10): void {
        if (this.messages.length <= keepRecentCount + 1) return; // system + recent

        const systemMsg = this.messages[0];
        const recentMessages = this.messages.slice(-keepRecentCount);
        const droppedCount = this.messages.length - 1 - keepRecentCount;

        // Build compaction summary message (pi-compatible format)
        const summaryContent = COMPACTION_SUMMARY_PREFIX + summary + COMPACTION_SUMMARY_SUFFIX;

        // Reconstruct: system → compaction summary → recent messages
        this.messages = [
            systemMsg,
            { role: 'user', content: summaryContent },
            ...recentMessages,
        ];

        this.totalDropped += droppedCount;
    }

    /**
     * Simple truncation fallback when LLM summarization is not available.
     * Preserves tool_call + tool_result pairs.
     */
    truncateToTokenLimit(maxTokens: number): number {
        if (this.messages.length <= 2) return 0;

        const systemMsg = this.messages[0];
        const nonSystem = this.messages.slice(1);
        let totalTokens = this.calculateContextTokens();

        if (totalTokens <= maxTokens) return 0;

        let dropped = 0;
        while (totalTokens > maxTokens * 0.8 && nonSystem.length > 2) {
            const removed = nonSystem.shift();
            if (removed) {
                if (typeof removed.content === 'string') {
                    totalTokens -= Math.ceil(removed.content.length / 4);
                }
                dropped++;
            }
            // Keep tool_call + tool_result pairs together
            if (removed?.role === 'assistant' && removed.tool_calls) {
                while (nonSystem.length > 2 && nonSystem[0]?.role === 'tool') {
                    const toolMsg = nonSystem.shift();
                    if (toolMsg && typeof toolMsg.content === 'string') {
                        totalTokens -= Math.ceil(toolMsg.content.length / 4);
                    }
                    dropped++;
                }
            }
        }

        if (dropped > 0) {
            this.totalDropped += dropped;
            this.messages = [systemMsg, ...nonSystem];
        }
        return dropped;
    }

    clear(): void {
        this.messages = [];
        if (this.systemPrompt) {
            this.messages.push({ role: 'system', content: this.systemPrompt });
        }
    }
}
