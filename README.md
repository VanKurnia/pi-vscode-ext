# Pi Agent — VS Code Extension

> AI coding agent for VS Code, powered by [Pi](https://earendil.works). GitHub Copilot-like experience with subagent orchestration, browser automation, database tools, git toolkit, and 56+ built-in tools.

![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ Features

### 🤖 Agent Core
- **Multi-turn chat** with streaming responses via `@pi` Chat Participant
- **Subagent delegation** — spawn worker/scout/researcher agents for parallel tasks
- **Agent discovery** — auto-load `.md` agent definitions from `~/.pi/agent/agents/`
- **Skill system** — load markdown skills with YAML frontmatter from workspace/global directories
- **LLM compaction** — automatic context compression when approaching token limits
- **Usage tracking** — real-time token count, cost estimation, context window monitoring
- **Reasoning model support** — works with mimo-v2-pro and other reasoning models

### 🛠️ 56 Built-in Tools

| Category | Tools |
|----------|-------|
| **File Ops** | `read_file`, `write_file`, `edit_file`, `replace_in_file` |
| **Search** | `grep`, `multi_grep` (OR-pattern), `find`, `fuzzy_find`, `fuzzy_open` |
| **Shell** | `bash` (with bashGuard safety), `ls`, `pwd` |
| **Git** | `git_status`, `git_diff`, `git_diff_staged`, `git_diff_unstaged`, `git_add`, `git_commit`, `git_log`, `git_branch`, `git_create_branch`, `git_checkout`, `git_reset`, `git_show` |
| **Browser** | `browser_start`, `browser_navigate`, `browser_evaluate`, `browser_screenshot`, `browser_content`, `browser_click`, `browser_type`, `browser_close` |
| **Database** | `db_connect`, `db_list_tables`, `db_describe_table`, `db_query`, `db_preview` |
| **Web** | `web_search`, `web_fetch` |
| **AI/Agent** | `subagent` (task delegation), `recall` (session memory/history) |
| **Commit** | `commit_generate` (conventional commits), `commit_review` (risk assessment), `diff_prompt` (code review) |
| **Diff Review** | `diff_review`, `diff_approve`, `diff_reject`, `diff_commit` |
| **Skills** | `skill_list`, `skill_load`, `skill_search` |
| **IDE** | `context` (workspace info), `get_diagnostics`, `get_open_editors` |
| **UX** | `ask_user_question`, `todo_update` |

### 🎨 VS Code Integration
- **Chat Participant** — `@pi` in VSCode Copilot Chat with slash commands (`/explain`, `/fix`, `/refactor`, `/test`, `/review`, `/commit`, `/plan`)
- **Context menu** — right-click selected code → Pi Agent actions
- **Command palette** — all commands via `Ctrl+Shift+P`
- **Inline suggestions** — AI-powered ghost text completions (toggle on/off)
- **Status bar** — model indicator, token speed, context usage
- **Tree views** — Agents, Changes, and Todo panels in sidebar
- **Plan mode** — read-only analysis with step tracking (`[DONE:n]` markers)
- **Todo widget** — track agent task progress with visual states

---

## 🚀 Quick Start

### Prerequisites
- VS Code 1.85 or later
- Node.js 18+
- An OpenAI-compatible LLM API (e.g., [9router](https://github.com), Ollama, LM Studio, or OpenAI)

### Installation

```bash
# Clone the repo
git clone https://github.com/VanKurnia/pi-vscode-ext.git
cd pi-vscode-ext

# Install dependencies
npm install

# Compile
npm run compile

# Open in VS Code and press F5 to launch Extension Development Host
code .
```

### Build `.vsix` Package

```bash
npm install -g @vscode/vsce
vsce package
# Install: code --install-extension pi-vscode-ext-0.1.0.vsix
```

---

## ⚙️ Configuration

All settings are under `Pi Agent` in VS Code Settings (`Ctrl+,`):

| Setting | Default | Description |
|---------|---------|-------------|
| `pi-agent.api.baseUrl` | `http://localhost:8080/v1` | OpenAI-compatible API endpoint |
| `pi-agent.api.apiKey` | `""` | API key (leave empty for local providers) |
| `pi-agent.api.model` | `versatile` | Default model name |
| `pi-agent.api.chatModel` | `""` | Model for chat (falls back to default) |
| `pi-agent.api.completionModel` | `""` | Model for inline completions |
| `pi-agent.agent.maxTokens` | `16384` | Max tokens for responses |
| `pi-agent.agent.temperature` | `0.7` | Sampling temperature |
| `pi-agent.agent.systemPrompt` | `""` | Custom system prompt (appended) |
| `pi-agent.inlineSuggestions.enabled` | `false` | Enable ghost text suggestions |
| `pi-agent.inlineSuggestions.debounceMs` | `500` | Debounce for inline suggestions |
| `pi-agent.subagents.maxConcurrency` | `4` | Max parallel subagent tasks |
| `pi-agent.subagents.agentsDir` | `""` | Custom agents directory |
| `pi-agent.tools.enableBashGuard` | `true` | Enable bash command safety |
| `pi-agent.tools.enableGit` | `true` | Enable git toolkit |

### Environment Variables (`.env`)

```env
PI_API_BASE_URL=http://localhost:8080/v1
PI_API_KEY=
PI_API_MODEL=versatile
WORKER_MODEL=coder
SCOUT_MODEL=assistant
RESEARCHER_MODEL=reason
SUBAGENTS_MAX_CONCURRENCY=4
```

---

## 🏗️ Architecture

```
src/
├── extension.ts              # Entry point — activate/deactivate
├── agent/
│   ├── client.ts             # LLM API client (fetch-based, streaming)
│   ├── session.ts            # Conversation history + compaction
│   ├── manager.ts            # Main orchestrator (agent loop)
│   ├── tools.ts              # Tool registry + interface
│   ├── agents.ts             # Agent discovery (.md files)
│   ├── skills.ts             # Skill discovery (YAML frontmatter)
│   └── prompts.ts            # System prompts (default, commit, review)
├── chat/
│   ├── participant.ts        # ChatParticipant API (@pi)
│   ├── commands.ts           # Slash command handlers
│   └── planMode.ts           # Plan mode manager
├── tools/
│   ├── index.ts              # Tool registration (registerAllTools)
│   ├── bash.ts / bashGuard.ts # Shell execution + safety
│   ├── git.ts                # Git toolkit (12 tools)
│   ├── browser.ts            # Puppeteer/CDP browser automation (8 tools)
│   ├── dbTools.ts            # Database tools (SQLite/PG/MySQL)
│   ├── diffReview.ts         # Hunk-level diff review
│   ├── fuzzyFind.ts          # Fuzzy file finder
│   ├── commitTools.ts        # Commit generation + review
│   ├── webTools.ts           # Web search + fetch
│   ├── recall.ts             # Session memory
│   ├── subagent.ts           # Task delegation
│   ├── skillTools.ts         # Skill access
│   ├── vscodeTools.ts        # IDE integration
│   ├── readFile.ts / writeFile.ts / editFile.ts / search.ts
│   └── askUserQuestion.ts / todoTool.ts
├── ui/
│   ├── todoProvider.ts       # Todo TreeView
│   ├── agentsTreeProvider.ts # Agents TreeView
│   ├── changesTreeProvider.ts# Changes TreeView
│   ├── inlineCompletion.ts   # Ghost text provider
│   ├── statusBar.ts          # Status bar items
│   └── webviewContent.ts     # Chat webview HTML
└── utils/
    ├── config.ts / logger.ts / context.ts / diff.ts
    ├── pathGuard.ts / typedEvents.ts
    └── fileWatcher.ts        # Hot reload for agents/skills/config
```

---

## 🔌 Slash Commands

Use these in the `@pi` chat:

| Command | Description |
|---------|-------------|
| `/explain` | Explain selected code or file |
| `/fix` | Fix errors in selected code |
| `/refactor` | Refactor selected code |
| `/test` | Generate tests for selected code |
| `/review` | Review code for issues |
| `/commit` | Generate conventional commit message |
| `/plan` | Enter plan mode (read-only analysis) |
| `/scout` | Fast codebase reconnaissance |
| `/research` | Research a topic |

---

## 🛡️ Safety Features

- **BashGuard** — blocks dangerous commands (`rm -rf /`, `sudo`, etc.) with configurable rules
- **Read-only plan mode** — write/edit tools disabled during planning
- **Diff review** — approve/reject individual hunks before committing
- **Path guard** — prevents file operations outside workspace
- **Risk assessment** — commit review detects secrets, destructive operations, large changesets

---

## 🔗 Compatibility

This extension replicates the full feature set of [pi-agent-setup](https://github.com/VanKurnia/pi-agent-setup) for the VS Code environment:

| pi-agent-setup Feature | pi-vscode-ext Equivalent |
|------------------------|--------------------------|
| subagents extension | `subagent.ts` |
| bash-guard extension | `bashGuard.ts` |
| browser-tools extension | `browser.ts` |
| plan-mode extension | `planMode.ts` |
| filechanges extension | `changesTreeProvider.ts` |
| db-tools extension | `dbTools.ts` |
| pi-fff (fuzzy find) | `fuzzyFind.ts` |
| pi-9router-ext | `webTools.ts` |
| pi-blackhole | `recall.ts` |
| pi-speeed | `statusBar.ts` (token speed) |
| pi-x-ide | `vscodeTools.ts` |
| pi-zentui | Status bar (git branch, context) |
| Skills | `skills.ts` + `skillTools.ts` |
| Commit/Diff prompts | `commitTools.ts` |

**Plus VSCode-specific features** not available in CLI:
- Inline code suggestions (ghost text)
- Native Chat Participant API (`@pi`)
- Context menu integration
- IDE diagnostics integration
- File watcher with hot reload

---

## 📝 Development

```bash
# Watch mode (auto-recompile)
npm run watch

# Type check only
npx tsc --noEmit

# Launch debugger (F5 in VS Code)
# Uses .vscode/launch.json configuration
```

---

## 📄 License

MIT © [VanKurnia](https://github.com/VanKurnia)
