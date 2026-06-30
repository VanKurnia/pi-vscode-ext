import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { LlmClient } from './client';
import { Session } from './session';
import { ToolRegistry } from './tools';
import { buildSystemPrompt } from './prompts';
import { discoverAgents, AgentConfig, resolveModel } from './agents';
import { getConfig } from '../utils/config';
import { Logger } from '../utils/logger';
import { registerAllTools } from '../tools';

export type AgentEvent = 'userMessage' | 'assistantMessage' | 'toolCall' | 'toolResult' | 'streamChunk' | 'error' | 'clear' | 'status';

export interface AgentEventData {
    type: AgentEvent;
    data: any;
}

export class PiAgentManager extends EventEmitter {
    private client: LlmClient;
    private session: Session;
    private toolRegistry: ToolRegistry;
    private agents: AgentConfig[] = [];
    private logger = Logger.getInstance();
    private abortController: AbortController | null = null;
    private isProcessing = false;

    constructor() {
        super();
        this.client = new LlmClient();
        this.toolRegistry = new ToolRegistry();
        const config = getConfig();
        this.session = new Session(buildSystemPrompt(), config.agent.maxTokens, config.api.model, config.api.baseUrl);
        registerAllTools(this.toolRegistry);
        this.refreshAgents();
        this.logger.info('PiAgentManager initialized');
    }

    refreshAgents(): void {
        try {
            const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            this.agents = discoverAgents(ws);
            this.logger.info(`Discovered ${this.agents.length} agents`);
        } catch (err: any) { this.logger.warn(`Agent discovery failed: ${err.message}`); }
    }

    getAgents(): AgentConfig[] { return [...this.agents]; }

    getSessionContext() {
        const ctx = this.session.getContext();
        const config = getConfig();
        return { ...ctx, maxTokens: config.agent.maxTokens, model: config.api.model, provider: config.api.baseUrl };
    }

    getToolRegistry(): ToolRegistry { return this.toolRegistry; }
    isBusy(): boolean { return this.isProcessing; }

    emitEvent(type: AgentEvent, data: any): void { this.emit('event', { type, data } as AgentEventData); }

    async processUserMessage(content: string, context?: string): Promise<void> {
        if (this.isProcessing) { this.emitEvent('error', { message: 'Already processing. Please wait.' }); return; }
        this.isProcessing = true;
        this.abortController = new AbortController();
        this.emitEvent('status', { status: 'thinking' });

        try {
            const fullContent = context ? `${content}\n\n---\nContext:\n${context}` : content;
            this.session.addUserMessage(fullContent);
            this.emitEvent('userMessage', { content });
            await this.agentLoop();
        } catch (err: any) {
            if (err.name === 'AbortError') this.emitEvent('assistantMessage', { content: '*[Stopped]*' });
            else { this.logger.error(`Error: ${err.message}`, err); this.emitEvent('error', { message: err.message }); }
        } finally {
            this.isProcessing = false;
            this.abortController = null;
            this.emitEvent('status', { status: 'idle' });
        }
    }

    async processAgentMessage(agentName: string, task: string): Promise<void> {
        const agent = this.agents.find(a => a.name === agentName);
        if (!agent) { this.emitEvent('error', { message: `Agent not found: ${agentName}` }); return; }
        const config = getConfig();
        const model = resolveModel(agent.model) || config.api.model;
        const agentSession = new Session(agent.systemPrompt || buildSystemPrompt(), config.agent.maxTokens, model);
        agentSession.addUserMessage(task);
        this.isProcessing = true;
        this.emitEvent('status', { status: 'thinking', agent: agentName });
        this.emitEvent('toolCall', { name: 'subagent', arguments: { agent: agentName, task } });

        try {
            const tools = this.toolRegistry.toFunctionDefinitions();
            const response = await this.client.chatCompletion(agentSession.getMessagesForApi(), { model, tools: tools.length > 0 ? tools : undefined });
            const content = response.choices?.[0]?.message?.content || '';
            this.emitEvent('assistantMessage', { content, agent: agentName });
            this.emitEvent('toolResult', { name: 'subagent', result: { content: content || '(no output)', agent: agentName } });
        } catch (err: any) {
            this.logger.error(`Agent ${agentName} error: ${err.message}`);
            this.emitEvent('error', { message: `Agent ${agentName}: ${err.message}` });
        } finally {
            this.isProcessing = false;
            this.emitEvent('status', { status: 'idle' });
        }
    }

    private async agentLoop(): Promise<void> {
        const config = getConfig();
        const tools = this.toolRegistry.toFunctionDefinitions();
        const MAX_ITER = 15;

        for (let i = 0; i < MAX_ITER; i++) {
            const messages = this.session.getMessagesForApi();
            this.emitEvent('status', { status: 'thinking' });

            let fullContent = '';
            const response = await this.client.streamCompletion(
                messages,
                { tools: tools.length > 0 ? tools : undefined, maxTokens: config.agent.maxTokens },
                (chunk: any) => {
                    for (const choice of chunk.choices) {
                        if (choice.delta.content) {
                            fullContent += choice.delta.content;
                            this.emitEvent('streamChunk', { content: choice.delta.content, fullContent });
                        }
                    }
                },
                this.abortController?.signal
            );

            const finalChoice = response.choices[0];
            if (!finalChoice) throw new Error('No response');

            const finalToolCalls = finalChoice.message.tool_calls;
            if (finalToolCalls && finalToolCalls.length > 0) {
                this.session.addAssistantMessage(finalChoice.message.content || fullContent || null, finalToolCalls);
                this.emitEvent('assistantMessage', { content: finalChoice.message.content || fullContent || null, toolCalls: finalToolCalls });

                for (const tc of finalToolCalls) {
                    this.emitEvent('toolCall', { id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
                    let args: any;
                    try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
                    const result = await this.toolRegistry.executeTool(tc.function.name, args);
                    this.session.addToolResult(tc.id, tc.function.name, result.content);
                    this.emitEvent('toolResult', { id: tc.id, name: tc.function.name, result });
                }
                continue;
            }

            if (fullContent) {
                this.session.addAssistantMessage(fullContent);
                this.emitEvent('assistantMessage', { content: fullContent });
            }
            return;
        }
        this.emitEvent('error', { message: 'Max iterations exceeded' });
    }

    stop(): void { if (this.abortController) this.abortController.abort(); }

    clearSession(): void {
        this.session.clear();
        this.emitEvent('clear', {});
    }

    getHistory() { return this.session.getHistory(); }
}
