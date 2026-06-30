import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { getConfig } from '../utils/config';
import { Logger } from '../utils/logger';

export class LlmClient {
    private logger = Logger.getInstance();

    async chatCompletion(messages: any[], options: any = {}): Promise<any> {
        const config = getConfig();
        const model = options.model || config.api.model;
        const body: any = {
            model,
            messages,
            max_tokens: options.maxTokens || config.agent.maxTokens,
            temperature: options.temperature ?? config.agent.temperature,
        };
        if (options.tools?.length > 0) { body.tools = options.tools; body.tool_choice = 'auto'; }
        this.logger.info('Chat completion: model=' + model + ', msgs=' + messages.length);
        return this.makeRequest('/chat/completions', body);
    }

    async streamCompletion(messages: any[], options: any, onChunk: (chunk: any) => void, signal?: AbortSignal): Promise<any> {
        const config = getConfig();
        const model = options.model || config.api.model;
        const body: any = {
            model, messages,
            max_tokens: options.maxTokens || config.agent.maxTokens,
            temperature: options.temperature ?? config.agent.temperature,
            stream: true,
        };
        if (options.tools?.length > 0) { body.tools = options.tools; body.tool_choice = 'auto'; }
        this.logger.info('Stream completion: model=' + model);
        return this.makeStreamRequest('/chat/completions', body, onChunk, signal);
    }

