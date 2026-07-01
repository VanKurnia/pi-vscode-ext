import { getConfig } from '../utils/config';

export interface LlmMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: any[];
    tool_call_id?: string;
}

/**
 * LLM client using native fetch (Node 18+, VSCode bundles it).
 * Replaces raw http/https module approach — 60% less code,
 * native AbortSignal support, better error handling.
 */
export class LlmClient {
    private buildHeaders(): Record<string, string> {
        const config = getConfig();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
        };
        if (config.api.apiKey) {
            headers['Authorization'] = `Bearer ${config.api.apiKey}`;
        }
        return headers;
    }

    private buildUrl(suffix: string = '/chat/completions'): string {
        const config = getConfig();
        const base = config.api.baseUrl.replace(/\/+$/, '');
        return base + suffix;
    }

    async chatCompletion(messages: any[], options?: {
        model?: string;
        tools?: any[];
        maxTokens?: number;
        temperature?: number;
        signal?: AbortSignal;
    }): Promise<any> {
        const config = getConfig();
        const body = {
            model: options?.model || config.api.model,
            messages,
            stream: false,
            ...(options?.tools && { tools: options.tools, tool_choice: 'auto' }),
            ...(options?.maxTokens && { max_tokens: options.maxTokens }),
            ...(options?.temperature !== undefined && { temperature: options.temperature }),
        };

        const res = await fetch(this.buildUrl(), {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify(body),
            signal: options?.signal,
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => 'Unknown error');
            throw new Error(`LLM API error ${res.status}: ${errText}`);
        }

        return res.json();
    }

    async streamCompletion(
        messages: any[],
        options: { model?: string; tools?: any[]; maxTokens?: number; temperature?: number } = {},
        onChunk: (chunk: any) => void,
        signal?: AbortSignal
    ): Promise<any> {
        const config = getConfig();
        const body = {
            model: options.model || config.api.model,
            messages,
            stream: true,
            ...(options.tools && { tools: options.tools, tool_choice: 'auto' }),
            ...(options.maxTokens && { max_tokens: options.maxTokens }),
            ...(options.temperature !== undefined && { temperature: options.temperature }),
        };

        const res = await fetch(this.buildUrl(), {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify(body),
            signal,
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => 'Unknown error');
            throw new Error(`LLM API error ${res.status}: ${errText}`);
        }

        // Read SSE stream via ReadableStream
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let aggregated: any = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // keep incomplete line in buffer

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;

                const data = trimmed.slice(6);
                if (data === '[DONE]') break;

                try {
                    const chunk = JSON.parse(data);
                    onChunk(chunk);

                    // Aggregate final message from chunks
                    if (!aggregated) {
                        aggregated = {
                            choices: [{
                                message: { role: 'assistant', content: '', tool_calls: [] },
                                finish_reason: null,
                            }],
                            usage: chunk.usage || null,
                        };
                    }

                    const delta = chunk.choices?.[0]?.delta;
                    const msg = aggregated.choices[0].message;
                    if (delta?.content) {
                        msg.content += delta.content;
                    }
                    if (delta?.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index ?? 0;
                            if (!msg.tool_calls[idx]) {
                                msg.tool_calls[idx] = {
                                    id: tc.id || '',
                                    type: 'function',
                                    function: { name: '', arguments: '' },
                                };
                            }
                            if (tc.id) msg.tool_calls[idx].id = tc.id;
                            if (tc.function?.name) msg.tool_calls[idx].function.name += tc.function.name;
                            if (tc.function?.arguments) msg.tool_calls[idx].function.arguments += tc.function.arguments;
                        }
                    }
                    if (chunk.choices?.[0]?.finish_reason) {
                        aggregated.choices[0].finish_reason = chunk.choices[0].finish_reason;
                    }
                    if (chunk.usage) {
                        aggregated.usage = chunk.usage;
                    }
                } catch { /* skip malformed chunks */ }
            }
        }

        // Clean up empty tool_calls arrays
        if (aggregated?.choices[0]?.message?.tool_calls) {
            aggregated.choices[0].message.tool_calls = aggregated.choices[0].message.tool_calls.filter(Boolean);
            if (aggregated.choices[0].message.tool_calls.length === 0) {
                delete aggregated.choices[0].message.tool_calls;
            }
        }

        return aggregated || { choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }] };
    }
}
