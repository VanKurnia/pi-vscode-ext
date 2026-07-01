/**
 * Compatibility types — minimal interfaces that replace the old agent/* types.
 *
 * These interfaces allow the UI components (statusBar, agentsTreeProvider,
 * inlineCompletion) and tools (subagent, recall, index) to work with
 * the AgentHarness from pi-agent-core without importing the old
 * manager.ts, client.ts, session.ts, or prompts.ts.
 *
 * As the bridge layer matures, these can be replaced with direct
 * pi-agent-core type imports.
 */

/** Minimal interface for the agent harness (replaces PiAgentManager) */
export interface AgentLike {
    on?(event: string, handler: (...args: any[]) => void): void;
    off?(event: string, handler: (...args: any[]) => void): void;
    refreshAgents?(): void;
    getModel?(): string;
    getSession?(): any;
    dispose?(): void;
}

/** Minimal interface for LLM client (replaces LlmClient) */
export interface LlmClientLike {
    chat(params: ChatParams): Promise<string>;
    stream?(params: ChatParams, onChunk: (chunk: string) => void): Promise<void>;
    abort?(): void;
}

export interface ChatParams {
    model?: string;
    messages: Array<{ role: string; content: string }>;
    max_tokens?: number;
    temperature?: number;
    tools?: any[];
    signal?: AbortSignal;
}

/** Minimal session interface (replaces Session from session.ts) */
export interface SessionLike {
    getMessages(): ChatMessageLike[];
    addMessage(msg: ChatMessageLike): void;
}

export interface ChatMessageLike {
    role: string;
    content: string;
    timestamp?: number;
    toolCalls?: any[];
    toolResults?: any[];
}

/** Agent config (from agents.ts) */
export interface AgentConfigLike {
    name: string;
    description: string;
    systemPrompt: string;
    tools?: string[];
    model?: string;
}
