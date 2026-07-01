/**
 * Bridge layer — exports for pi-agent-core ↔ VSCode integration.
 *
 * This module is the public API of the bridge layer. Import from here
 * to use the bridge in other parts of the extension.
 *
 * Usage:
 * ```ts
 * import { createBridge, readConfig } from './bridge';
 * const bridge = await createBridge(context);
 * const response = await bridge.harness.prompt('Hello!');
 * ```
 */

// Harness factory
export { createBridge, readConfig } from './pi-harness';

// Provider bridge — model resolution and API key management
export {
    createModelFromSettings,
    resolveChatModel,
    resolveCompletionModel,
    createApiKeyResolver,
    buildProviderConfig,
} from './provider-bridge';

// Session bridge — session management
export {
    createSessionRepo,
    createSession,
    openOrCreateSession,
    forkSession,
    listSessions,
    deleteSession,
    getWorkspaceCwd,
} from './session-bridge';

// Types
export type {
    PiBridgeConfig,
    PiBridgeContext,
    PiHarness,
    PiSession,
    ApiSettings,
    AgentSettings,
    ProviderConfig,
    ResolvedModel,
    CreateSessionOptions,
    ListSessionOptions,
} from './types';
