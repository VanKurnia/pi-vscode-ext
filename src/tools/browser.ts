// Browser context globals (used inside page.evaluate callbacks)
declare const document: any;
import { Tool } from '../agent/tools';

// Shared browser state
interface BrowserState {
    browser: any | null;
    page: any | null;
    port: number;
}

const state: BrowserState = { browser: null, page: null, port: 9222 };

async function getPuppeteer(): Promise<any> {
    try {
        return require('puppeteer-core');
    } catch {
        throw new Error(
            'puppeteer-core is not installed. Run: npm install puppeteer-core'
        );
    }
}

async function ensureConnected(port: number): Promise<any> {
    if (state.page && !state.page.isClosed()) {
        return state.page;
    }
    const puppeteer = await getPuppeteer();
    const browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: null,
    });
    state.browser = browser;
    state.port = port;
    const pages = await browser.pages();
    state.page = pages[0] || (await browser.newPage());
    return state.page;
}

// Helper: simple HTML-to-markdown conversion (Readability-lite)
function htmlToMarkdown(html: string): string {
    let md = html;
    // Remove script/style tags
    md = md.replace(/<script[\s\S]*?<\/script>/gi, '');
    md = md.replace(/<style[\s\S]*?<\/style>/gi, '');
    // Headings
    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
    md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n');
    md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n');
    md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n');
    // Bold / Italic
    md = md.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
    md = md.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');
    // Links
    md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
    // Images
    md = md.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
    md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
    md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');
    // Lists
    md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
    md = md.replace(/<\/(?:ul|ol)>/gi, '\n');
    md = md.replace(/<(?:ul|ol)[^>]*>/gi, '\n');
    // Paragraphs / line breaks
    md = md.replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<p[^>]*>/gi, '\n');
    md = md.replace(/<\/p>/gi, '\n');
    // Code blocks (pre)
    md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```\n');
    md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
    // Remove remaining tags
    md = md.replace(/<[^>]+>/g, '');
    // Decode common entities
    md = md.replace(/&amp;/g, '&');
    md = md.replace(/&lt;/g, '<');
    md = md.replace(/&gt;/g, '>');
    md = md.replace(/&quot;/g, '"');
    md = md.replace(/&#39;/g, "'");
    md = md.replace(/&nbsp;/g, ' ');
    // Collapse whitespace
    md = md.replace(/[ \t]+/g, ' ');
    md = md.replace(/\n{3,}/g, '\n\n');
    return md.trim();
}

// ──────────────────────────────────────────────
// Tools
// ──────────────────────────────────────────────

function createBrowserStartTool(): Tool {
    return {
        name: 'browser_start',
        description:
            'Connect to a Chrome browser instance via DevTools Protocol (puppeteer-core). ' +
            'Launches a connection on the specified port (default 9222).',
        promptSnippet: 'Connect to Chrome for browser automation',
        promptGuidelines: [
            'Chrome must be running with --remote-debugging-port=9222',
            'Call this before other browser_* tools',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                port: {
                    type: 'number',
                    description: 'Chrome DevTools Protocol port (default: 9222)',
                },
            },
            required: [],
        },
        async execute(args: any) {
            try {
                const port = args?.port ?? 9222;
                const puppeteer = await getPuppeteer();
                // Close existing session if any
                if (state.browser) {
                    try { state.browser.disconnect(); } catch { /* ignore */ }
                    state.browser = null;
                    state.page = null;
                }
                const browser = await puppeteer.connect({
                    browserURL: `http://127.0.0.1:${port}`,
                    defaultViewport: null,
                });
                state.browser = browser;
                state.port = port;
                const pages = await browser.pages();
                state.page = pages[0] || (await browser.newPage());
                const url = state.page.url();
                return {
                    content: `Connected to Chrome on port ${port}. Current page: ${url || '(blank)'}`,
                };
            } catch (err: any) {
                return {
                    content: `Failed to connect to Chrome: ${err.message}`,
                    isError: true,
                };
            }
        },
    };
}

