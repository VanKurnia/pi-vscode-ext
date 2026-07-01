import { Tool } from '../agent/tools';
import { Session, ChatMessage } from '../agent/session';

/**
 * recall tool — equivalent to pi-blackhole's unified recall.
 * Searches conversation history by free text, supports index-based lookup.
 */
export function createRecallTool(getSession: () => Session): Tool {
    return {
        name: 'recall',
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
                const history = session.getHistory();

                if (history.length === 0) {
                    return { content: 'No conversation history found.' };
                }

                const mode = args.mode || 'search';
                const scope = args.scope || 'all';

                // Build searchable entries with indices
                const entries = history
                    .map((msg: ChatMessage, idx: number) => ({
                        index: idx,
                        role: msg.role,
                        content: typeof msg.content === 'string' ? msg.content : '',
                        name: msg.name,
                        hasToolCalls: !!(msg.tool_calls && msg.tool_calls.length > 0),
                        toolCallNames: msg.tool_calls?.map(tc => tc.function.name) || [],
                    }))
                    .filter((e: any) => e.role !== 'system'); // Skip system prompt

                let results: typeof entries = [];

                if (mode === 'index' && typeof args.index === 'number') {
                    // Direct index lookup
                    const idx = args.index;
                    const found = entries.filter((e: any) => e.index === idx);
                    if (found.length === 0) {
                        return { content: `Message #${idx} not found. Valid range: 0-${history.length - 1}` };
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
                    results = entries.filter((entry: any) => {
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
                    const roleLabel = entry.role === 'tool'
                        ? `tool:${entry.name || 'unknown'}`
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
