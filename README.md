# π Agent — AI Coding Assistant for VS Code

A powerful AI coding agent extension for VS Code, inspired by GitHub Copilot Chat. Connects to any OpenAI-compatible LLM API and provides a full-featured coding assistant with tools, subagents, slash commands, and a modern chat UI.

![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Features

### 🤖 AI Chat Sidebar
- Modern Copilot Chat-style UI with dark theme
- Streaming responses with real-time rendering
- Code blocks with copy button and syntax highlighting
- Tool call cards (collapsible, with status indicators)
- Slash command quick actions on welcome screen
- Status bar with live state indicator

### 🛠️ 18 Built-in Tools

| Category | Tools | Description |
|----------|-------|-------------|
| **File** | `read_file`, `write_file`, `edit_file`, `replace_in_file` | Read, write, edit, and replace file content |
| **Search** | `grep`, `find` | Regex content search, glob file search |
| **Shell** | `bash`, `ls`, `pwd` | Execute commands with safety guard |
| **Git** | `git_status`, `git_diff`, `git_diff_staged`, `git_add`, `git_commit`, `git_log`, `git_branch`, `git_show`, `git_reset` | Full git workflow |
| **VSCode** | `context`, `get_diagnostics`, `get_open_editors` | Workspace awareness |
| **AI** | `subagent` | Delegate tasks to isolated AI subagents |

### 💬 Slash Commands

| Command | Description |
|---------|-------------|
| `/explain` | Explain selected code or current file |
| `/fix` | Fix errors in selected code |
| `/refactor` | Refactor selected code |
| `/test` | Generate tests for selected code |
| `/review` | Review code for issues and improvements |
| `/commit` | Generate a conventional commit message |
| `/plan [task]` | Toggle plan mode (optional: generate plan for task) |
| `/scout <query>` | Quick codebase reconnaissance |
| `/research <topic>` | Research a topic |
| `/clear` | Clear chat history |
| `/help` | Show all available commands |

### 🔒 Safety Features
- **BashGuard** — blocks dangerous commands (`rm -rf /`, `sudo`, reverse shells, fork bombs)
- **Path traversal protection** in git operations
- **Confirmation prompts** for destructive operations

### 📝 Inline Code Suggestions
- Context-aware ghost text suggestions as you type
- Configurable debounce delay
- Toggle on/off via command palette or settings

### 🔍 Explorer Views
- **Agents** — discover and select AI agents
- **Changes** — track file modifications with added/removed line counts

## 🚀 Quick Start

### 1. Install

```bash
# Clone the repository
git clone https://github.com/VanKurnia/pi-vscode-ext.git
cd pi-vscode-ext

# Install dependencies
npm install

# Open in VS Code
code .
```

### 2. Run (Development)

Press **F5** to launch the Extension Development Host.

### 3. Configure API

In the new VS Code window, open Settings (`Ctrl+,`) and configure:

```json
{
    "pi-agent.api.baseUrl": "http://localhost:8080/v1",
    "pi-agent.api.apiKey": "your-api-key",
    "pi-agent.api.model": "your-model"
}
```

### 4. Start Chatting

- Click the **π Agent** icon in the activity bar (left sidebar)
- Type a message or use `/` commands
- Select code in the editor → right-click → **Pi Agent** menu

## ⚙️ Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `pi-agent.api.baseUrl` | string | `http://localhost:8080/v1` | OpenAI-compatible API endpoint |
| `pi-agent.api.apiKey` | string | `""` | API key (empty for local providers) |
| `pi-agent.api.model` | string | `versatile` | Default model |
| `pi-agent.api.chatModel` | string | `""` | Model for chat (overrides default) |
| `pi-agent.api.completionModel` | string | `""` | Model for inline completions |
| `pi-agent.agent.maxTokens` | number | `16384` | Max tokens per response |
| `pi-agent.agent.temperature` | number | `0.7` | Temperature |
| `pi-agent.agent.systemPrompt` | string | `""` | Custom system prompt (appended) |
| `pi-agent.inlineSuggestions.enabled` | boolean | `false` | Enable inline suggestions |
| `pi-agent.inlineSuggestions.debounceMs` | number | `500` | Debounce delay (ms) |
| `pi-agent.subagents.maxConcurrency` | number | `4` | Max concurrent subagents |
| `pi-agent.tools.enableBashGuard` | boolean | `true` | Enable bash safety guard |
| `pi-agent.tools.enableGit` | boolean | `true` | Enable git tools |

## 🏗️ Architecture

```
pi-vscode-ext/
├── src/
│   ├── extension.ts              # Entry point — registers all providers
│   ├── agent/
│   │   ├── client.ts             # OpenAI-compatible API client (streaming + non-streaming)
│   │   ├── manager.ts            # Agent orchestrator (tool loop, events)
│   │   ├── session.ts            # Conversation history management
│   │   ├── prompts.ts            # System prompts with tool documentation
│   │   ├── agents.ts             # Agent discovery (.md files with frontmatter)
│   │   └── tools.ts              # Tool registry + interface
│   ├── tools/
│   │   ├── index.ts              # Tool registration (18 tools)
│   │   ├── readFile.ts           # Read file with line numbers
│   │   ├── writeFile.ts          # Write/create files
│   │   ├── editFile.ts           # Find & replace with fuzzy matching
│   │   ├── bash.ts               # Shell execution with BashGuard
│   │   ├── bashGuard.ts          # Safety checks (17+ blocked patterns)
│   │   ├── search.ts             # grep + find tools
│   │   ├── git.ts                # 9 git operations
│   │   ├── subagent.ts           # Delegated LLM task execution
│   │   └── vscode-tools.ts       # VSCode-specific tools (ls, pwd, context, diagnostics)
│   ├── ui/
│   │   ├── chatViewProvider.ts   # Sidebar webview provider
│   │   ├── webviewContent.ts     # Chat HTML/CSS/JS generator
│   │   ├── inlineCompletion.ts   # Inline suggestions provider
│   │   ├── statusBar.ts          # Status bar item
│   │   ├── agentsTreeProvider.ts # Agents tree view
│   │   └── changesTreeProvider.ts # File changes tree view
│   ├── commands/
│   │   └── index.ts              # Command registration
│   └── utils/
│       ├── config.ts             # Configuration reader
│       ├── context.ts            # Workspace context builder
│       ├── logger.ts             # Output channel logger
│       └── diff.ts               # Diff utility
├── agents/                       # Agent definition files (.md)
├── images/                       # Extension icons
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript config
├── .vscode/
│   ├── launch.json               # F5 debug configuration
│   └── tasks.json                # Build tasks
└── README.md
```

## 🔌 Compatible Providers

| Provider | baseUrl Example |
|----------|----------------|
| **9router** | `http://your-host:8080/v1` |
| **OpenAI** | `https://api.openai.com/v1` |
| **Ollama** | `http://localhost:11434/v1` |
| **LM Studio** | `http://localhost:1234/v1` |
| **vLLM** | `http://localhost:8000/v1` |
| **LiteLLM** | `http://localhost:4000/v1` |
| **Together AI** | `https://api.together.xyz/v1` |
| **Groq** | `https://api.groq.com/openai/v1` |

## 📦 Build & Package

```bash
# Development build
npm run compile

# Production bundle
npx webpack --mode production

# Package as .vsix
npm run package
```

## 🧪 Development

```bash
# Watch mode (auto-recompile)
npm run watch

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

## 📋 Requirements

- VS Code 1.85 or newer
- Node.js 18+
- An OpenAI-compatible LLM API endpoint

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npx tsc --noEmit` to verify
5. Submit a pull request

## 📄 License

MIT

## 🙏 Acknowledgments

- Inspired by [GitHub Copilot Chat](https://github.com/microsoft/vscode-copilot-chat)
- Agent architecture based on [pi-agent-setup](https://github.com/VanKurnia/pi-agent-setup)
- Built for the [pi](https://pi.dev) ecosystem