function createBrowserNavigateTool(): Tool {
    return {
        name: 'browser_navigate',
        description: 'Navigate the browser to a URL.',
        promptSnippet: 'Navigate to a URL',
        promptGuidelines: ['Use http:// or https:// prefix'],
        parameters: {
            type: 'object' as const,
            properties: {
                url: { type: 'string', description: 'URL to navigate to' },
                port: { type: 'number', description: 'CDP port (default: 9222)' },
            },
            required: ['url'],
        },
        async execute(args: any) {
            try {
                const page = await ensureConnected(args?.port ?? state.port ?? 9222);
                await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                const title = await page.title();
                return { content: `Navigated to: ${args.url}\nTitle: ${title}` };
            } catch (err: any) {
                return { content: `Navigation error: ${err.message}`, isError: true };
            }
        },
    };
}

function createBrowserEvaluateTool(): Tool {
    return {
        name: 'browser_evaluate',
        description:
            'Execute JavaScript in the browser page context and return the result.',
        promptSnippet: 'Run JavaScript in the page',
        promptGuidelines: [
            'Expression is evaluated with eval(); use JSON.stringify for complex objects',
            'Useful for extracting data, triggering events, reading DOM state',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                expression: {
                    type: 'string',
                    description: 'JavaScript expression or statement to evaluate',
                },
                port: { type: 'number', description: 'CDP port (default: 9222)' },
            },
            required: ['expression'],
        },
        async execute(args: any) {
            try {
                const page = await ensureConnected(args?.port ?? state.port ?? 9222);
                const result = await page.evaluate(args.expression);
                const text =
                    typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                return { content: text ?? 'undefined' };
            } catch (err: any) {
                return { content: `Evaluate error: ${err.message}`, isError: true };
            }
        },
    };
}

function createBrowserScreenshotTool(): Tool {
    return {
        name: 'browser_screenshot',
        description:
            'Capture a screenshot of the current page. Returns base64 data or saves to a file path.',
        promptSnippet: 'Take a screenshot of the page',
        promptGuidelines: [
            'Provide save_path to save as file, otherwise returns base64 string',
            'Use selector to screenshot a specific element',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                save_path: {
                    type: 'string',
                    description:
                        'File path to save screenshot (e.g. /tmp/screenshot.png). If omitted, returns base64.',
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector to screenshot a specific element instead of full page',
                },
                full_page: {
                    type: 'boolean',
                    description: 'Capture full scrollable page (default: false)',
                },
                port: { type: 'number', description: 'CDP port (default: 9222)' },
            },
            required: [],
        },
        async execute(args: any) {
            try {
                const page = await ensureConnected(args?.port ?? state.port ?? 9222);
                const opts: any = {
                    type: 'png',
                    fullPage: args?.full_page ?? false,
                };

                if (args?.selector) {
                    const el = await page.$(args.selector);
                    if (!el) {
                        return {
                            content: `Element not found: ${args.selector}`,
                            isError: true,
                        };
                    }
                    const buf = await el.screenshot(opts);
                    if (args?.save_path) {
                        const fs = require('fs');
                        fs.writeFileSync(args.save_path, buf);
                        return {
                            content: `Screenshot saved to ${args.save_path} (${buf.length} bytes)`,
                        };
                    }
                    return { content: `data:image/png;base64,${buf.toString('base64')}` };
                }

                if (args?.save_path) {
                    opts.path = args.save_path;
                    await page.screenshot(opts);
                    return { content: `Screenshot saved to ${args.save_path}` };
                }

                const buf = await page.screenshot(opts);
                return { content: `data:image/png;base64,${buf.toString('base64')}` };
            } catch (err: any) {
                return { content: `Screenshot error: ${err.message}`, isError: true };
            }
        },
    };
}

