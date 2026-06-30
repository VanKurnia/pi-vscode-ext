import * as vscode from 'vscode';
import * as path from 'path';
import { Tool } from '../agent/tools';

function getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { throw new Error('No workspace folder open'); }
    return folders[0].uri.fsPath;
}

export function createWriteFileTool(): Tool {
    return {
        name: 'write_file',
        description: 'Write content to a file. Creates it if it does not exist. Creates parent directories automatically.',
        parameters: {
            type: 'object' as const,
            properties: {
                path: { type: 'string', description: 'File path (absolute or workspace-relative)' },
                content: { type: 'string', description: 'Complete file content to write' },
            },
            required: ['path', 'content'],
        },
        async execute(args: any) {
            try {
                const workspaceRoot = getWorkspaceRoot();
                const filePath = path.isAbsolute(args.path) ? args.path : path.join(workspaceRoot, args.path);
                const uri = vscode.Uri.file(filePath);

                let isNew = false;
                try { await vscode.workspace.fs.stat(uri); } catch { isNew = true; }
                await vscode.workspace.fs.writeFile(uri, Buffer.from(args.content, 'utf-8'));

                const lineCount = args.content.split('\n').length;
                return { content: `${isNew ? 'Created' : 'Wrote'} \`${args.path}\` (${lineCount} lines)` };
            } catch (err: any) {
                return { content: `Error writing file: ${err.message}`, isError: true };
            }
        },
    };
}
