import { ToolRegistry } from '../agent/tools';
import { LlmClient } from '../agent/client';
import { createReadFileTool } from './readFile';
import { createWriteFileTool } from './writeFile';
import { createEditFileTool } from './editFile';
import { createBashTool } from './bash';
import { createGrepTool, createFindTool, createMultiGrepTool } from './search';
import { createGitTools } from './git';
import { createSubagentTool } from './subagent';
import { createLsTool, createPwdTool, createContextTool, createDiagnosticsTool, createGetOpenEditorsTool, createReplaceInFileTool } from './vscode-tools';
import { createAskUserQuestionTool } from './askUserQuestion';
import { createWebSearchTool, createWebFetchTool } from './webTools';
import { createRecallTool } from './recall';
import { Session } from '../agent/session';
import { createDbTools } from './dbTools';
import { createSkillTools } from './skillTools';
import { createTodoTool } from './todoTool';
import { SkillDiscovery } from '../agent/skills';
import { TodoTreeProvider } from '../ui/todoProvider';

export function registerAllTools(
    registry: ToolRegistry,
    client?: LlmClient,
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
}