function createBrowserContentTool(): Tool {
    return {
        name: 'browser_content',
        description:
            'Extract page content as markdown. Uses a Readability-like approach to extract the main content.',
        promptSnippet: 'Get page content as markdown',
        promptGuidelines: [
            'Extracts the visible text content and converts to markdown',
            'Use max_length to limit output size for large pages',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                selector: {
                    type: 'string',
                    description:
                        'CSS selector to extract from a specific element (default: body)',
                },
                max_length: {
                    type: 'number',
                    description: 'Max characters to return (default: 20000)',
                },
                port: { type: 'number', description: 'CDP port (default: 9222)' },
            },
            required: [],
        },
        async execute(args: any) {
            try {
                const page = await ensureConnected(args?.port ?? state.port ?? 9222);
                const selector = args?.selector || 'body';
                const maxLength = args?.max_length ?? 20000;

                const html = await page.evaluate((sel: string) => {
                    const el = document.querySelector(sel);
                    return el ? el.innerHTML : null;
                }, selector);

                if (html === null) {
                    return {
                        content: `Element not found: ${selector}`,
                        isError: true,
                    };
                }

                let md = htmlToMarkdown(html);
                if (md.length > maxLength) {
                    md = md.slice(0, maxLength) + `\n\n[truncated ${md.length - maxLength} chars]`;
                }
                return { content: md || '(empty page)' };
            } catch (err: any) {
                return { content: `Content extraction error: ${err.message}`, isError: true };
            }
        },
    };
}

function createBrowserClickTool(): Tool {
    return {
        name: 'browser_click',
        description: 'Click an element on the page by CSS selector.',
        promptSnippet: 'Click a page element',
        promptGuidelines: [
            'Use CSS selectors to target elements (e.g. button.submit, #myId, a[href="..."])',
            'Waits for the selector to appear before clicking',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                selector: { type: 'string', description: 'CSS selector of element to click' },
                port: { type: 'number', description: 'CDP port (default: 9222)' },
            },
            required: ['selector'],
        },
        async execute(args: any) {
            try {
                const page = await ensureConnected(args?.port ?? state.port ?? 9222);
                await page.waitForSelector(args.selector, { timeout: 10000 });
                await page.click(args.selector);
                return { content: `Clicked: ${args.selector}` };
            } catch (err: any) {
                return { content: `Click error: ${err.message}`, isError: true };
            }
        },
    };
}

function createBrowserTypeTool(): Tool {
    return {
        name: 'browser_type',
        description: 'Type text into an input element identified by CSS selector.',
        promptSnippet: 'Type text into an input field',
        promptGuidelines: [
            'Target input, textarea, or contenteditable elements',
            'Set clear=true to clear the field first',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                selector: { type: 'string', description: 'CSS selector of input element' },
                text: { type: 'string', description: 'Text to type' },
                clear: {
                    type: 'boolean',
                    description: 'Clear the field before typing (default: false)',
                },
                port: { type: 'number', description: 'CDP port (default: 9222)' },
            },
            required: ['selector', 'text'],
        },
        async execute(args: any) {
            try {
                const page = await ensureConnected(args?.port ?? state.port ?? 9222);
                await page.waitForSelector(args.selector, { timeout: 10000 });
                if (args?.clear) {
                    await page.evaluate((sel: string) => {
                            const el = document.querySelector(sel) as any;
                        if (el) el.value = '';
                    }, args.selector);
                }
                await page.type(args.selector, args.text);
                return {
                    content: `Typed "${args.text}" into ${args.selector}`,
                };
            } catch (err: any) {
                return { content: `Type error: ${err.message}`, isError: true };
            }
        },
    };
}

function createBrowserCloseTool(): Tool {
    return {
        name: 'browser_close',
        description: 'Disconnect from the browser (does not close Chrome itself).',
        promptSnippet: 'Disconnect browser automation',
        promptGuidelines: ['Call when done with browser tools to free resources'],
        parameters: {
            type: 'object' as const,
            properties: {},
            required: [],
        },
        async execute() {
            try {
                if (state.browser) {
                    state.browser.disconnect();
                    state.browser = null;
                    state.page = null;
                    return { content: 'Disconnected from browser' };
                }
                return { content: 'No active browser connection' };
            } catch (err: any) {
                return { content: `Close error: ${err.message}`, isError: true };
            }
        },
    };
}

export function createBrowserTools(): Tool[] {
    return [
        createBrowserStartTool(),
        createBrowserNavigateTool(),
        createBrowserEvaluateTool(),
        createBrowserScreenshotTool(),
        createBrowserContentTool(),
        createBrowserClickTool(),
        createBrowserTypeTool(),
        createBrowserCloseTool(),
    ];
}
