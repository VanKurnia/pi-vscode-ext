/**
 * Bridge layer — exports for pi-agent-core ↔ VSCode integration.
 */

// Harness factory
export { createBridge, readConfig } from './pi-harness';

// Provider bridge
export {
    createModelFromSettings,
    resolveChatModel,
    resolveCompletionModel,
    createApiKeyResolver,
    buildProviderConfig,
} from './provider-bridge';

// Session bridge
export {
    createSessionRepo,
    createSession,
    openOrCreateSession,
    forkSession,
    listSessions,
    deleteSession,
    getWorkspaceCwd,
} from './session-bridge';

// Stream bridge — harness events → VSCode ChatResponseStream
export { streamFromHarness } from './stream-bridge';

// UI bridge — VSCode dialogs for agent interaction
export { createUIBridge, type UIBridge } from './ui-bridge';

// Command bridge — register agent commands with VSCode command palette
export { registerAgentCommands } from './command-bridge';

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
