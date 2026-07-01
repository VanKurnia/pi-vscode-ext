import { ToolRegistry } from '../agent/tools.js';
import type { Session } from '@earendil-works/pi-agent-core/node';
import { createReadFileTool } from './readFile.js';
import { createWriteFileTool } from './writeFile.js';
import { createEditFileTool } from './editFile.js';
import { createBashTool } from './bash.js';
import { createGrepTool, createFindTool, createMultiGrepTool } from './search.js';
import { createGitTools } from './git.js';
import { createSubagentTool } from './subagent.js';
import { createLsTool, createPwdTool, createContextTool, createDiagnosticsTool, createGetOpenEditorsTool, createReplaceInFileTool } from './vscode-tools.js';
import { createAskUserQuestionTool } from './askUserQuestion.js';
import { createWebSearchTool, createWebFetchTool } from './webTools.js';
import { createRecallTool } from './recall.js';
import { createDbTools } from './dbTools.js';
import { createSkillTools } from './skillTools.js';
import { createTodoTool } from './todoTool.js';
import { createCommitTools } from './commitTools.js';
import { createFuzzyFindTool, createFuzzyOpenTool } from './fuzzyFind.js';
import { createDiffReviewTools } from './diffReview.js';
import { createBrowserTools } from './browser.js';
import { SkillDiscovery } from '../agent/skills.js';
import { TodoTreeProvider } from '../ui/todoProvider.js';

export function registerAllTools(
    registry: ToolRegistry,
    client?: any,
    getSession?: () => Session,
    options?: { skillDiscovery?: SkillDiscovery; todoProvider?: TodoTreeProvider }
): void {
    // File operations
    registry.register(createReadFileTool());
    registry.register(createWriteFileTool());
    registry.register(createEditFileTool());
    registry.register(createReplaceInFileTool());

    // Search
    registry.register(createGrepTool());
    registry.register(createMultiGrepTool());
    registry.register(createFindTool());

    // Shell
    registry.register(createBashTool());
    registry.register(createLsTool());
    registry.register(createPwdTool());

    // Git
    for (const tool of createGitTools()) {
        registry.register(tool);
    }

    // Web (9router)
    registry.register(createWebSearchTool());
    registry.register(createWebFetchTool());

    // VSCode
    registry.register(createContextTool());
    registry.register(createDiagnosticsTool());
    registry.register(createGetOpenEditorsTool());

    // User interaction
    registry.register(createAskUserQuestionTool());

    // Recall (pi-blackhole equivalent — search conversation history)
    if (getSession) {
        registry.register(createRecallTool(getSession));
    }

    // Subagent (needs LlmClient + toolRegistry for tool access)
    if (client) {
        registry.register(createSubagentTool(client, registry));
    }

    // Database tools
    for (const tool of createDbTools()) {
        registry.register(tool);
    }

    // Skill tools
    if (options?.skillDiscovery) {
        for (const tool of createSkillTools(options.skillDiscovery)) {
            registry.register(tool);
        }
    }

    // Todo tool
    if (options?.todoProvider) {
        registry.register(createTodoTool(options.todoProvider));
    }

    // Commit tools (generate commit message, review, diff prompt)
    for (const tool of createCommitTools()) {
        registry.register(tool);
    }

    // Fuzzy find tools
    registry.register(createFuzzyFindTool());
    registry.register(createFuzzyOpenTool());

    // Diff review tools
    for (const tool of createDiffReviewTools()) {
        registry.register(tool);
    }

    // Browser tools
    for (const tool of createBrowserTools()) {
        registry.register(tool);
    }
}
