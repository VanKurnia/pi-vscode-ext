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
        this.emitEvent('status', { status: 'thinking', agent: agentName });
        this.emitEvent('toolCall', { name: 'subagent', arguments: { agent: agentName, task } });

        try {
            const toolNames = agent.tools.length > 0 ? agent.tools : undefined;
            const tools = this.toolRegistry.toFunctionDefinitions(toolNames);
            const response = await this.client.chatCompletion(agentSession.getMessagesForApi(), { model, tools: tools.length > 0 ? tools : undefined });
            const msg = response.choices?.[0]?.message;
            if (msg?.content) {
                this.emitEvent('assistantMessage', { content: msg.content, agent: agentName });
            }
        } catch (err: any) {
            this.logger.error('Agent error: ' + err.message, err);
            this.emitEvent('error', { message: err.message });
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

            // Build assistant message with content
            if (msg?.content) {
                this.emitEvent('streamChunk', { content: msg.content });
            }

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
                hasMoreToolCalls = true;
                await this.executeToolCalls(msg.tool_calls);
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

    private async executeToolCalls(toolCalls: any[]): Promise<void> {
        for (const toolCall of toolCalls) {
            const fn = toolCall.function;
            if (!fn) continue;

            let args: any = {};
            try { args = JSON.parse(fn.arguments || '{}'); } catch { /* empty */ }

            this.emitEvent('toolCall', { id: toolCall.id, name: fn.name, arguments: args });

            const tool = this.toolRegistry.get(fn.name);
            if (!tool) {
                const errorContent = `Tool not found: ${fn.name}`;
                this.session.addToolResult(toolCall.id, fn.name, errorContent);
                this.emitEvent('toolResult', { id: toolCall.id, name: fn.name, content: errorContent, isError: true });
                continue;
            }

            try {
                // Pass abort signal to tools (pi-compatible)
                const result = await tool.execute(args, this.abortController?.signal);
                const content = typeof result === 'string' ? result : (result?.content || JSON.stringify(result));
                const isError = typeof result === 'object' && result?.isError;
                this.session.addToolResult(toolCall.id, fn.name, content);
                this.emitEvent('toolResult', { id: toolCall.id, name: fn.name, content, isError });
            } catch (err: any) {
                const errorContent = `Tool error: ${err.message}`;
                this.session.addToolResult(toolCall.id, fn.name, errorContent);
                this.emitEvent('toolResult', { id: toolCall.id, name: fn.name, content: errorContent, isError: true });
            }
        }
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
