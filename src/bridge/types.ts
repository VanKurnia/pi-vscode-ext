/**
 * Shared types for the pi-vscode-ext bridge layer.
 *
 * Maps VSCode extension concepts to pi-agent-core / pi-ai types.
 */

import type { Model, ThinkingLevel } from '@earendil-works/pi-ai';
import type {
    AgentHarness,
    Skill,
    PromptTemplate,
    AgentTool,
    Session,
    JsonlSessionMetadata,
} from '@earendil-works/pi-agent-core/node';

// ─── VSCode Extension Settings ──────────────────────────────────────────────

/** API settings from VSCode configuration (pi-agent.api.*). */
export interface ApiSettings {
    baseUrl: string;
    apiKey: string;
    model: string;
    chatModel: string;
    completionModel: string;
}

/** Agent settings from VSCode configuration (pi-agent.agent.*). */
export interface AgentSettings {
    maxTokens: number;
    temperature: number;
    systemPrompt: string;
}

/** Full extension settings shape matching VSCode config namespace. */
export interface PiBridgeConfig {
    api: ApiSettings;
    agent: AgentSettings;
}

// ─── Provider Bridge ────────────────────────────────────────────────────────

/** Configuration for the provider bridge. */
export interface ProviderConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    chatModel: string;
    completionModel: string;
    maxTokens: number;
    temperature: number;
}

/** Result of model resolution. */
export interface ResolvedModel {
    /** pi Model object ready for use with AgentHarness. */
    model: Model<'openai-completions'>;
    /** The raw model ID string. */
    modelId: string;
    /** Source of the resolution. */
    source: 'chat' | 'completion' | 'default';
}

// ─── Session Bridge ─────────────────────────────────────────────────────────

/** Options for creating a new session. */
export interface CreateSessionOptions {
    cwd?: string;
    displayName?: string;
}

/** Options for listing sessions. */
export interface ListSessionOptions {
    cwd?: string;
}

// ─── Harness Bridge ─────────────────────────────────────────────────────────

/** Type alias for the configured harness. */
export type PiHarness = AgentHarness;

/** Type alias for the session type used in the bridge. */
export type PiSession = Session<JsonlSessionMetadata>;

/** The full bridge context returned by createBridge(). */
export interface PiBridgeContext {
    /** The configured agent harness. */
    harness: PiHarness;
    /** The current session. */
    session: PiSession;
    /** The resolved chat model. */
    chatModel: Model<'openai-completions'>;
    /** The resolved completion model (for inline suggestions). */
    completionModel: Model<'openai-completions'>;
    /** The bridge configuration. */
    config: PiBridgeConfig;
    /** Dispose of resources. */
    dispose: () => Promise<void>;
}
