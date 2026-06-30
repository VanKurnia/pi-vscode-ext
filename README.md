# Pi Agent — VS Code Extension

A powerful AI coding assistant for VS Code, inspired by GitHub Copilot. Connects to any OpenAI-compatible API for chat-based coding assistance, inline code completions, and multi-agent orchestration.

![VS Code](https://img.shields.io/badge/VS%20Code-1.90%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

### 🤖 Chat Sidebar
- Interactive chat panel in the sidebar for conversational coding assistance
- Supports slash commands (`/explain`, `/fix`, `/refactor`, `/test`, `/review`, `/commit`, `/plan`)
- Streaming responses with real-time updates
- Tool call execution with visible results

### 💡 Inline Code Completions
- GitHub Copilot-style inline suggestions as you type
- Configurable debounce and toggle on/off
- Context-aware (uses surrounding 30+ lines)

### 🛠️ Agent Tools (8 tools built-in)
| Tool | Description |
|------|-------------|
| `read_file` | Read file contents with line numbers |
| `write_file` | Create or overwrite files |
| `edit_file` | Find-and-replace with unified diff output |
| `bash` | Execute shell commands with safety guard |
| `grep` | Search file contents with regex |
| `find` | Find files by glob pattern |
| `git_*` | Git status, diff, add, commit, log, branch, show |
| `bashGuard` | Blocks dangerous commands (`rm -rf /`, `sudo`, etc.) |

### 🔒 Safety First
- **BashGuard** blocks destructive commands before execution
- Configurable safety toggle (`pi-agent.tools.enableBashGuard`)
- Sandboxed tool execution within workspace

### 👥 Multi-Agent System
- Discover and use custom agents from `.pi/agent/agents/` directory
- Built-in bundled agents: worker, reviewer, planner
- Agent-to-agent delegation (planner → worker → reviewer)
- Each agent can have its own model, tools, and system prompt

### 📊 Explorer Views
- **Agents** view — see available agents in the sidebar
- **File Changes** view — track lines added/removed per file

### ⌨️ Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` → `Pi Agent: Open Chat` | Open chat sidebar |
| Select code + `Ctrl+Shift+P` → `Explain` | Explain selected code |
| Select code + `Ctrl+Shift+P` → `Fix` | Fix selected code |
| `Ctrl+Shift+P` → `Pi Agent: Toggle Inline` | Toggle inline suggestions |

## Setup

### Prerequisites
- VS Code 1.90 or higher
- An OpenAI-compatible API endpoint (e.g., OpenAI, Ollama, LM Studio, vLLM, 9router)

### Installation

1. Clone this repo:
   ```bash
   git clone https://github.com/VanKurnia/pi-vscode-ext.git
   cd pi-vscode-ext
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npx webpack --mode production
   ```

4. Open in VS Code and press `F5` to launch Extension Development Host

### Configuration

Open VS Code Settings (`Ctrl+,`) and search for `pi-agent`:

| Setting | Default | Description |
|---------|---------|-------------|
| `pi-agent.api.baseUrl` | `http://localhost:8080/v1` | OpenAI-compatible API base URL |
| `pi-agent.api.apiKey` | `""` | API key (leave empty for local APIs) |
| `pi-agent.api.model` | `versatile` | Default model for chat |
| `pi-agent.api.chatModel` | `""` | Override model for chat (optional) |
| `pi-agent.api.completionModel` | `""` | Override model for completions (optional) |
| `pi-agent.agent.maxTokens` | `4096` | Max tokens per response |
| `pi-agent.agent.temperature` | `0.7` | Sampling temperature |
| `pi-agent.inlineSuggestions.enabled` | `false` | Enable inline completions |
| `pi-agent.inlineSuggestions.debounceMs` | `500` | Debounce for inline suggestions |
| `pi-agent.tools.enableBashGuard` | `true` | Block dangerous shell commands |
| `pi-agent.tools.enableGit` | `true` | Enable git tools |
| `pi-agent.subagents.maxConcurrency` | `4` | Max parallel agents |
| `pi-agent.subagents.agentsDir` | `""` | Custom agents directory |

### Example: Connecting to 9router
```json
{
    "pi-agent.api.baseUrl": "http://localhost:8080/v1",
    "pi-agent.api.model": "versatile"
}
```

### Example: Connecting to OpenAI
```json
{
    "pi-agent.api.baseUrl": "https://api.openai.com/v1",
    "pi-agent.api.apiKey": "sk-...",
    "pi-agent.api.model": "gpt-4o"
}
```

## Usage

### Chat Sidebar
1. Click the Pi Agent icon in the activity bar (left side)
2. Type your question or request in the chat input
3. Watch the agent use tools and respond in real-time

### Slash Commands
Type these in the chat input:
- `/explain` — Explain the active file or selected code
- `/fix` — Fix selected code (includes diagnostic errors)
- `/refactor` — Refactor selected code
- `/test` — Generate tests for the active file
- `/review` — Code review the active file or selection
- `/commit` — Generate a conventional commit message
- `/plan` — Enter planning mode
- `/scout <task>` — Quick investigation
- `/research <topic>` — Research a topic
- `/clear` — Clear conversation history

### Inline Completions
1. Enable in settings: `pi-agent.inlineSuggestions.enabled: true`
2. Start typing code — suggestions appear as ghost text
3. Press `Tab` to accept, `Escape` to dismiss

### Creating Custom Agents
Create a `.md` file in `~/.pi/agent/agents/` or `.pi/agent/agents/` in your workspace:

```markdown
---
name: security-auditor
description: Audits code for security vulnerabilities
model: gpt-4o
tools: read_file,grep,find,bash
---

You are a security auditor. Review code for:
1. SQL injection vulnerabilities
2. XSS vulnerabilities
3. Authentication/authorization flaws
4. Sensitive data exposure
5. Insecure dependencies

For each issue found, provide severity, location, and fix recommendation.
```

## Architecture

```
pi-vscode-ext/
├── src/
│   ├── extension.ts          # Entry point — activation & registration
│   ├── agent/
│   │   ├── client.ts         # OpenAI-compatible HTTP client (streaming)
│   │   ├── manager.ts        # Agent orchestrator with tool loop
│   │   ├── session.ts        # Conversation history management
│   │   ├── tools.ts          # Tool registry & type definitions
│   │   ├── agents.ts         # Agent discovery from .md files
│   │   └── prompts.ts        # System prompt builder
│   ├── tools/
│   │   ├── bash.ts           # Shell execution tool
│   │   ├── bashGuard.ts      # Safety guard for shell commands
│   │   ├── readFile.ts       # File reading tool
│   │   ├── writeFile.ts      # File writing tool
│   │   ├── editFile.ts       # Find-and-replace edit tool
│   │   ├── git.ts            # Git operations tools
│   │   ├── search.ts         # Grep & find tools
│   │   └── index.ts          # Tool registration
│   ├── ui/
│   │   ├── chatViewProvider.ts    # Sidebar chat webview
│   │   ├── webviewContent.ts      # Chat HTML/CSS/JS
│   │   ├── inlineCompletion.ts    # Inline suggestions provider
│   │   ├── statusBar.ts           # Status bar manager
│   │   ├── agentsTreeProvider.ts  # Agents explorer view
│   │   └── changesTreeProvider.ts # File changes tracking view
│   ├── commands/
│   │   └── index.ts          # All command implementations
│   └── utils/
│       ├── config.ts         # Configuration reader
│       ├── context.ts        # Editor context builder
│       ├── logger.ts         # Output channel logger
│       └── diff.ts           # Diff utilities
├── agents/                   # Bundled agent definitions
│   ├── worker.md
│   ├── reviewer.md
│   └── planner.md
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript config
└── webpack.config.js         # Build config
```

### How It Works

1. **Extension activates** when VS Code starts or when a Pi Agent command is triggered
2. **Manager** (`PiAgentManager`) creates a session and registers all tools
3. **User sends a message** → Manager adds context (active file, selection, diagnostics)
4. **Agent loop**: Send message + tool definitions to LLM → If LLM calls a tool, execute it and send result back → Repeat until LLM gives a final answer
5. **Streaming**: Each chunk from the LLM is forwarded to the chat webview in real-time
6. **Inline completions**: A separate lighter model call provides code completions at cursor position

## Development

### Build
```bash
npm run compile        # TypeScript compile
npx webpack --mode production  # Production bundle
```

### Watch mode
```bash
npm run watch
```

### Package for distribution
```bash
npm install -g @vscode/vsce
vsce package
```

## License

MIT
