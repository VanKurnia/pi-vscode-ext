# π Agent — AI Coding Assistant for VS Code

A full-featured AI coding agent extension for VS Code with **56 built-in tools**, subagent orchestration, plan mode, database exploration, browser automation, and native Chat API integration. Connects to any OpenAI-compatible LLM API.

![VS Code](https://img.shields.io/badge/VS%20Code-1.90%2B-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![Tools](https://img.shields.io/badge/Tools-56-green)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ Features

### 🤖 Native VS Code Chat Integration
- Uses VS Code's built-in Chat panel — no custom webview required
- Type `@pi` in the Chat panel to invoke the agent
- Streaming responses rendered natively by VS Code
- 10 slash commands displayed as native Chat commands
- Progress indicators during tool execution
- Sticky sessions — context preserved across conversations

### 🛠️ 56 Built-in Tools (Full pi-agent-setup Parity)

| Category | Count | Tools |
|----------|-------|-------|
| **File Operations** | 6 | `read_file`, `write_file`, `edit_file`, `replace_in_file`, `fuzzy_find`, `fuzzy_open` |
| **Search** | 3 | `grep`, `multi_grep`, `find` |
| **Shell** | 3 | `bash`, `ls`, `pwd` |
| **Git** | 12 | `git_status`, `git_diff_unstaged`, `git_diff_staged`, `git_diff`, `git_add`, `git_commit`, `git_reset`, `git_log`, `git_create_branch`, `git_checkout`, `git_branch`, `git_show` |
| **Web** | 2 | `web_search`, `web_fetch` |
| **Browser Automation** | 8 | `browser_start`, `browser_navigate`, `browser_evaluate`, `browser_screenshot`, `browser_content`, `browser_click`, `browser_type`, `browser_close` |
| **Database** | 5 | `db_connect`, `db_list_tables`, `db_describe_table`, `db_query`, `db_preview` |
| **Code Review** | 4 | `diff_review`, `diff_approve`, `diff_reject`, `diff_commit` |
| **Commit Workflow** | 3 | `commit_generate`, `commit_review`, `diff_prompt` |
| **Skills** | 3 | `skill_list`, `skill_load`, `skill_search` |
| **AI / Agent** | 2 | `subagent`, `recall` |
| **VSCode** | 3 | `context`, `get_diagnostics`, `get_open_editors` |
| **User Interaction** | 2 | `ask_user_question`, `todo_update` |

### 🎯 Command Palette Actions

| Command | Shortcut | Description |
|---------|----------|-------------|
| **Pi Agent: Explain Code** | Context menu | Explain selected code with AI |
| **Pi Agent: Fix Code** | Context menu | Auto-fix errors in selected code |
| **Pi Agent: Refactor Code** | Context menu | AI-powered refactoring |
| **Pi Agent: Generate Tests** | Context menu | Generate test cases for code |
| **Pi Agent: Review Code** | Context menu | Deep code review with suggestions |
| **Pi Agent: Generate Commit Message** | — | Conventional commit from staged changes |
| **Pi Agent: New Session** | — | Clear conversation history |
| **Pi Agent: Toggle Plan Mode** | — | Enable step-by-step planning |
| **Pi Agent: Toggle Inline Suggestions** | — | Ghost text completions on/off |
| **Pi Agent: Show Context Usage** | — | Display current context window |
| **Pi Agent: Clear Todo List** | — | Reset agent task list |

### 💬 Slash Commands

Use these in the Chat panel with `@pi`:

| Command | Description |
|---------|-------------|
| `/explain` | Explain selected code or file |
| `/fix` | Fix errors in selected code |
| `/refactor` | Refactor selected code |
| `/test` | Generate tests for selected code |
| `/review` | Review code for issues and improvements |
| `/commit` | Generate a commit message for staged changes |
| `/plan [task]` | Toggle plan mode — create step-by-step plans |
| `/scout <query>` | Fast codebase reconnaissance — find patterns and map architecture |
| `/research <topic>` | Research a topic with web search |
| `/clear` | Clear chat history |

### 📋 Sidebar Views (Activity Bar)

The π Agent sidebar provides three tree views:

- **🤖 Agents** — Discover and launch named AI agents (scout, researcher, worker) with custom system prompts and tool configurations
- **📝 Changes** — Track file modifications with added/removed line counts in real-time
- **✅ Tasks** — Agent-managed todo list with status tracking (pending → in progress → completed)

### 🔒 Safety Features

- **BashGuard** — Automatically blocks dangerous commands (`rm -rf /`, `sudo`, reverse shells, fork bombs, credential exfiltration)
- **Path traversal protection** — Prevents file operations outside workspace boundaries
- **SQL safety** — Database tools enforce read-only queries (SELECT only, blocks DDL/DML)
- **Configurable** — Toggle bash guard on/off via settings

### 🧠 Intelligent Agent System

- **Unified tool loop** — Single execution engine for both main agent and named agents
- **Sequential + parallel tool batching** — Independent tools execute concurrently
- **LLM-based compaction** — Automatic conversation summarization when context fills up
- **Steering messages** — Queue follow-up instructions while the agent is working
- **Subagent delegation** — Spawn isolated AI instances for complex subtasks
- **Plan mode** — Step-by-step planning with structured output
- **JSONL session persistence** — Conversations saved to workspace for continuity

### 🔍 Advanced Capabilities

- **Inline code suggestions** — Context-aware ghost text as you type (configurable debounce)
- **Multi-model support** — Separate models for chat, completions, and agents
- **Skill system** — Load reusable knowledge from `~/.pi/skills/` and workspace `.pi/skills/`
- **Agent discovery** — Custom agents defined in `.pi/agents/` YAML files
- **Database exploration** — Connect to SQLite, PostgreSQL, or MySQL and query interactively
- **Browser automation** — Headless browser control for web testing and research
- **Diff review workflow** — Structured approve/reject cycle for code changes
- **Fuzzy file finding** — Fast file navigation with pattern matching
- **Conversation recall** — Search previous session history

---

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/VanKurnia/pi-vscode-ext.git
cd pi-vscode-ext
npm install
```

### 2. Open in VS Code

```bash
code .
```

### 3. Launch Extension

Press `F5` to open the **Extension Development Host**. The π Agent extension will activate automatically.

### 4. Configure Your API

Open Settings (`Ctrl+,` / `Cmd+,`) and search for "Pi Agent":

```json
{
    "pi-agent.api.baseUrl": "http://localhost:8080/v1",
    "pi-agent.api.apiKey": "your-api-key",
    "pi-agent.api.model": "your-model-name"
}
```

### 5. Start Using

1. Open the Chat panel (`Ctrl+Shift+I` or click the Chat icon)
2. Type `@pi` followed by your question or task
3. Use slash commands: `@pi /explain`, `@pi /fix`, `@pi /commit`
4. Right-click selected code for context menu actions

---

## ⚙️ Configuration

All settings are under the `pi-agent` namespace in VS Code Settings.

### API Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `pi-agent.api.baseUrl` | string | `http://localhost:8080/v1` | Base URL for the OpenAI-compatible API endpoint |
| `pi-agent.api.apiKey` | string | `""` | API key for the LLM provider (leave empty for local providers) |
| `pi-agent.api.model` | string | `versatile` | Default model used for completions |
| `pi-agent.api.chatModel` | string | `""` | Model for chat (falls back to `api.model` if empty) |
| `pi-agent.api.completionModel` | string | `""` | Model for inline completions (falls back to `api.model` if empty) |

### Agent Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `pi-agent.agent.maxTokens` | number | `16384` | Maximum tokens for agent responses |
| `pi-agent.agent.temperature` | number | `0.7` | Temperature for LLM requests |
| `pi-agent.agent.systemPrompt` | string | `""` | Custom system prompt appended to the default |

### Inline Suggestions

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `pi-agent.inlineSuggestions.enabled` | boolean | `false` | Enable inline code suggestions (ghost text) |
| `pi-agent.inlineSuggestions.debounceMs` | number | `500` | Debounce delay in milliseconds for inline suggestions |

### Subagent Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `pi-agent.subagents.maxConcurrency` | number | `4` | Maximum concurrent subagent processes |

### Tool Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `pi-agent.tools.enableBashGuard` | boolean | `true` | Enable bash command safety guard |
| `pi-agent.tools.enableGit` | boolean | `true` | Enable git toolkit tools |

---

## 🏗️ Architecture

```
src/
├── extension.ts                    # Entry point — activation, commands, views
│
├── agent/                          # Core agent engine
│   ├── client.ts                   # OpenAI-compatible API client (streaming + batch)
│   ├── manager.ts                  # PiAgentManager — unified tool loop, compaction
│   ├── session.ts                  # Conversation history with JSONL persistence
│   ├── tools.ts                    # Tool interface + ToolRegistry
│   ├── prompts.ts                  # System prompt builder
│   ├── agents.ts                   # Named agent discovery (.pi/agents/*.yaml)
│   └── skills.ts                   # Skill discovery (.pi/skills/*)
│
├── tools/                          # 56 built-in tools
│   ├── index.ts                    # Tool registration entry point
│   ├── readFile.ts                 # read_file
│   ├── writeFile.ts                # write_file
│   ├── editFile.ts                 # edit_file (diff-based find & replace)
│   ├── vscode-tools.ts             # ls, pwd, context, get_diagnostics, get_open_editors, replace_in_file
│   ├── bash.ts                     # bash (with BashGuard safety)
│   ├── bashGuard.ts                # Command safety patterns
│   ├── search.ts                   # grep, multi_grep, find
│   ├── git.ts                      # 12 git operations
│   ├── webTools.ts                 # web_search, web_fetch (9router proxy)
│   ├── browser.ts                  # 8 browser automation tools
│   ├── dbTools.ts                  # 5 database tools (SQLite/PostgreSQL/MySQL)
│   ├── commitTools.ts              # commit_generate, commit_review, diff_prompt
│   ├── diffReview.ts               # diff_review, diff_approve, diff_reject, diff_commit
│   ├── fuzzyFind.ts                # fuzzy_find, fuzzy_open
│   ├── skillTools.ts               # skill_list, skill_load, skill_search
│   ├── subagent.ts                 # subagent delegation
│   ├── recall.ts                   # Conversation history search
│   ├── askUserQuestion.ts          # ask_user_question
│   └── todoTool.ts                 # todo_update
│
├── chat/                           # Chat participant (VS Code Chat API)
│   ├── participant.ts              # @pi ChatParticipant registration
│   ├── commands.ts                 # Slash command handler (/explain, /fix, etc.)
│   └── planMode.ts                 # Plan mode formatting and state
│
├── ui/                             # VS Code UI components
│   ├── statusBar.ts                # Model info + status indicator
│   ├── inlineCompletion.ts         # Ghost text suggestion provider
│   ├── agentsTreeProvider.ts       # Sidebar: Agents tree view
│   ├── changesTreeProvider.ts      # Sidebar: File changes tracker
│   └── todoProvider.ts             # Sidebar: Task/todo tree view
│
└── utils/                          # Shared utilities
    ├── config.ts                   # Settings reader (PiConfig)
    ├── context.ts                  # Workspace context builder
    ├── logger.ts                   # Output channel logger
    ├── diff.ts                     # Unified diff utilities
    ├── pathGuard.ts                # Workspace path safety
    ├── typedEvents.ts              # Typed event emitter types
    └── fileWatcher.ts              # File system watcher
```

### Key Design Patterns

- **Unified Tool Loop** — Both the main chat agent and named agents use a single `runToolLoop()` method in `PiAgentManager`. The loop handles streaming/non-streaming, tool batching (sequential + parallel), compaction checks, and steering message injection.

- **Tool Execution Modes** — Each tool declares `executionMode: 'sequential' | 'parallel'`. The tool loop batches consecutive parallel tools for concurrent execution while maintaining order for sequential tools.

- **pi-agent-setup Compatibility** — The agent engine mirrors [pi-agent-setup](https://github.com/VanKurnia/pi-agent-setup) patterns: same tool names, same system prompt structure, same compaction strategy, same session serialization format.

---

## 🔧 Tool Reference

### File Operations

| Tool | Description | Parameters |
|------|-------------|------------|
| `read_file` | Read file contents with line numbers | `path`, `offset?`, `limit?` |
| `write_file` | Write content to a file (creates dirs) | `path`, `content` |
| `edit_file` | Find-and-replace with unified diff output | `path`, `old_string`, `new_string`, `replace_all?` |
| `replace_in_file` | VSCode-native file replacement | `path`, `old_string`, `new_string` |
| `fuzzy_find` | Search files by fuzzy pattern | `pattern`, `directory?` |
| `fuzzy_open` | Open a file by fuzzy matching name | `query` |

### Search

| Tool | Description | Parameters |
|------|-------------|------------|
| `grep` | Regex search across files | `pattern`, `path?`, `glob?` |
| `multi_grep` | Multiple patterns in a single search | `patterns[]`, `path?` |
| `find` | Find files by name/glob pattern | `pattern`, `path?` |

### Shell

| Tool | Description | Parameters |
|------|-------------|------------|
| `bash` | Execute shell command with timeout | `command`, `timeout?`, `cwd?` |
| `ls` | List directory contents | `path?` |
| `pwd` | Print current working directory | — |

### Git

| Tool | Description | Parameters |
|------|-------------|------------|
| `git_status` | Show working tree status | `repo_path?` |
| `git_diff_unstaged` | Show unstaged changes | `repo_path?` |
| `git_diff_staged` | Show staged changes | `repo_path?` |
| `git_diff` | Show diff between refs | `ref1?`, `ref2?`, `repo_path?` |
| `git_add` | Stage files | `files[]`, `repo_path?` |
| `git_commit` | Create a commit | `message`, `repo_path?` |
| `git_reset` | Reset HEAD | `mode?`, `repo_path?` |
| `git_log` | Show commit log | `limit?`, `repo_path?` |
| `git_create_branch` | Create a new branch | `branch_name`, `repo_path?` |
| `git_checkout` | Switch branches | `branch_name`, `repo_path?` |
| `git_branch` | List branches | `repo_path?` |
| `git_show` | Show commit details | `ref`, `repo_path?` |

### Web

| Tool | Description | Parameters |
|------|-------------|------------|
| `web_search` | Search the web via proxy | `query`, `max_results?` |
| `web_fetch` | Fetch and extract URL content | `url`, `max_characters?` |

### Browser Automation

| Tool | Description | Parameters |
|------|-------------|------------|
| `browser_start` | Launch headless browser | — |
| `browser_navigate` | Navigate to a URL | `url` |
| `browser_evaluate` | Execute JavaScript in page | `expression` |
| `browser_screenshot` | Capture page screenshot | — |
| `browser_content` | Get page text content | — |
| `browser_click` | Click an element | `selector` |
| `browser_type` | Type text into an input | `selector`, `text` |
| `browser_close` | Close the browser | — |

### Database

| Tool | Description | Parameters |
|------|-------------|------------|
| `db_connect` | Connect to SQLite, PostgreSQL, or MySQL | `connection_string` |
| `db_list_tables` | List all tables | `connection_id` |
| `db_describe_table` | Show table schema and indexes | `connection_id`, `table_name` |
| `db_query` | Execute read-only SQL query | `connection_id`, `sql`, `limit?` |
| `db_preview` | Preview first N rows of a table | `connection_id`, `table_name`, `limit?` |

### Code Review & Commit

| Tool | Description | Parameters |
|------|-------------|------------|
| `diff_review` | Start a structured diff review | `path?` |
| `diff_approve` | Approve a pending change | `review_id` |
| `diff_reject` | Reject a pending change with reason | `review_id`, `reason` |
| `diff_commit` | Commit approved changes | `review_id`, `message?` |
| `commit_generate` | Generate conventional commit message | — |
| `commit_review` | Review staged changes | — |
| `diff_prompt` | Generate a diff-based prompt | `path?` |

### Skills

| Tool | Description | Parameters |
|------|-------------|------------|
| `skill_list` | List all discovered skills | — |
| `skill_load` | Load a skill by name | `name` |
| `skill_search` | Search skills by keyword | `query` |

### AI & Agent

| Tool | Description | Parameters |
|------|-------------|------------|
| `subagent` | Delegate task to an isolated AI agent | `task`, `agent?` |
| `recall` | Search conversation history | `query` |

### User Interaction

| Tool | Description | Parameters |
|------|-------------|------------|
| `ask_user_question` | Ask the user a question | `question`, `options?` |
| `todo_update` | Update the task/todo list | `action`, `content?`, `id?` |

### VSCode

| Tool | Description | Parameters |
|------|-------------|------------|
| `context` | Get workspace context (open files, selection, git info) | — |
| `get_diagnostics` | Get VS Code diagnostics (errors, warnings) | `file?` |
| `get_open_editors` | List open editor tabs | — |

---

## 🔌 Compatible Providers

π Agent works with any OpenAI-compatible API:

| Provider | baseUrl | Notes |
|----------|---------|-------|
| **9router** | `http://your-host:8080/v1` | Default, includes web search/fetch proxy |
| **OpenAI** | `https://api.openai.com/v1` | GPT-4, GPT-4o, etc. |
| **Ollama** | `http://localhost:11434/v1` | Local models (Llama, Mistral, etc.) |
| **LM Studio** | `http://localhost:1234/v1` | Local GGUF models |
| **vLLM** | `http://localhost:8000/v1` | High-throughput local serving |
| **Together AI** | `https://api.together.xyz/v1` | Cloud-hosted open models |
| **Groq** | `https://api.groq.com/openai/v1` | Fast inference API |
| **LiteLLM** | `http://localhost:4000/v1` | Universal proxy for all providers |

---

## 📦 Build & Package

```bash
# Install dependencies
npm install

# Development compile
npm run compile

# Watch mode (auto-recompile)
npm run watch

# Production webpack bundle
npm run webpack

# Lint
npm run lint

# Package as .vsix for distribution
npm run package
```

### Requirements

- **VS Code** 1.90+
- **Node.js** 18+
- **npm** 9+
- An **OpenAI-compatible LLM API** endpoint

---

## 🧪 Development

### Run in Debug Mode

1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. The extension activates on startup (`onStartupFinished`)
4. Use `Ctrl+Shift+I` to open Chat, type `@pi`

### Watch Mode

```bash
npm run watch
```

This runs TypeScript in watch mode — changes are compiled automatically. Reload the Extension Development Host (`Ctrl+Shift+P` → "Reload Window") to pick up changes.

### Webpack Dev Mode

```bash
npm run webpack:dev
```

For faster iteration with webpack bundling and source maps.

---

## 🔍 Troubleshooting

### Extension doesn't activate

- Ensure VS Code version is 1.90+ (`Help → About`)
- Check the Output panel (`View → Output` → select "Pi Agent" from dropdown)
- Verify `package.json` is valid (run `npm run compile`)

### "No API configured" or connection errors

- Verify `pi-agent.api.baseUrl` points to a running OpenAI-compatible endpoint
- Test the endpoint: `curl http://your-host:8080/v1/models`
- If using a cloud provider, ensure `pi-agent.api.apiKey` is set
- Check that the model name in `pi-agent.api.model` exists on your provider

### Tools not working

- Open Output panel to see tool execution logs
- For `bash` tool: ensure the command isn't blocked by BashGuard (toggle with `pi-agent.tools.enableBashGuard`)
- For `git_*` tools: ensure `pi-agent.tools.enableGit` is `true`
- For `db_*` tools: SQLite requires `better-sqlite3` (`npm install better-sqlite3`), PostgreSQL requires `pg`, MySQL requires `mysql2`

### Inline suggestions not appearing

- Enable in settings: `pi-agent.inlineSuggestions.enabled: true`
- Ensure a completion model is configured (or falls back to default model)
- Adjust debounce: `pi-agent.inlineSuggestions.debounceMs`

### Chat commands not showing

- Ensure the extension is activated (check Output panel)
- Type `@` in the Chat panel — "Pi Agent" (`@pi`) should appear in the autocomplete list
- If not, try reloading the window (`Ctrl+Shift+P` → "Reload Window")

### High token usage / slow responses

- Lower `pi-agent.agent.maxTokens` (default: 16384)
- The agent automatically compacts long conversations via LLM summarization
- Use `/clear` to start fresh
- Use plan mode (`/plan`) for structured tasks that require fewer iterations

---

## 📋 Changelog

### v0.2.0 (Current)
- **56 tools** — Full parity with pi-agent-setup
- Database tools (SQLite, PostgreSQL, MySQL)
- Browser automation (8 tools)
- Diff review workflow (approve/reject/commit)
- Commit generation and review tools
- Fuzzy file finding
- Skill system integration
- Todo/task management
- Conversation recall/search
- Web search and fetch via 9router proxy
- LLM-based conversation compaction
- Steering message queue (type while agent works)
- Inline code suggestions
- JSONL session persistence
- 3 sidebar tree views (Agents, Changes, Tasks)
- 12 command palette actions

### v0.1.0
- Initial release
- Native Chat API integration (`@pi`)
- 18 core tools (file, search, shell, git, vscode)
- Subagent delegation
- BashGuard safety
- Status bar integration

---

## 📄 License

MIT

## 🙏 Acknowledgments

- Inspired by [GitHub Copilot Chat](https://github.com/microsoft/vscode-copilot-chat)
- Agent architecture based on [pi-agent-setup](https://github.com/VanKurnia/pi-agent-setup)
- Built for the [Pi](https://pi.dev) ecosystem
