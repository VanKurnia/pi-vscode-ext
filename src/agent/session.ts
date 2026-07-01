import * as fs from 'fs';
import * as path from 'path';

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

/** JSONL entry for session persistence (pi-compatible) */
interface SessionEntry {
    timestamp: number;
    type: 'message' | 'compaction';
    message?: ChatMessage;
    summary?: string;
    droppedCount?: number;
}

/** Prefix/suffix matching pi's compaction format */
const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:\n\n<summary>\n`;
const COMPACTION_SUMMARY_SUFFIX = `\n</summary>`;

export class Session {
    private messages: ChatMessage[] = [];
    private systemPrompt: string;
    private totalDropped: number = 0;
    /** JSONL persistence path (pi-compatible) */
    private persistPath: string | null = null;

    constructor(systemPrompt: string) {
        this.systemPrompt = systemPrompt;
        if (systemPrompt) {
            this.messages.push({ role: 'system', content: systemPrompt });
        }
    }

    /**
     * Enable JSONL persistence (pi-compatible session storage).
     * Saves to .pi-agent/session.jsonl in workspace root.
     */
    enablePersistence(workspacePath: string): void {
        const dir = path.join(workspacePath, '.pi-agent');
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        this.persistPath = path.join(dir, 'session.jsonl');
        this.loadFromDisk();
    }

    /** Load session from JSONL file */
    private loadFromDisk(): void {
        if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
        try {
            const content = fs.readFileSync(this.persistPath, 'utf-8');
            const lines = content.split('\n').filter(l => l.trim());
            if (lines.length === 0) return;

            this.messages = [];
            if (this.systemPrompt) {
                this.messages.push({ role: 'system', content: this.systemPrompt });
            }

            for (const line of lines) {
                try {
                    const entry: SessionEntry = JSON.parse(line);
                    if (entry.type === 'message' && entry.message) {
                        this.messages.push(entry.message);
                    } else if (entry.type === 'compaction' && entry.summary) {
                        const summaryContent = COMPACTION_SUMMARY_PREFIX + entry.summary + COMPACTION_SUMMARY_SUFFIX;
                        this.messages.push({ role: 'user', content: summaryContent });
                        this.totalDropped += entry.droppedCount || 0;
                    }
                } catch { /* skip malformed lines */ }
            }
        } catch { /* ignore read errors */ }
    }

    /** Save current state to JSONL file */
    private saveToDisk(): void {
        if (!this.persistPath) return;
        try {
            const lines: string[] = [];
            for (const msg of this.messages) {
                if (msg.role === 'system') continue; // don't persist system prompt
                lines.push(JSON.stringify({ timestamp: Date.now(), type: 'message', message: msg } satisfies SessionEntry));
            }
            fs.writeFileSync(this.persistPath, lines.join('\n') + '\n', 'utf-8');
        } catch { /* ignore write errors */ }
    }

    addUserMessage(content: string): void {
        this.messages.push({ role: 'user', content });
        this.saveToDisk();
    }

    addAssistantMessage(content: string | null, toolCalls?: any[], usage?: TokenUsage, stopReason?: string): void {
        const msg: ChatMessage = { role: 'assistant', content };
        if (toolCalls && toolCalls.length > 0) { msg.tool_calls = toolCalls; }
        if (usage) { msg.usage = usage; }
        if (stopReason) { msg.stopReason = stopReason; }
        this.messages.push(msg);
        this.saveToDisk();
    }

    addToolResult(toolCallId: string, name: string, content: string): void {
        this.messages.push({ role: 'tool', content, tool_call_id: toolCallId, name });
        this.saveToDisk();
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
     */
    applyCompaction(summary: string, keepRecentCount: number = 10): void {
        if (this.messages.length <= keepRecentCount + 1) return;

        const systemMsg = this.messages[0];
        const recentMessages = this.messages.slice(-keepRecentCount);
        const droppedCount = this.messages.length - 1 - keepRecentCount;

        const summaryContent = COMPACTION_SUMMARY_PREFIX + summary + COMPACTION_SUMMARY_SUFFIX;

        this.messages = [
            systemMsg,
            { role: 'user', content: summaryContent },
            ...recentMessages,
        ];

        this.totalDropped += droppedCount;

        // Persist compaction entry to JSONL
        if (this.persistPath) {
            try {
                const entry: SessionEntry = { timestamp: Date.now(), type: 'compaction', summary, droppedCount };
                fs.appendFileSync(this.persistPath, JSON.stringify(entry) + '\n', 'utf-8');
            } catch { /* ignore */ }
        }
        this.saveToDisk();
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
            this.saveToDisk();
        }
        return dropped;
    }

    /** Delete session file */
    deletePersistedSession(): void {
        if (this.persistPath && fs.existsSync(this.persistPath)) {
            try { fs.unlinkSync(this.persistPath); } catch { /* ignore */ }
        }
    }

    clear(): void {
        this.messages = [];
        if (this.systemPrompt) {
            this.messages.push({ role: 'system', content: this.systemPrompt });
        }
        this.deletePersistedSession();
    }
}
