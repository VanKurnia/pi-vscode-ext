/**
 * Provider bridge: maps VSCode extension settings to pi-ai Model objects.
 *
 * Creates Model<"openai-completions"> from user-configured VSCode settings
 * so the extension can use pi's built-in OpenAI-completions provider
 * against any compatible endpoint (9router, Ollama, OpenAI, etc.).
 */

import type { Model } from '@earendil-works/pi-ai';
import type { ProviderConfig, ResolvedModel } from './types.js';
import { Logger } from '../utils/logger.js';

const logger = Logger.getInstance();

// ─── Model Factory ──────────────────────────────────────────────────────────

/**
 * Create a pi Model<"openai-completions"> from provider config.
 *
 * pi-ai's streamSimple() uses this descriptor to route requests to the
 * correct API implementation (openai-completions protocol).
 */
export function createModelFromSettings(config: ProviderConfig, modelId: string): Model<'openai-completions'> {
    const model: Model<'openai-completions'> = {
        id: modelId,
        name: modelId,
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: normalizeBaseUrl(config.baseUrl),
        reasoning: false,
        input: ['text', 'image'],
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
        },
        contextWindow: 128_000,
        maxTokens: config.maxTokens,
        compat: {
            // Conservative defaults for custom OpenAI-compatible endpoints
            supportsStore: false,
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
            supportsUsageInStreaming: true,
            requiresToolResultName: false,
            requiresAssistantAfterToolResult: false,
            requiresThinkingAsText: false,
        },
    };

    logger.debug(`[provider-bridge] Created model: id=${modelId}, baseUrl=${model.baseUrl}`);
    return model;
}

// ─── Model Resolution ───────────────────────────────────────────────────────

/**
 * Resolve which model to use for chat.
 *
 * Resolution order:
 *   1. pi-agent.api.chatModel if non-empty
 *   2. pi-agent.api.model (default)
 */
export function resolveChatModel(config: ProviderConfig): ResolvedModel {
    const modelId = config.chatModel || config.model;
    const source: ResolvedModel['source'] = config.chatModel ? 'chat' : 'default';
    const model = createModelFromSettings(config, modelId);

    logger.info(`[provider-bridge] Chat model: ${modelId} (source=${source})`);
    return { model, modelId, source };
}

/**
 * Resolve which model to use for inline completions.
 *
 * Resolution order:
 *   1. pi-agent.api.completionModel if non-empty
 *   2. pi-agent.api.model (default)
 */
export function resolveCompletionModel(config: ProviderConfig): ResolvedModel {
    const modelId = config.completionModel || config.model;
    const source: ResolvedModel['source'] = config.completionModel ? 'completion' : 'default';
    const model = createModelFromSettings(config, modelId);

    logger.info(`[provider-bridge] Completion model: ${modelId} (source=${source})`);
    return { model, modelId, source };
}

// ─── API Key Provider ───────────────────────────────────────────────────────

/**
 * Create a getApiKeyAndHeaders callback for AgentHarness.
 *
 * AgentHarness calls this before each provider request to get auth credentials.
 * Returns the user-configured API key, or undefined if not set (for local providers).
 */
export function createApiKeyResolver(
    config: ProviderConfig
): (model: Model<any>) => Promise<{ apiKey: string; headers?: Record<string, string> } | undefined> {
    return async (model: Model<any>) => {
        if (!config.apiKey) {
            logger.warn(`[provider-bridge] No API key configured for model ${model.id}`);
            return undefined;
        }
        return { apiKey: config.apiKey };
    };
}

// ─── Config Builder ─────────────────────────────────────────────────────────

/**
 * Build a ProviderConfig from raw VSCode extension settings.
 */
export function buildProviderConfig(settings: {
    api: { baseUrl: string; apiKey: string; model: string; chatModel: string; completionModel: string };
    agent: { maxTokens: number; temperature: number };
}): ProviderConfig {
    return {
        baseUrl: settings.api.baseUrl,
        apiKey: settings.api.apiKey,
        model: settings.api.model,
        chatModel: settings.api.chatModel,
        completionModel: settings.api.completionModel,
        maxTokens: settings.agent.maxTokens,
        temperature: settings.agent.temperature,
    };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Normalize base URL by removing trailing slashes. */
function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '');
}