    private makeRequest(endpoint: string, body: any): Promise<any> {
        const config = getConfig();
        const url = new URL(endpoint, config.api.baseUrl);
        const isHttps = url.protocol === 'https:';
        const bodyStr = JSON.stringify(body);
        this.logger.info('API Request: POST ' + url.href);

        return new Promise((resolve, reject) => {
            const opts: http.RequestOptions = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search, method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                    ...(config.api.apiKey ? { 'Authorization': 'Bearer ' + config.api.apiKey } : {}),
                },
                timeout: 120000,
            };
            const transport = isHttps ? https : http;
            const req = transport.request(opts, (res) => {
                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                res.on('end', () => {
                    this.logger.info('API Response: status=' + res.statusCode + ', length=' + data.length);
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try { resolve(JSON.parse(data)); }
                        catch { reject(new Error('Parse error: ' + data.slice(0, 200))); }
                    } else { reject(new Error('API ' + res.statusCode + ': ' + data.slice(0, 500))); }
                });
            });
            req.on('error', (err) => { this.logger.error('Request error: ' + err.message); reject(err); });
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.write(bodyStr);
            req.end();
        });
    }

    private makeStreamRequest(endpoint: string, body: any, onChunk: (chunk: any) => void, signal?: AbortSignal): Promise<any> {
        const config = getConfig();
        const url = new URL(endpoint, config.api.baseUrl);
        const isHttps = url.protocol === 'https:';
        const bodyStr = JSON.stringify(body);
        this.logger.info('Stream Request: POST ' + url.href);

        return new Promise((resolve, reject) => {
            const opts: http.RequestOptions = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search, method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                    ...(config.api.apiKey ? { 'Authorization': 'Bearer ' + config.api.apiKey } : {}),
                },
                timeout: 120000,
            };

            let aggregated: any = null;
            let buffer = '';
            let totalBytes = 0;
            const transport = isHttps ? https : http;

            const req = transport.request(opts, (res) => {
                const contentType = res.headers['content-type'] || '';
                this.logger.info('Stream Response: status=' + res.statusCode + ', content-type=' + contentType);

                // Non-streaming fallback (JSON response)
                if (contentType.includes('application/json')) {
                    let jsonData = '';
                    res.on('data', (chunk: Buffer) => { jsonData += chunk.toString(); });
                    res.on('end', () => {
                        this.logger.info('Got non-streaming JSON response (' + jsonData.length + ' chars)');
                        try {
                            const parsed = JSON.parse(jsonData);
                            if (parsed.choices && parsed.choices[0]) {
                                const content = parsed.choices[0].message?.content || '';
                                onChunk({ id: parsed.id, choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] });
                            }
                            resolve(parsed);
                        } catch (e: any) { reject(new Error('Failed to parse: ' + jsonData.slice(0, 200))); }
                    });
                    return;
                }

                // SSE streaming
                res.on('data', (chunk: Buffer) => {
                    totalBytes += chunk.length;
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) { continue; }
                        try {
                            const parsed = JSON.parse(trimmed.slice(6));
                            if (!aggregated) {
                                aggregated = {
                                    id: parsed.id,
                                    choices: (parsed.choices || []).map((c: any) => ({
                                        index: c.index ?? 0,
                                        message: { role: 'assistant', content: '', reasoning_content: '', tool_calls: [] },
                                        finish_reason: '',
                                    })),
                                };
                            }

                            for (const choice of (parsed.choices || [])) {
                                // Handle empty choices (usage-only chunks)
                                if (!choice.delta) { continue; }

                                const idx = choice.index ?? 0;
                                // Ensure target exists
                                while (aggregated.choices.length <= idx) {
                                    aggregated.choices.push({
                                        index: idx,
                                        message: { role: 'assistant', content: '', reasoning_content: '', tool_calls: [] },
                                        finish_reason: '',
                                    });
                                }
                                const target = aggregated.choices[idx];

                                // Handle content (actual response)
                                if (choice.delta.content) {
                                    target.message.content = (target.message.content || '') + choice.delta.content;
                                }

                                // Handle reasoning_content (thinking/reasoning models like mimo, deepseek-r1)
                                if (choice.delta.reasoning_content) {
                                    target.message.reasoning_content = (target.message.reasoning_content || '') + choice.delta.reasoning_content;
                                }

                                // Handle tool_calls
                                if (choice.delta.tool_calls) {
                                    for (const tc of choice.delta.tool_calls) {
                                        if (!target.message.tool_calls) { target.message.tool_calls = []; }
                                        while (target.message.tool_calls.length <= tc.index) {
                                            target.message.tool_calls.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
                                        }
                                        const existing = target.message.tool_calls[tc.index];
                                        if (tc.id) { existing.id = tc.id; }
                                        if (tc.function?.name) { existing.function.name += tc.function.name; }
                                        if (tc.function?.arguments) { existing.function.arguments += tc.function.arguments; }
                                    }
                                }

                                if (choice.finish_reason) { target.finish_reason = choice.finish_reason; }
                            }

                            // Forward chunk for streaming display
                            onChunk(parsed);

                        } catch (e) { /* ignore parse errors for individual chunks */ }
                    }
                });

                res.on('end', () => {
                    this.logger.info('Stream ended: ' + totalBytes + ' bytes, aggregated=' + !!aggregated);
                    if (aggregated) {
                        for (const choice of aggregated.choices) {
                            // If content is empty but reasoning exists, use reasoning as content
                            // (for reasoning models that only output reasoning_content)
                            if (!choice.message.content && choice.message.reasoning_content) {
                                choice.message.content = choice.message.reasoning_content;
                                this.logger.info('Used reasoning_content as content');
                            }
                            // Filter empty tool calls
                            if (choice.message.tool_calls) {
                                choice.message.tool_calls = choice.message.tool_calls.filter((tc: any) => tc.id || tc.function.name);
                            }
                        }
                        resolve(aggregated);
                    } else if (totalBytes === 0) {
                        reject(new Error('No data from stream - check API URL'));
                    } else {
                        reject(new Error('No parseable SSE data (' + totalBytes + ' bytes)'));
                    }
                });
            });

            req.on('error', (err) => { this.logger.error('Stream error: ' + err.message); reject(err); });
            req.on('timeout', () => { req.destroy(); reject(new Error('Stream timeout')); });
            if (signal) { signal.addEventListener('abort', () => { req.destroy(); }); }
            req.write(bodyStr);
            req.end();
        });
    }
}
