import * as vscode from 'vscode';
// LlmClient replaced by bridge — using any for now
import { getConfig, getCompletionModel } from '../utils/config.js';
import { Logger } from '../utils/logger.js';

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private client: any;
    private logger = Logger.getInstance();
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private lastRequestTime = 0;
    private pendingCancellation: vscode.CancellationTokenSource | undefined;

    constructor(client: any) {
        this.client = client;
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        const config = getConfig();
        if (!config.inlineSuggestions.enabled) { return undefined; }

        const linePrefix = document.getText(new vscode.Range(new vscode.Position(position.line, 0), position));
        if (linePrefix.trim().length < 3) { return undefined; }

        // Debounce: wait for user to stop typing
        const debounceMs = config.inlineSuggestions.debounceMs;
        const now = Date.now();
        const timeSinceLast = now - this.lastRequestTime;
        if (timeSinceLast < debounceMs) {
            return undefined;
        }
        this.lastRequestTime = now;

        // Cancel previous in-flight request
        if (this.pendingCancellation) {
            this.pendingCancellation.dispose();
        }
        this.pendingCancellation = new vscode.CancellationTokenSource();

        const startLine = Math.max(0, position.line - 30);
        const endLine = Math.min(document.lineCount - 1, position.line + 5);
        const contextRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
        const contextText = document.getText(contextRange);
        const model = getCompletionModel();

        try {
            const messages = [
                { role: 'system', content: 'You are a code completion assistant. Complete the code at the cursor position. Only output the completion text - no explanations, no markdown, no code blocks.' },
                { role: 'user', content: 'File: ' + document.fileName + '\nLanguage: ' + document.languageId + '\n\nCode context (cursor at line ' + (position.line + 1) + '):\n```' + document.languageId + '\n' + contextText + '\n```\n\nComplete the code at the cursor position. Output ONLY the completion.' },
            ];

            const response = await this.client.chatCompletion(messages, { model, maxTokens: 150, temperature: 0.3 });
            if (token.isCancellationRequested) { return undefined; }

            let completion = response.choices[0]?.message?.content || '';
            completion = completion.replace(/^```\w*\n?/gm, '').replace(/\n?```$/gm, '').trimStart();
            if (!completion) { return undefined; }

            return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))];
        } catch (err: any) {
            this.logger.debug('Inline completion error: ' + err.message);
            return undefined;
        }
    }
}
