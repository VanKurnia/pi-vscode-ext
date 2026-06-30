import { ToolRegistry } from '../agent/tools';
import { createReadFileTool } from './readFile';
import { createWriteFileTool } from './writeFile';
import { createEditFileTool } from './editFile';
import { createBashTool } from './bash';
import { createGrepTool, createFindTool } from './search';
import { createGitTools } from './git';

export function registerAllTools(registry: ToolRegistry): void {
    registry.register(createReadFileTool());
    registry.register(createWriteFileTool());
    registry.register(createEditFileTool());
    registry.register(createBashTool());
    registry.register(createGrepTool());
    registry.register(createFindTool());
    for (const tool of createGitTools()) {
        registry.register(tool);
    }
}
