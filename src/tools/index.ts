import { ToolRegistry } from '../agent/tools';
import { LlmClient } from '../agent/client';
import { createReadFileTool } from './readFile';
import { createWriteFileTool } from './writeFile';
import { createEditFileTool } from './editFile';
import { createBashTool } from './bash';
import { createGrepTool, createFindTool } from './search';
import { createGitTools } from './git';
import { createSubagentTool } from './subagent';

export function registerAllTools(registry: ToolRegistry, client?: LlmClient): void {
    registry.register(createReadFileTool());
    registry.register(createWriteFileTool());
    registry.register(createEditFileTool());
    registry.register(createBashTool());
    registry.register(createGrepTool());
    registry.register(createFindTool());
    for (const tool of createGitTools()) {
        registry.register(tool);
    }
    // Subagent tool - needs LlmClient for delegation
    if (client) {
        registry.register(createSubagentTool(client));
    }
}
