# π Agent — AI Coding Assistant for VS Code

A powerful AI coding agent extension for VS Code, using the **native Chat API** (`@pi` in the Chat panel). Connects to any OpenAI-compatible LLM API with 18 built-in tools, subagent delegation, and slash commands.

![VS Code](https://img.shields.io/badge/VS%20Code-1.90%2B-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Features

### 🤖 Native VS Code Chat Integration
- Uses VS Code's built-in Chat panel — no custom webview
- Type `@pi` in the Chat panel to invoke the agent
- Streaming responses rendered natively by VS Code
- Slash commands displayed as native Chat commands
- Progress indicators during tool execution

### 🛠️ 22 Built-in Tools

| Category | Tools |
|----------|-------|
| **File** | `read_file`, `write_file`, `edit_file`, `replace_in_file` |
| **Search** | `grep`, `find` |
| **Shell** | `bash`, `ls`, `pwd` |
| **Git** | `git_status`, `git_diff`, `git_diff_staged`, `git_add`, `git_commit`, `git_log`, `git_branch`, `git_show`, `git_reset` |
| **VSCode** | `context`, `get_diagnostics`, `get_open_editors` |
| **AI** | `subagent` — delegate tasks to isolated AI |

### 💬 Slash Commands

| Command | Description |
|---------|-------------|
| `/explain` | Explain selected code |
| `/fix` | Fix errors in selected code |
| `/refactor` | Refactor selected code |
| `/test` | Generate tests |
| `/review` | Review code for issues |
| `/commit` | Generate commit message |
| `/plan [task]` | Toggle plan mode |
| `/scout <query>` | Codebase reconnaissance |
| `/research <topic>` | Research a topic |
| `/clear` | Clear chat history |

### 🔒 Safety
- **BashGuard** — blocks dangerous commands (`rm -rf /`, `sudo`, reverse shells, fork bombs)
- **Path traversal protection** in git operations

### 📝 Inline Code Suggestions
- Context-aware ghost text as you type
- Toggle via command palette or settings

### 🔍 Sidebar Views
- **Agents** — discover and select AI agents
- **Changes** — track file modifications

## 🚀 Quick Start

```bash
git clone https://github.com/VanKurnia/pi-vscode-ext.git
cd pi-vscode-ext
npm install
code .
# Press F5 → opens Extension Development Host
```

### Configure API

In Settings (`Ctrl+,`):

```json
{
    "pi-agent.api.baseUrl": "http://localhost:8080/v1",
    "pi-agent.api.apiKey": "your-api-key",
    "pi-agent.api.model": "your-model"
}
```

### Use

1. Open VS Code Chat panel (`Ctrl+Shift+I` or click Chat icon)
2. Type `@pi` followed by your message
3. Or use slash commands: `@pi /explain`, `@pi /fix`, etc.

## ⚙️ Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `pi-agent.api.baseUrl` | string | `http://localhost:8080/v1` | OpenAI-compatible API endpoint |
| `pi-agent.api.apiKey` | string | `""` | API key |
| `pi-agent.api.model` | string | `versatile` | Default model |
| `pi-agent.agent.maxTokens` | number | `16384` | Max tokens per response |
| `pi-agent.agent.temperature` | number | `0.7` | Temperature |
| `pi-agent.agent.systemPrompt` | string | `""` | Custom system prompt |
| `pi-agent.inlineSuggestions.enabled` | boolean | `false` | Enable inline suggestions |
| `pi-agent.tools.enableBashGuard` | boolean | `true` | Enable bash safety guard |

## 🏗️ Architecture

```
src/
├── extension.ts              # Entry — ChatParticipant + commands
├── agent/
│   ├── client.ts             # OpenAI API client (streaming + fallback)
│   ├── manager.ts            # Agent orchestrator (tool loop, events)
│   ├── session.ts            # Conversation history
│   ├── prompts.ts            # System prompts
│   ├── agents.ts             # Agent discovery
│   └── tools.ts              # Tool registry
├── tools/
│   ├── index.ts              # Register all 18 tools
│   ├── readFile.ts, writeFile.ts, editFile.ts, vscode-tools.ts
│   ├── bash.ts, bashGuard.ts, search.ts
│   ├── git.ts (9 git ops), subagent.ts
├── ui/
│   ├── statusBar.ts, inlineCompletion.ts
│   ├── agentsTreeProvider.ts, changesTreeProvider.ts
└── utils/
    ├── config.ts, context.ts, logger.ts, diff.ts
```

## 🔌 Compatible Providers

| Provider | baseUrl |
|----------|---------|
| **9router** | `http://your-host:8080/v1` |
| **OpenAI** | `https://api.openai.com/v1` |
| **Ollama** | `http://localhost:11434/v1` |
| **LM Studio** | `http://localhost:1234/v1` |
| **vLLM** | `http://localhost:8000/v1` |
| **Together AI** | `https://api.together.xyz/v1` |
| **Groq** | `https://api.groq.com/openai/v1` |

## 📦 Build

```bash
npm run compile        # Development
npm run package        # .vsix for distribution
```

## 📋 Requirements

- VS Code 1.90+
- Node.js 18+
- OpenAI-compatible LLM API

## 📄 License

MIT

## 🙏 Acknowledgments

- Inspired by [GitHub Copilot Chat](https://github.com/microsoft/vscode-copilot-chat)
- Agent architecture based on [pi-agent-setup](https://github.com/VanKurnia/pi-agent-setup)
- Built for the [pi](https://pi.dev) ecosystem
