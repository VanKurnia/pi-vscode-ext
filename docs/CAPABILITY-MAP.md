# Pi Capability Map — pi-vscode-ext Bridge Reference

> Generated: 2026-07-01
> Source: @earendil-works/pi-agent-core v0.80.3, pi-ai v0.80.3, pi.dev/docs/latest/extensions

## Overview

| Category | Total | Direct Wrap | Needs Bridge | TUI-Only |
|----------|-------|-------------|-------------|----------|
| ExtensionAPI methods | 22 | 12 | 8 | 2 |
| Event types | 15 | 15 | 0 | 0 |
| UI capabilities | 8 | 2 | 4 | 2 |
| Tools | 56+ | All | 0 | 0 |
| **Overall** | ~100 | **~85%** | **~12%** | **~3%** |

## Architecture

```
┌─────────────────────────────────────────────┐
│ VSCode Extension (UI Layer)                 │
│  ├── vscode.chat ChatParticipant            │
│  ├── Status Bar, Tree Views                 │
│  └── Command Palette                        │
├─────────────────────────────────────────────┤
│ Bridge Layer (translator)                   │
│  VSCode API ↔ pi ExtensionAPI               │
├─────────────────────────────────────────────┤
│ @earendil-works/pi-agent-core  ← ASLI PI    │
│  ├── Agent Harness                          │
│  ├── Session (JSONL, tree-based)            │
│  ├── LLM Compaction                         │
│  ├── Tool Execution Engine (parallel/seq)   │
│  └── Steering Messages                      │
├─────────────────────────────────────────────┤
│ @earendil-works/pi-ai  ← ASLI PI           │
│  ├── Provider abstraction                   │
│  ├── Streaming (SSE)                        │
│  └── Multi-model support                    │
└─────────────────────────────────────────────┘
```

## Package Entry Points

### pi-agent-core
- `@earendil-works/pi-agent-core` — Browser-safe (no Node APIs)
- `@earendil-works/pi-agent-core/node` — Adds `NodeExecutionEnv` (bash, filesystem)

### pi-ai
- `@earendil-works/pi-ai` — Core types, auth, models, event-stream
- `@earendil-works/pi-ai/providers/*` — Provider factories (anthropic, openai, etc.)
- `@earendil-works/pi-ai/api/*` — API implementations (lazy-loaded)
- `@earendil-works/pi-ai/oauth` — OAuth flows

## Core Classes

### AgentHarness

```ts
class AgentHarness {
  constructor(config: AgentHarnessConfig)
  runAgentLoop(config: AgentLoopConfig): AssistantMessageEventStream
  abort(): void
  session: AgentSession
  registerTool(tool: ToolDefinition): void
  registerCommand(name: string, handler: CommandHandler): void
  registerShortcut(key: string, handler: () => void): void
  registerFlag(name: string, handler: FlagHandler): void
  registerProvider(name: string, config: ProviderConfig): void
  registerMessageRenderer(renderer: MessageRenderer): void
  addAutocompleteProvider(provider: AutocompleteProvider): void
  on(event: string, handler: EventHandler): void
  sendMessage(msg: AgentMessage): Promise<void>
  sendUserMessage(text: string): Promise<void>
  compact(prompt?: string): Promise<void>
  appendEntry(entry: SessionEntry): Promise<void>
  setModel(model: string): void
  setActiveTools(tools: string[]): void
  setThinkingLevel(level: ThinkingLevel): void
  setSessionName(name: string): void
  getSessionName(): string
  setStatus(id: string, text: string): void
  setWidget(id: string, lines: string[]): void
  setHeader(lines: string[]): void
  setFooter(lines: string[]): void
  setWorkingIndicator(config: WorkingIndicator): void
  setEditorComponent(component: CustomEditor): void
  setTheme(theme: Theme): void
}
```

### AgentSession

```ts
class AgentSession {
  id: string
  filePath: string
  entries: SessionEntry[]
  activeBranch: number[]
  goto(entryId: number): void
  fork(message: AgentMessage): void
  clone(): AgentSession
  save(): Promise<void>
  load(path: string): Promise<AgentSession>
  beforeCompact: BeforeCompactHandler
  name: string
  cost: CostBreakdown
  usage: TokenUsage
}
```

### ProviderRegistry

```ts
class ProviderRegistry {
  registerProvider(name: string, config: ProviderConfig): void
  resolveProvider(name: string): ProviderConfig
  listProviders(): string[]
}
```

### AuthStorage

```ts
class AuthStorage {
  getKey(provider: string): string | undefined
  setKey(provider: string, key: string): void
  deleteKey(provider: string): void
  getOAuthToken(provider: string): OAuthToken | undefined
  setOAuthToken(provider: string, token: OAuthToken): void
}
```

## Event System

