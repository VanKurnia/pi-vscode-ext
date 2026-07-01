import * as vscode from 'vscode';
import { Tool } from '../agent/tools';
import { resolveSafePath } from '../utils/pathGuard';

export function createWriteFileTool(): Tool {
    return {
        name: 'write_file',
        description: 'Create a new file or overwrite an existing file with the given content. Use with caution — overwrites completely.',
        promptSnippet: 'Create or overwrite a file',
        promptGuidelines: ['Only use for new files or complete rewrites; prefer edit_file for partial changes'],
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
                const safe = resolveSafePath(args.path);
                if (safe.error) return { content: safe.error, isError: true };
                const filePath = safe.resolved;
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
