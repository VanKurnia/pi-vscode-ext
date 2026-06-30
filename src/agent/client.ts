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
        this.logger.debug(`Chat completion: model=${model}, msgs=${messages.length}`);
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
        return this.makeStreamRequest('/chat/completions', body, onChunk, signal);
    }

    private makeRequest(endpoint: string, body: any): Promise<any> {
        const config = getConfig();
        const url = new URL(endpoint, config.api.baseUrl);
        const isHttps = url.protocol === 'https:';
        const bodyStr = JSON.stringify(body);

        return new Promise((resolve, reject) => {
            const opts: http.RequestOptions = {
                hostname: url.hostname, port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search, method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                    ...(config.api.apiKey ? { 'Authorization': `Bearer ${config.api.apiKey}` } : {}),
                },
                timeout: 120000,
            };
            const transport = isHttps ? https : http;
            const req = transport.request(opts, (res) => {
                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
                    } else { reject(new Error(`API ${res.statusCode}: ${data.slice(0, 500)}`)); }
                });
            });
            req.on('error', reject);
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

        return new Promise((resolve, reject) => {
            const opts: http.RequestOptions = {
                hostname: url.hostname, port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search, method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                    ...(config.api.apiKey ? { 'Authorization': `Bearer ${config.api.apiKey}` } : {}),
                },
                timeout: 120000,
            };

            let aggregated: any = null;
            let buffer = '';
            const transport = isHttps ? https : http;
            const req = transport.request(opts, (res) => {
                res.on('data', (chunk: Buffer) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) continue;
                        try {
                            const parsed = JSON.parse(trimmed.slice(6));
                            if (!aggregated) {
                                aggregated = { id: parsed.id, choices: parsed.choices.map((c: any) => ({ index: c.index, message: { role: 'assistant', content: '', tool_calls: [] }, finish_reason: '' })) };
                            }
                            for (const choice of parsed.choices) {
                                const target = aggregated.choices[choice.index];
                                if (!target) continue;
                                if (choice.delta.content) target.message.content = (target.message.content || '') + choice.delta.content;
                                if (choice.delta.tool_calls) {
                                    for (const tc of choice.delta.tool_calls) {
                                        if (!target.message.tool_calls) target.message.tool_calls = [];
                                        while (target.message.tool_calls.length <= tc.index) target.message.tool_calls.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
                                        const existing = target.message.tool_calls[tc.index];
                                        if (tc.id) existing.id = tc.id;
                                        if (tc.function?.name) existing.function.name += tc.function.name;
                                        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                                    }
                                }
                                if (choice.finish_reason) target.finish_reason = choice.finish_reason;
                            }
                            onChunk(parsed);
                        } catch {}
                    }
                });
                res.on('end', () => {
                    if (aggregated) {
                        for (const choice of aggregated.choices) {
                            if (choice.message.tool_calls) choice.message.tool_calls = choice.message.tool_calls.filter((tc: any) => tc.id || tc.function.name);
                        }
                        resolve(aggregated);
                    } else { reject(new Error('No data from stream')); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Stream timeout')); });
            if (signal) signal.addEventListener('abort', () => { req.destroy(); });
            req.write(bodyStr);
            req.end();
        });
    }
}
