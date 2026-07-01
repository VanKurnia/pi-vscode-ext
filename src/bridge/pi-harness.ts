/**
 * Pi Harness — factory for creating and configuring the AgentHarness.
 *
 * This is the main entry point for the bridge layer. It:
 * 1. Creates a NodeExecutionEnv for the workspace (filesystem + shell)
 * 2. Creates or opens a JSONL session
 * 3. Resolves models from VSCode settings
 * 4. Instantiates AgentHarness with all configuration
 * 5. Returns a ready-to-use PiBridgeContext
 *
 * Usage:
 *   const bridge = await createBridge(context);
 *   const response = await bridge.harness.prompt("Hello!");
 */

import * as vscode from 'vscode';
import {
    NodeExecutionEnv,
    AgentHarness,
    type AgentHarnessOptions,
    type Skill,
    type PromptTemplate,
    type AgentTool,
} from '@earendil-works/pi-agent-core/node';
import type { Model } from '@earendil-works/pi-ai';
import type { PiBridgeConfig, PiBridgeContext } from './types';
import {
    resolveChatModel,
    resolveCompletionModel,
    createApiKeyResolver,
    buildProviderConfig,
} from './provider-bridge';
import { createSessionRepo, openOrCreateSession, getWorkspaceCwd } from './session-bridge';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

/**
 * Read PiBridgeConfig from VSCode settings.
 *
 * Reads all pi-agent.* settings and returns them as a structured config.
 */
export function readConfig(): PiBridgeConfig {
    const c = vscode.workspace.getConfiguration('pi-agent');
    return {
        api: {
            baseUrl: c.get<string>('api.baseUrl', 'http://localhost:8080/v1'),
            apiKey: c.get<string>('api.apiKey', ''),
            model: c.get<string>('api.model', 'versatile'),
            chatModel: c.get<string>('api.chatModel', ''),
            completionModel: c.get<string>('api.completionModel', ''),
        },
        agent: {
            maxTokens: c.get<number>('agent.maxTokens', 16384),
            temperature: c.get<number>('agent.temperature', 0.7),
            systemPrompt: c.get<string>('agent.systemPrompt', ''),
        },
    };
}

/**
 * Create a fully configured PiBridgeContext.
 *
 * Called once during extension activation. Sets up the complete
 * pi-agent-core harness with:
 * - NodeExecutionEnv (filesystem + bash) for the workspace
 * - JSONL session with tree-based persistence
 * - AgentHarness configured with model, API key, stream options
 * - VSCode settings change listener for live model switching
 *
 * @param context - VSCode ExtensionContext for lifecycle management
 * @returns PiBridgeContext ready to process user messages
 */
export async function createBridge(context: vscode.ExtensionContext): Promise<PiBridgeContext> {
    const config = readConfig();
    const cwd = getWorkspaceCwd();

    logger.info(`[pi-harness] Creating bridge for workspace: ${cwd}`);

    // 1. Create execution environment (filesystem + shell)
    //    This is shared between the harness and session repo
    const env = new NodeExecutionEnv({ cwd });

    // 2. Create session repo and open/create session
    const sessionRepo = createSessionRepo(env);
    const session = await openOrCreateSession(sessionRepo, cwd);

    // 3. Resolve models from settings
    const providerConfig = buildProviderConfig(config);
    const { model: chatModel } = resolveChatModel(providerConfig);
    const { model: completionModel } = resolveCompletionModel(providerConfig);

    // 4. Build system prompt
    const systemPrompt = buildSystemPrompt(config, cwd);

    // 5. Configure AgentHarness — this is the core of pi-agent-core
    //    AgentHarnessOptions interface:
    //    - env: ExecutionEnv (NodeExecutionEnv provides bash + filesystem)
    //    - session: Session (JSONL-backed, tree-based)
    //    - model: Model (pi-ai Model descriptor)
    //    - getApiKeyAndHeaders: auth callback
    //    - systemPrompt: static string or dynamic callback
    //    - streamOptions: timeout/retry config
    //    - tools: additional tools (we'll add in M2)
    //    - resources: skills + prompt templates (we'll add in M3)
    const harnessOptions: AgentHarnessOptions = {
        env,
        session,
        model: chatModel as Model<any>,
        thinkingLevel: 'off',
        systemPrompt,
        getApiKeyAndHeaders: createApiKeyResolver(providerConfig),
        streamOptions: {
            timeoutMs: 120_000,
            maxRetries: 2,
        },
    };

    const harness = new AgentHarness(harnessOptions);

    logger.info(`[pi-harness] AgentHarness created: model=${chatModel.id}, baseUrl=${chatModel.baseUrl}`);

    // 6. Wire up VSCode settings change listener for live model switching
    const configListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('pi-agent')) {
            const newConfig = readConfig();
            const newProviderConfig = buildProviderConfig(newConfig);
            const { model: newModel } = resolveChatModel(newProviderConfig);
            try {
                await harness.setModel(newModel as Model<any>);
                logger.info(`[pi-harness] Model switched to: ${newModel.id}`);
            } catch (err) {
                logger.warn(`[pi-harness] Failed to switch model: ${err}`);
            }
        }
    });
    context.subscriptions.push({ dispose: () => configListener.dispose() });

    return {
        harness,
        session,
        chatModel,
        completionModel,
        config,
        dispose: async () => {
            configListener.dispose();
            await env.cleanup();
        },
    };
}

/**
 * Build the system prompt from config + workspace context.
 *
 * Combines a base prompt with the user's custom system prompt from settings.
 * pi's AGENTS.md loading will supplement this in later milestones.
 */
function buildSystemPrompt(config: PiBridgeConfig, cwd: string): string {
    const parts: string[] = [];

    // Base prompt
    parts.push(
        'You are Pi Agent, an AI coding assistant running inside VS Code.',
        `Working directory: ${cwd}`,
        'You have access to tools for reading, writing, and editing files, executing shell commands, and more.',
        'Be concise and helpful. Use tools when needed to accomplish tasks.',
    );

    // User custom prompt from settings
    if (config.agent.systemPrompt) {
        parts.push(config.agent.systemPrompt);
    }

    return parts.join('\n\n');
}
