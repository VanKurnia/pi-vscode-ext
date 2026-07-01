/**
 * Stream Bridge — maps AgentHarness events to VSCode ChatResponseStream.
 *
 * Subscribes to harness events and pipes them to VSCode's native chat UI.
 */

import * as vscode from 'vscode';
import type { AgentHarness } from '@earendil-works/pi-agent-core/node';
import type { AssistantMessage, TextContent } from '@earendil-works/pi-ai';
import { Logger } from '../utils/logger.js';

const logger = Logger.getInstance();

/**
 * Send a prompt to the harness and stream the response to VSCode.
 *
 * Flow:
 * 1. Subscribe to harness events for real-time UI updates
 * 2. Call harness.prompt() — runs the full agent loop
 * 3. Render final AssistantMessage text to the stream
 * 4. Clean up on completion or cancellation
 */
export async function streamFromHarness(
    harness: AgentHarness,
    text: string,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<AssistantMessage> {
    let unsubscribe: (() => void) | undefined;

    // Wire cancellation → abort
    const abortDisp = token.onCancellationRequested(() => {
        logger.info('[stream-bridge] Cancellation requested');
        harness.abort().catch(() => {});
    });

    try {
        // Subscribe to harness events for real-time updates
        unsubscribe = harness.subscribe(async (event: any) => {
            try {
                switch (event.type) {
                    case 'tool_call': {
                        const args = event.input
                            ? Object.entries(event.input)
                                  .map(([k, v]) => {
                                      const s = typeof v === 'string' ? v : JSON.stringify(v);
                                      return `${k}=${s}`;
                                  })
                                  .join(', ')
                            : '';
                        const display = args.length > 100 ? args.slice(0, 100) + '...' : args;
                        stream.markdown(`\n\n⚡ **\`${event.toolName}\`**${display ? ` \`${display}\`` : ''}\n`);
                        break;
                    }
                    case 'tool_result': {
                        if (event.isError) {
                            const errText = (event.content || [])
                                .filter((c: any) => c.type === 'text')
                                .map((c: any) => c.text)
                                .join(' ');
                            stream.markdown(`  ❌ ${errText.slice(0, 200)}\n`);
                        } else {
                            stream.markdown('  ✅\n');
                        }
                        break;
                    }
                    case 'before_provider_request':
                        stream.progress('Generating...');
                        break;
                }
            } catch (err) {
                logger.warn(`[stream-bridge] Event error: ${err}`);
            }
        });

        stream.progress('Thinking...');

        // Run the full agent loop
        const response = await harness.prompt(text);

        // Render final text content
        for (const part of response.content) {
            if (part.type === 'text' && (part as TextContent).text) {
                stream.markdown((part as TextContent).text);
            }
        }

        return response;
    } catch (err: any) {
        const message = err?.message || String(err);
        logger.error(`[stream-bridge] Error: ${message}`);
        stream.markdown(`\n\n❌ **Error:** ${message}\n`);
        throw err;
    } finally {
        unsubscribe?.();
        abortDisp.dispose();
    }
}
