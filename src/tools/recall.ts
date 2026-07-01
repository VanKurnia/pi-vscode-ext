import { Tool } from '../agent/tools';
import type { Session } from '@earendil-works/pi-agent-core/node';
import type { AgentMessage, SessionContext } from '@earendil-works/pi-agent-core';
import type { TextContent, ThinkingContent, ToolCall, UserMessage, AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';

/**
 * Extract plain text from an AgentMessage's content field.
 */
function extractText(msg: AgentMessage): string {
    if (msg.role === 'user') {
        const um = msg as UserMessage;
        if (typeof um.content === 'string') return um.content;
        return um.content
            .filter((c): c is TextContent => c.type === 'text')
            .map(c => c.text)
            .join(' ');
    }
    if (msg.role === 'assistant') {
        const am = msg as AssistantMessage;
        return am.content
            .filter((c): c is TextContent => c.type === 'text')
            .map(c => c.text)
            .join(' ');
    }
    if (msg.role === 'toolResult') {
        const tr = msg as ToolResultMessage;
        return tr.content
            .filter((c): c is TextContent => c.type === 'text')
            .map(c => c.text)
            .join(' ');
    }
    return '';
}

/**
 * Get tool call names from an assistant message, if any.
 */
function getToolCallNames(msg: AgentMessage): string[] {
    if (msg.role === 'assistant') {
        const am = msg as AssistantMessage;
        return am.content
            .filter((c): c is ToolCall => c.type === 'toolCall')
            .map(c => c.name);
    }
    return [];
}

/**
 * Check if an assistant message has tool calls.
 */
function hasToolCalls(msg: AgentMessage): boolean {
    return getToolCallNames(msg).length > 0;
}

/**
 * recall tool — equivalent to pi-blackhole's unified recall.
 * Searches conversation history by free text, supports index-based lookup.
 */
export function createRecallTool(getSession: () => Session): Tool {
    return {
        name: 'recall',
        executionMode: 'parallel',
        description: 'Search and recall previous conversation history. Find earlier messages, tool calls, and results by text search or message index.',
        promptSnippet: 'Search conversation history',
        promptGuidelines: [
            'Use when you need to find something discussed earlier that was truncated from context',
            'Search by text keywords to find relevant past exchanges',
            'Use index mode to retrieve a specific message by number',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                query: { type: 'string', description: 'Text to search for in conversation history' },
                mode: { type: 'string', enum: ['search', 'recent', 'index'], description: 'search = text search, recent = last N messages, index = specific message by #N' },
                index: { type: 'number', description: 'Message index (for mode=index)' },
                count: { type: 'number', description: 'Number of recent messages (for mode=recent, default: 10)' },
                scope: { type: 'string', enum: ['all', 'lineage'], description: 'all = full history, lineage = current context branch (default: all)' },
            },
            required: ['query'],
        },
        async execute(args: any) {
            try {
                const session = getSession();

                // Use scope to decide whether to get full history or current branch
                const scope = args.scope || 'all';
                let messages: AgentMessage[];

                if (scope === 'lineage') {
                    // Current branch only
                    const branch = await session.getBranch();
                    messages = branch
                        .filter(e => e.type === 'message')
                        .map((e: any) => e.message as AgentMessage);
                } else {
                    // Full context (all messages visible to the model)
                    const ctx: SessionContext = await session.buildContext();
                    messages = ctx.messages;
                }

                if (messages.length === 0) {
                    return { content: 'No conversation history found.' };
                }

                const mode = args.mode || 'search';

                // Build searchable entries with indices
                const entries = messages
                    .map((msg, idx) => ({
                        index: idx,
                        role: msg.role,
                        content: extractText(msg),
                        hasToolCalls: hasToolCalls(msg),
                        toolCallNames: getToolCallNames(msg),
                    }))
                    .filter(e => e.role !== 'compactionSummary');

                let results: typeof entries = [];

                if (mode === 'index' && typeof args.index === 'number') {
                    // Direct index lookup
                    const idx = args.index;
                    const found = entries.filter(e => e.index === idx);
                    if (found.length === 0) {
                        return { content: `Message #${idx} not found. Valid range: 0-${entries.length - 1}` };
                    }
                    results = found;
                } else if (mode === 'recent') {
                    const count = args.count || 10;
                    results = entries.slice(-count);
                } else {
                    // Text search
                    const query = (args.query || '').toLowerCase();
                    if (!query) return { content: 'No search query provided.' };

                    const queryTerms = query.split(/\s+/).filter((t: string) => t.length > 0);
                    results = entries.filter(entry => {
                        const text = entry.content.toLowerCase();
                        return queryTerms.every((term: string) => text.includes(term));
                    });
                }

                if (results.length === 0) {
                    return { content: `No conversation entries found matching: "${args.query}"` };
                }

                // Format results
                const lines = [`**Found ${results.length} conversation entries:**`, ''];
                for (const entry of results) {
                    const roleIcon = entry.role === 'user' ? '👤' : entry.role === 'assistant' ? '🤖' : '🔧';
                    const roleLabel = entry.role === 'toolResult'
                        ? `tool`
                        : entry.role;

                    // Truncate long content for display
                    const maxLen = 500;
                    let displayContent = entry.content;
                    if (displayContent.length > maxLen) {
                        displayContent = displayContent.slice(0, maxLen) + `... [${entry.content.length} chars total]`;
                    }

                    lines.push(`**#${entry.index}** ${roleIcon} ${roleLabel}`);
                    if (entry.hasToolCalls) {
                        lines.push(`  → calls: ${entry.toolCallNames.join(', ')}`);
                    }
                    if (displayContent) {
                        lines.push(`  ${displayContent.replace(/\n/g, '\n  ')}`);
                    }
                    lines.push('');
                }

                return { content: lines.join('\n') };
            } catch (err: any) {
                return { content: `Recall error: ${err.message}`, isError: true };
            }
        },
    };
}
