import { ToolRegistry } from '../agent/tools';
import { LlmClient } from '../agent/client';
import { createReadFileTool } from './readFile';
import { createWriteFileTool } from './writeFile';
import { createEditFileTool } from './editFile';
import { createBashTool } from './bash';
import { createGrepTool, createFindTool } from './search';
import { createGitTools } from './git';
import { createSubagentTool } from './subagent';
import { createLsTool, createPwdTool, createContextTool, createDiagnosticsTool, createGetOpenEditorsTool, createReplaceInFileTool } from './vscode-tools';

export function registerAllTools(registry: ToolRegistry, client?: LlmClient): void {
    // File operations
    registry.register(createReadFileTool());
    registry.register(createWriteFileTool());
    registry.register(createEditFileTool());
    registry.register(createReplaceInFileTool());

    // Search
    registry.register(createGrepTool());
    registry.register(createFindTool());

    // Shell
    registry.register(createBashTool());
    registry.register(createLsTool());
    registry.register(createPwdTool());

    // Git
    for (const tool of createGitTools()) {
        registry.register(tool);
    }

    // VSCode
    registry.register(createContextTool());
    registry.register(createDiagnosticsTool());
    registry.register(createGetOpenEditorsTool());

    // Subagent (needs LlmClient + toolRegistry for tool access)
    if (client) {
        registry.register(createSubagentTool(client, registry));
    }
}
