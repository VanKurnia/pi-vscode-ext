import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { LlmClient } from './client';
import { Session, TokenUsage } from './session';
import { ToolRegistry } from './tools';
import { buildSystemPrompt } from './prompts';
import { discoverAgents, AgentConfig, resolveModel } from './agents';
import { getConfig } from '../utils/config';
import { Logger } from '../utils/logger';
import { registerAllTools } from '../tools';

export type AgentEvent = 'userMessage' | 'assistantMessage' | 'toolCall' | 'toolResult' | 'streamStart' | 'streamChunk' | 'streamEnd' | 'error' | 'clear' | 'status';

export interface AgentEventData {
    type: AgentEvent;
    data: any;
}

/** Summarization system prompt (pi-compatible) */
const SUMMARIZATION_SYSTEM_PROMPT = `You are a conversation summarizer. Create a structured summary of this conversation.

Use this EXACT format:

## Goal
[What was the user trying to accomplish?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Files
### Read
- [list of files that were read]

### Modified
- [list of files that were modified/created]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

export class PiAgentManager extends EventEmitter implements Disposable {
    private client: LlmClient;
    private session: Session;
    private toolRegistry: ToolRegistry;
    private agents: AgentConfig[] = [];
    private logger = Logger.getInstance();
    private abortController: AbortController | null = null;
    private isProcessing = false;
    private planMode = false;
    /** Steering message queue (pi-compatible: user can type while agent works) */
    private pendingMessages: string[] = [];

    constructor() {
        super();
        this.client = new LlmClient();
        this.toolRegistry = new ToolRegistry();
        const config = getConfig();
        this.session = new Session(buildSystemPrompt());
        registerAllTools(this.toolRegistry, this.client, () => this.session);
        this.refreshAgents();

        // Enable JSONL persistence (pi-compatible)
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (ws) { this.session.enablePersistence(ws); }

        this.logger.info('PiAgentManager initialized');
    }

    refreshAgents(): void {
        try {
            const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            this.agents = discoverAgents(ws);
            this.logger.info('Discovered ' + this.agents.length + ' agents');
        } catch (err: any) { this.logger.warn('Agent discovery failed: ' + err.message); }
    }

    getAgents(): AgentConfig[] { return [...this.agents]; }
    getSessionContext() {
        const ctx = this.session.getContext();
        const config = getConfig();
        return { ...ctx, maxTokens: config.agent.maxTokens, model: config.api.model, provider: config.api.baseUrl };
    }
    getToolRegistry(): ToolRegistry { return this.toolRegistry; }
    isBusy(): boolean { return this.isProcessing; }
    isPlanMode(): boolean { return this.planMode; }
    togglePlanMode(): boolean { this.planMode = !this.planMode; return this.planMode; }

    /** Queue a message while agent is processing (pi-compatible steering) */
    queueMessage(content: string): void {
        if (this.isProcessing) {
            this.pendingMessages.push(content);
            this.emitEvent('status', { status: 'thinking' });
        }
    }

    /** Drain pending steering messages (called between turns) */
    private drainPendingMessages(): string[] {
        const msgs = [...this.pendingMessages];
        this.pendingMessages = [];
        return msgs;
    }

    emitEvent(type: AgentEvent, data: any): void { this.emit('event', { type, data } as AgentEventData); }

    async processUserMessage(content: string, context?: string): Promise<void> {
        if (this.isProcessing) { this.emitEvent('error', { message: 'Already processing a message. Please wait.' }); return; }
        this.isProcessing = true;
        this.abortController = new AbortController();
        this.emitEvent('status', { status: 'thinking' });

        try {
            const fullContent = context ? content + '\n\n---\nWorkspace Context:\n' + context : content;
            this.session.addUserMessage(fullContent);
            this.emitEvent('userMessage', { content });
            await this.agentLoop();
        } catch (err: any) {
            if (err.name === 'AbortError' || err.message === 'Aborted') {
                this.emitEvent('assistantMessage', { content: '*[Stopped by user]*' });
            } else {
                this.logger.error('Error: ' + err.message, err);
                this.emitEvent('error', { message: err.message });
            }
        } finally {
            this.isProcessing = false;
            this.pendingMessages = [];
            this.abortController = null;
            this.emitEvent('status', { status: 'idle' });
        }
    }

    async processAgentMessage(agentName: string, task: string): Promise<void> {
        const agent = this.agents.find(a => a.name === agentName);
        if (!agent) { this.emitEvent('error', { message: 'Agent not found: ' + agentName }); return; }
        const config = getConfig();
        const model = resolveModel(agent.model) || config.api.model;
        const agentSession = new Session(agent.systemPrompt || buildSystemPrompt());
        agentSession.addUserMessage(task);
        this.isProcessing = true;
        this.abortController = new AbortController();
        this.emitEvent('status', { status: 'thinking', agent: agentName });
        this.emitEvent('toolCall', { name: 'subagent', arguments: { agent: agentName, task } });

        try {
            const toolNames = agent.tools.length > 0 ? agent.tools : undefined;
            const tools = this.toolRegistry.toFunctionDefinitions(toolNames);
            const maxIterations = 10;
            let iterations = 0;
            let hasMoreToolCalls = true;

            while (hasMoreToolCalls && iterations < maxIterations) {
                iterations++;
                const response = await this.client.chatCompletion(
                    agentSession.getMessagesForApi(),
                    { model, tools: tools.length > 0 ? tools : undefined, maxTokens: 4096 }
                );
                const msg = response.choices?.[0]?.message;
                if (!msg) break;

                agentSession.addAssistantMessage(msg.content || null, msg.tool_calls || undefined);

                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    // Execute tool calls for the agent (pi-compatible tool loop)
                    for (const tc of msg.tool_calls) {
                        const fn = tc.function;
                        let toolArgs: any;
                        try { toolArgs = JSON.parse(fn.arguments || '{}'); } catch { toolArgs = {}; }
                        this.emitEvent('toolCall', { id: tc.id, name: fn.name, arguments: toolArgs });

                        const result = await this.toolRegistry.executeTool(fn.name, toolArgs, this.abortController?.signal);
                        agentSession.addToolResult(tc.id, fn.name, result.content);
                        this.emitEvent('toolResult', { id: tc.id, name: fn.name, content: result.content, isError: result.isError });
                    }
                    hasMoreToolCalls = true;
                } else {
                    hasMoreToolCalls = false;
                    if (msg.content) {
                        this.emitEvent('assistantMessage', { content: msg.content, agent: agentName });
                    }
                }
            }
        } catch (err: any) {
            if (err.name === 'AbortError' || err.message === 'Aborted') {
                this.emitEvent('assistantMessage', { content: '*[' + agentName + ' stopped by user]*' });
            } else {
                this.logger.error('Agent error: ' + err.message, err);
                this.emitEvent('error', { message: err.message });
            }
        } finally {
            this.isProcessing = false;
            this.abortController = null;
            this.emitEvent('status', { status: 'idle' });
        }
    }

    private async agentLoop(maxIterations: number = 15): Promise<void> {
        const config = getConfig();
        let iterations = 0;
        let hasMoreToolCalls = true;

        while (hasMoreToolCalls && iterations < maxIterations) {
            iterations++;

            // Check if compaction is needed (pi-compatible)
            if (this.session.needsCompaction(config.agent.maxTokens * 3, 16384)) {
                await this.performCompaction();
            }

            this.emitEvent('streamStart', {});
            const tools = this.toolRegistry.toFunctionDefinitions();
            const response = await this.client.streamCompletion(
                this.session.getMessagesForApi(),
                {
                    tools: tools.length > 0 ? tools : undefined,
                    model: this.planMode ? config.api.chatModel : undefined,
                },
                (chunk: any) => {
                    const delta = chunk.choices?.[0]?.delta;
                    if (delta?.content) {
                        this.emitEvent('streamChunk', { content: delta.content });
                    }
                    if (delta?.tool_calls) {
                        this.emitEvent('streamChunk', { content: '' }); // keep-alive
                    }
                },
                this.abortController?.signal
            );
            this.emitEvent('streamEnd', {});

            const msg = response.choices?.[0]?.message;
            const finishReason = response.choices?.[0]?.finish_reason;
            const usage = response.usage;

            // Extract token usage (pi-compatible)
            const tokenUsage: TokenUsage | undefined = usage ? {
                input: usage.prompt_tokens || 0,
                output: usage.completion_tokens || 0,
                cacheRead: usage.prompt_tokens_details?.cached_tokens || 0,
                cacheWrite: 0,
                totalTokens: usage.total_tokens || 0,
            } : undefined;

            // Note: content was already streamed via delta chunks above — don't re-emit.
            this.session.addAssistantMessage(
                msg?.content || null,
                msg?.tool_calls || undefined,
                tokenUsage,
                finishReason || undefined
            );

            if (msg?.content) {
                this.emitEvent('assistantMessage', { content: msg.content });
            }

            if (finishReason === 'tool_calls' && msg?.tool_calls && msg.tool_calls.length > 0) {
                const shouldTerminate = await this.executeToolCalls(msg.tool_calls);
                hasMoreToolCalls = !shouldTerminate;
            } else {
                hasMoreToolCalls = false;
            }

            // Check for steering messages between turns (pi-compatible)
            const pending = this.drainPendingMessages();
            if (pending.length > 0) {
                for (const pendingMsg of pending) {
                    this.session.addUserMessage(pendingMsg);
                    this.emitEvent('userMessage', { content: pendingMsg });
                }
                hasMoreToolCalls = true; // continue loop
            }
        }
    }

    private async executeToolCalls(toolCalls: any[]): Promise<boolean> {
        // Group tool calls: sequential tools run one-at-a-time, parallel tools run concurrently (pi-compatible)
        const signal = this.abortController?.signal;
        let shouldTerminate = false;

        // Parse all tool calls and determine their execution mode
        const parsed = toolCalls.map(tc => {
            const fn = tc.function;
            if (!fn) return null;
            let args: any = {};
            try { args = JSON.parse(fn.arguments || '{}'); } catch { /* empty */ }
            const tool = this.toolRegistry.get(fn.name);
            return { tc, fn, args, tool, mode: tool?.executionMode || 'sequential' };
        }).filter(Boolean) as Array<{ tc: any; fn: any; args: any; tool: any; mode: string }>;

        // Execute: sequential tools one by one, parallel tools as a batch
        let i = 0;
        while (i < parsed.length) {
            if (signal?.aborted) break;

            const item = parsed[i];

            if (item.mode === 'parallel') {
                // Collect all consecutive parallel tools into one batch
                const batch: typeof parsed = [];
                while (i < parsed.length && parsed[i].mode === 'parallel') {
                    batch.push(parsed[i]);
                    i++;
                }

                // Execute entire batch concurrently
                const results = await Promise.allSettled(batch.map(async (item) => {
                    this.emitEvent('toolCall', { id: item.tc.id, name: item.fn.name, arguments: item.args });
                    if (!item.tool) {
                        throw new Error(`Tool not found: ${item.fn.name}`);
                    }
                    const result = await item.tool.execute(item.args, signal);
                    return { item, result };
                }));

                for (const settled of results) {
                    if (settled.status === 'fulfilled') {
                        const { item: it, result } = settled.value;
                        const content = typeof result === 'string' ? result : (result?.content || JSON.stringify(result));
                        const isError = typeof result === 'object' && result?.isError;
                        if (typeof result === 'object' && result?.terminate) { shouldTerminate = true; }
                        this.session.addToolResult(it.tc.id, it.fn.name, content);
                        this.emitEvent('toolResult', { id: it.tc.id, name: it.fn.name, content, isError });
                    } else {
                        const it = batch[results.indexOf(settled)];
                        const errorContent = `Tool error: ${settled.reason?.message || 'unknown'}`;
                        this.session.addToolResult(it.tc.id, it.fn.name, errorContent);
                        this.emitEvent('toolResult', { id: it.tc.id, name: it.fn.name, content: errorContent, isError: true });
                    }
                }
            } else {
                // Sequential: execute one tool at a time
                this.emitEvent('toolCall', { id: item.tc.id, name: item.fn.name, arguments: item.args });

                if (!item.tool) {
                    const errorContent = `Tool not found: ${item.fn.name}`;
                    this.session.addToolResult(item.tc.id, item.fn.name, errorContent);
                    this.emitEvent('toolResult', { id: item.tc.id, name: item.fn.name, content: errorContent, isError: true });
                    i++;
                    continue;
                }

                try {
                    const result = await item.tool.execute(item.args, signal);
                    const content = typeof result === 'string' ? result : (result?.content || JSON.stringify(result));
                    const isError = typeof result === 'object' && result?.isError;
                    if (typeof result === 'object' && result?.terminate) { shouldTerminate = true; }
                    this.session.addToolResult(item.tc.id, item.fn.name, content);
                    this.emitEvent('toolResult', { id: item.tc.id, name: item.fn.name, content, isError });
                } catch (err: any) {
                    const errorContent = `Tool error: ${err.message}`;
                    this.session.addToolResult(item.tc.id, item.fn.name, errorContent);
                    this.emitEvent('toolResult', { id: item.tc.id, name: item.fn.name, content: errorContent, isError: true });
                }
                i++;
            }
        }

        return shouldTerminate;
    }

    /**
     * LLM-based compaction (pi-compatible).
     * Serializes conversation, sends to LLM for summarization, replaces old messages.
     */
    private async performCompaction(): Promise<void> {
        this.logger.info('Performing LLM-based compaction...');
        try {
            const conversation = this.session.serializeForCompaction(2000);
            const summaryPrompt = `${SUMMARIZATION_SYSTEM_PROMPT}\n\nConversation to summarize:\n\n${conversation}`;

            const config = getConfig();
            const summaryResponse = await this.client.chatCompletion(
                [{ role: 'user', content: summaryPrompt }],
                { model: config.api.model, maxTokens: 4096 }
            );

            const summary = summaryResponse.choices?.[0]?.message?.content;
            if (summary) {
                this.session.applyCompaction(summary, 10);
                this.logger.info('Compaction complete: summary injected');
            } else {
                // Fallback to simple truncation
                this.session.truncateToTokenLimit(config.agent.maxTokens * 2);
                this.logger.warn('LLM compaction returned no summary, used truncation fallback');
            }
        } catch (err: any) {
            // Fallback to simple truncation on error
            const config = getConfig();
            this.session.truncateToTokenLimit(config.agent.maxTokens * 2);
            this.logger.warn('LLM compaction failed (' + err.message + '), used truncation fallback');
        }
    }

    stop(): void {
        if (this.abortController) { this.abortController.abort(); }
    }

    clear(): void {
        this.session.clear();
        this.emitEvent('clear', {});
    }

    dispose(): void {
        this.stop();
        this.removeAllListeners();
    }

    [Symbol.dispose](): void { this.dispose(); }
}
