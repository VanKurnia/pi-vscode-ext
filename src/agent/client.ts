import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { getConfig } from '../utils/config';
import { Logger } from '../utils/logger';

export class LlmClient {
    private logger = Logger.getInstance();

    private makeUrl(endpoint: string): URL {
        const config = getConfig();
        const base = config.api.baseUrl.endsWith('/') ? config.api.baseUrl : config.api.baseUrl + '/';
        return new URL(endpoint, base);
    }

    private getHeaders(): Record<string, string> {
        const config = getConfig();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (config.api.apiKey) {
            headers['Authorization'] = 'Bearer ' + config.api.apiKey;
        }
        return headers;
    }

    async chatCompletion(messages: any[], options?: {
        model?: string;
        tools?: any[];
        maxTokens?: number;
        temperature?: number;
    }): Promise<any> {
        const config = getConfig();
        const body = {
            model: options?.model || config.api.model,
            messages,
            max_tokens: options?.maxTokens || config.agent.maxTokens,
            temperature: options?.temperature ?? config.agent.temperature,
            tools: options?.tools,
            stream: false,
        };

        const url = this.makeUrl('chat/completions');
        const bodyStr = JSON.stringify(body);
        this.logger.info('API Request: POST ' + url.href + ' (model=' + body.model + ')');

        return new Promise((resolve, reject) => {
            const isHttps = url.protocol === 'https:';
            const transport = isHttps ? https : http;
            const req = transport.request({
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: { ...this.getHeaders(), 'Content-Length': Buffer.byteLength(bodyStr) },
                timeout: 120000,
            }, (res) => {
                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                res.on('end', () => {
                    this.logger.info('API Response: status=' + res.statusCode);
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try { resolve(JSON.parse(data)); }
                        catch { reject(new Error('Failed to parse API response')); }
                    } else {
                        reject(new Error('API error ' + res.statusCode + ': ' + data.slice(0, 300)));
                    }
                });
            });
            req.on('error', (err) => reject(err));
            req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
            req.write(bodyStr);
            req.end();
        });
    }

    async streamCompletion(
        messages: any[],
        options: { model?: string; tools?: any[]; maxTokens?: number; temperature?: number },
        onChunk: (chunk: any) => void,
        signal?: AbortSignal
    ): Promise<any> {
        const config = getConfig();
        const body = {
            model: options?.model || config.api.model,
            messages,
            max_tokens: options?.maxTokens || config.agent.maxTokens,
            temperature: options?.temperature ?? config.agent.temperature,
            tools: options?.tools,
            stream: true,
        };

        const url = this.makeUrl('chat/completions');
        const bodyStr = JSON.stringify(body);
        this.logger.info('Stream Request: POST ' + url.href + ' (model=' + body.model + ')');

        return new Promise((resolve, reject) => {
            const isHttps = url.protocol === 'https:';
            const transport = isHttps ? https : http;

            const req = transport.request({
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: { ...this.getHeaders(), 'Content-Length': Buffer.byteLength(bodyStr) },
                timeout: 120000,
            }, (res) => {
                const contentType = res.headers['content-type'] || '';
                this.logger.info('Stream Response: status=' + res.statusCode + ', content-type=' + contentType);

                // Non-streaming JSON response (fallback)
                if (contentType.includes('application/json')) {
                    let jsonData = '';
                    res.on('data', (chunk: Buffer) => { jsonData += chunk.toString(); });
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(jsonData);
                            if (parsed.choices) {
                                onChunk(parsed);
                            }
                            resolve(parsed);
                        } catch { reject(new Error('Failed to parse JSON response')); }
                    });
                    return;
                }

                // SSE streaming
                let buffer = '';
                let totalBytes = 0;
                let aggregated: any = null;
                let chunkCount = 0;

                res.on('data', (chunk: Buffer) => {
                    totalBytes += chunk.length;
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed === 'data: [DONE]') { continue; }
                        if (!trimmed.startsWith('data: ')) { continue; }

                        const raw = trimmed.slice(6);
                        chunkCount++;
                        if (chunkCount <= 3) {
                            this.logger.info('SSE chunk ' + chunkCount + ': ' + raw.slice(0, 200));
                        }

                        try {
                            const parsed = JSON.parse(raw);
                            if (!aggregated) {
                                aggregated = {
                                    id: parsed.id,
                                    object: 'chat.completion',
                                    created: parsed.created,
                                    model: parsed.model,
                                    choices: [{
                                        index: 0,
                                        message: { role: 'assistant', content: '', tool_calls: null },
                                        finish_reason: null,
                                    }],
                                };
                            }

                            const delta = parsed.choices?.[0]?.delta;
                            if (delta) {
                                if (delta.content) {
                                    aggregated.choices[0].message.content += delta.content;
                                }
                                if (delta.reasoning_content) {
                                    // For reasoning models: treat reasoning as visible content
                                    aggregated.choices[0].message.content += delta.reasoning_content;
                                }
                                if (delta.tool_calls) {
                                    if (!aggregated.choices[0].message.tool_calls) {
                                        aggregated.choices[0].message.tool_calls = [];
                                    }
                                    for (const tc of delta.tool_calls) {
                                        const existing = aggregated.choices[0].message.tool_calls.find((t: any) => t.index === tc.index);
                                        if (existing) {
                                            if (tc.function?.arguments) {
                                                existing.function.arguments += tc.function.arguments;
                                            }
                                        } else {
                                            aggregated.choices[0].message.tool_calls.push({
                                                id: tc.id || '',
                                                type: 'function',
                                                function: {
                                                    name: tc.function?.name || '',
                                                    arguments: tc.function?.arguments || '',
                                                },
                                                index: tc.index,
                                            });
                                        }
                                    }
                                }
                            }

                            if (parsed.choices?.[0]?.finish_reason) {
                                aggregated.choices[0].finish_reason = parsed.choices[0].finish_reason;
                            }

                            onChunk(parsed);
                        } catch { /* skip malformed chunks */ }
                    }
                });

                res.on('end', () => {
                    this.logger.info('Stream ended: ' + totalBytes + ' bytes, ' + chunkCount + ' chunks');
                    if (aggregated) {
                        // Clean up tool_calls indices
                        if (aggregated.choices[0].message.tool_calls) {
                            aggregated.choices[0].message.tool_calls = aggregated.choices[0].message.tool_calls
                                .filter((tc: any) => tc.function.name)
                                .map((tc: any) => ({ id: tc.id, type: tc.type, function: tc.function }));
                            if (aggregated.choices[0].message.tool_calls.length === 0) {
                                aggregated.choices[0].message.tool_calls = null;
                            }
                        }
                        resolve(aggregated);
                    } else {
                        reject(new Error('No parseable SSE data (' + totalBytes + ' bytes)'));
                    }
                });

                res.on('error', reject);
            });

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

            if (signal) {
                signal.addEventListener('abort', () => { req.destroy(); reject(new Error('Aborted')); });
            }

            req.write(bodyStr);
            req.end();
        });
    }
}
