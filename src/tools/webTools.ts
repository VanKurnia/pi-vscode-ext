import * as vscode from 'vscode';
import { Tool } from '../agent/tools';
import { getConfig } from '../utils/config';

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_SEARCH_RESULTS = 5;
const MAX_SEARCH_RESULTS = 20;
const DEFAULT_FETCH_CHARACTERS = 12000;
const MAX_FETCH_CHARACTERS = 50000;

function get9routerBaseUrl(): string {
    const config = getConfig();
    // Use the configured base URL, strip /v1 suffix if present
    let url = config.api.baseUrl || '';
    url = url.replace(/\/v1\/?$/, '');
    return url || 'http://43.156.113.69:8080';
}

async function postJson(baseUrl: string, path: string, body: Record<string, unknown>): Promise<unknown> {
    const url = `${baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const text = await response.text();
        let payload: unknown;
        try { payload = JSON.parse(text); } catch { payload = { text }; }

        if (!response.ok) {
            const message = typeof payload === 'object' && payload && 'error' in payload
                ? JSON.stringify((payload as { error: unknown }).error)
                : JSON.stringify(payload);
            throw new Error(`9router ${path} returned ${response.status}: ${message}`);
        }
        return payload;
    } finally {
        clearTimeout(timer);
    }
}

function formatSearchResults(query: string, payload: unknown): string {
    const response = payload as { results?: Record<string, unknown>[]; answer?: string; provider?: string; errors?: unknown[] };
    const results = Array.isArray(response.results) ? response.results : [];
    const lines = [`**Web search:** ${query}`];
    if (response.provider) lines.push(`Provider: ${response.provider}`);
    if (response.answer?.trim()) lines.push('', `**Answer:** ${response.answer.trim()}`);
    if (results.length === 0) {
        lines.push('', 'No results returned.');
    } else {
        lines.push('', '**Results:**');
        results.forEach((result, i) => {
            const title = typeof result.title === 'string' ? result.title : 'Untitled';
            const url = typeof result.url === 'string' ? result.url : '';
            const snippet = typeof result.snippet === 'string' ? result.snippet : '';
            lines.push(`${i + 1}. **${title}**`);
            if (url) lines.push(`   ${url}`);
            if (snippet) lines.push(`   ${snippet}`);
        });
    }
    if (Array.isArray(response.errors) && response.errors.length > 0) {
        lines.push('', `Errors: ${JSON.stringify(response.errors)}`);
    }
    return lines.join('\n');
}

function formatFetchResponse(payload: unknown, maxCharacters: number): string {
    const response = payload as { url?: string; title?: string; provider?: string; content?: { text?: string; format?: string } };
    const contentText = typeof response.content?.text === 'string' ? response.content.text : '';
    const truncated = contentText.length > maxCharacters
        ? contentText.slice(0, maxCharacters) + `\n\n[truncated ${contentText.length - maxCharacters} chars]`
        : contentText;

    const lines = [`**Web fetch:** ${response.url || ''}`];
    if (response.provider) lines.push(`Provider: ${response.provider}`);
    if (response.title?.trim()) lines.push(`Title: ${response.title.trim()}`);
    lines.push('', truncated || 'No content returned.');
    return lines.join('\n');
}

export function createWebSearchTool(): Tool {
    return {
        name: 'web_search',
        executionMode: 'parallel',
        description: 'Search the web through 9router proxy. Returns web search results with titles, URLs, and snippets.',
        promptSnippet: 'Search the web for information',
        promptGuidelines: [
            'Use when current or external web information is needed',
            'Provide a clear, specific search query for best results',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                query: { type: 'string', description: 'Search query' },
                max_results: { type: 'number', description: `Maximum results (1-${MAX_SEARCH_RESULTS}, default: ${DEFAULT_SEARCH_RESULTS})` },
            },
            required: ['query'],
        },
        async execute(args: any) {
            try {
                const baseUrl = get9routerBaseUrl();
                const maxResults = Math.max(1, Math.min(MAX_SEARCH_RESULTS, args.max_results || DEFAULT_SEARCH_RESULTS));
                const body: Record<string, unknown> = {
                    query: args.query,
                    max_results: maxResults,
                };
                const payload = await postJson(baseUrl, '/v1/search', body);
                return { content: formatSearchResults(args.query, payload) };
            } catch (err: any) {
                return { content: `Web search error: ${err.message}`, isError: true };
            }
        },
    };
}

export function createWebFetchTool(): Tool {
    return {
        name: 'web_fetch',
        executionMode: 'parallel',
        description: 'Fetch and extract content from a URL through 9router proxy. Returns the page content in markdown format.',
        promptSnippet: 'Fetch a web page',
        promptGuidelines: [
            'Use when you need to read the full content of a specific URL',
            'Returns markdown-formatted content from the page',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                url: { type: 'string', description: 'URL to fetch and extract' },
                max_characters: { type: 'number', description: `Maximum characters to return (default: ${DEFAULT_FETCH_CHARACTERS})` },
            },
            required: ['url'],
        },
        async execute(args: any) {
            try {
                const baseUrl = get9routerBaseUrl();
                const maxChars = Math.max(1, Math.min(MAX_FETCH_CHARACTERS, args.max_characters || DEFAULT_FETCH_CHARACTERS));
                const body: Record<string, unknown> = {
                    url: args.url,
                    format: 'markdown',
                    max_characters: maxChars,
                };
                const payload = await postJson(baseUrl, '/v1/web/fetch', body);
                return { content: formatFetchResponse(payload, maxChars) };
            } catch (err: any) {
                return { content: `Web fetch error: ${err.message}`, isError: true };
            }
        },
    };
}