| Event | Payload | Description |
|-------|---------|-------------|
| `session_start` | `{ session }` | Session initialized |
| `session_shutdown` | `{}` | Session ending |
| `session_before_compact` | `{ messages }` | Before compaction |
| `session_before_switch` | `{ target }` | Before switching session |
| `session_before_fork` | `{ message }` | Before forking |
| `turn_start` | `{ context, index }` | Agent turn starting |
| `turn_end` | `{ message, toolResults }` | Agent turn complete |
| `tool_call` | `{ toolName, input, assistantMessage }` | Before tool executes |
| `tool_result` | `{ toolName, input, result, isError }` | After tool executes |
| `user_message` | `{ content }` | User sent message |
| `model_request` | `{ model, context }` | Before LLM call |
| `model_response` | `{ model, usage }` | After LLM response |
| `before_agent_start` | `{ session, config }` | Before agent loop |
| `agent_end` | `{ message }` | Agent loop finished |
| `project_trust` | `{ projectPath }` | Trust decision |

## Tool Definition

```ts
interface ToolDefinition {
  name: string
  label?: string
  description: string
  parameters: TObject  // TypeBox schema
  executionMode?: 'sequential' | 'parallel'
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: (update: ToolUpdate) => void,
    ctx: ToolContext
  ) => Promise<ToolResult>
}

interface ToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; ... }>
  details?: Record<string, unknown>
  isError?: boolean
  terminate?: boolean
}
```

## ExtensionAPI Methods (Bridge Target)

### Direct Wrap (no bridge needed)
- `on(event, handler)` → Map to our event bus
- `registerTool(def)` → Register in agent harness
- `registerProvider(name, config)` → Direct pass-through
- `compact(prompt?)` → Direct pass-through
- `appendEntry(entry)` → Session persistence
- `setModel(model)` → Map to VSCode settings
- `setActiveTools(tools)` → Direct pass-through
- `setThinkingLevel(level)` → Map to ChatRequest
- `setSessionName(name)` → Direct pass-through
- `sendUserMessage(text)` → Queue user message
- `sendMessage(msg)` → Inject into session
- `exec(cmd, opts)` → Direct pass-through

### Needs Bridge Layer
| VSCode API | Pi API | Bridge |
|------------|--------|--------|
| `ChatParticipant` | `sendMessage()` | Map chat → `sendUserMessage()` |
| `ChatResponseStream` | `MessageRenderer` | Map stream → `stream.markdown()` |
| `StatusBar` | `setStatus()` | Direct map |
| `commands.registerCommand` | `registerCommand()` | Direct map |
| `InlineCompletionProvider` | `addAutocompleteProvider()` | Map completions |
| `Progress` API | `setWorkingIndicator()` | Map to `window.withProgress()` |
| `OutputChannel` | `setWidget()` | Map to output channel |
| `QuickPick`/`InputBox` | `ctx.ui.select/input/confirm` | Map to VSCode dialogs |

### TUI-Only (cannot wrap)
- `setHeader()` — TUI startup header
- `setEditorComponent()` — TUI editor replacement
- `setTheme()` — TUI terminal colors
- `ctx.ui.custom()` — TUI custom components

## LLM Provider Layer (pi-ai)

### Supported APIs
`openai-completions` | `openai-responses` | `anthropic-messages` | `google-generative-ai` | `google-vertex` | `bedrock-converse-stream` | `mistral-conversations` | `azure-openai-responses` | `openai-codex-responses`

### 35 Built-in Providers
`anthropic` | `openai` | `google` | `deepseek` | `xai` | `groq` | `cerebras` | `openrouter` | `mistral` | `fireworks` | `together` | `nvidia` | `github-copilot` | `amazon-bedrock` | `google-vertex` | ...

### Streaming Options
```ts
interface StreamOptions {
  signal?: AbortSignal
  thinking?: ThinkingLevel
  maxTokens?: number
  temperature?: number
  env?: ProviderEnv
  transport?: 'sse' | 'websocket' | 'websocket-cached' | 'auto'
  onToken?: (token: string) => void
  onUsage?: (usage: TokenUsage) => void
  onComplete?: (message: AssistantMessage) => void
}
```

## Implementation Phases

### Phase 1: Foundation
1. `npm install @earendil-works/pi-agent-core @earendil-works/pi-ai`
2. Create `src/bridge/pi-harness.ts` — instantiate AgentHarness
3. Create `src/bridge/session-bridge.ts` — map workspace ↔ session paths
4. Create `src/bridge/provider-bridge.ts` — map settings → ProviderRegistry

### Phase 2: Chat Integration
5. Rewrite `src/chat/participant.ts` — ChatParticipant → sendUserMessage()
6. Create `src/bridge/stream-bridge.ts` — stream → ChatResponseStream
7. Map tool definitions into registerTool() format

### Phase 3: Extension Loading
8. Create `src/bridge/extension-loader.ts` — load ~/.pi/agent/extensions/*.ts
9. Create `src/bridge/ui-bridge.ts` — ctx.ui.* → VSCode dialogs
10. Create `src/bridge/command-bridge.ts` — registerCommand → VSCode commands

### Phase 4: Cleanup
11. Delete reimplemented: session.ts, client.ts, manager.ts, prompts.ts
12. Keep: statusBar, treeViews, inlineCompletion, todoProvider
13. Update README

### Phase 5: QA & Publish
14. Test all 56 tools through bridge
15. Test extension loading
16. Package as .vsix
