import * as vscode from 'vscode';
import * as diffLib from 'diff';
import { Tool } from '../agent/tools';
import { resolveSafePath } from '../utils/pathGuard';

export function createEditFileTool(): Tool {
    return {
        name: 'edit_file',
        description: 'Find and replace text in a file. Returns a unified diff of the change.',
        parameters: {
            type: 'object' as const,
            properties: {
                path: { type: 'string', description: 'File path (absolute or workspace-relative)' },
                old_string: { type: 'string', description: 'The exact text to find and replace' },
                new_string: { type: 'string', description: 'The replacement text' },
                replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' },
            },
            required: ['path', 'old_string', 'new_string'],
        },
        async execute(args: any) {
            try {
                const safe = resolveSafePath(args.path);
                if (safe.error) return { content: safe.error, isError: true };
                const filePath = safe.resolved;
                const uri = vscode.Uri.file(filePath);

                let content: string;
                try {
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    content = Buffer.from(bytes).toString('utf-8');
                } catch { return { content: `File not found: ${args.path}`, isError: true }; }

                if (!content.includes(args.old_string)) {
                    return { content: 'old_string not found in file. Ensure exact match including whitespace.', isError: true };
                }

                let newContent: string;
                if (args.replace_all) {
                    newContent = content.split(args.old_string).join(args.new_string);
                } else {
                    const idx = content.indexOf(args.old_string);
                    newContent = content.slice(0, idx) + args.new_string + content.slice(idx + args.old_string.length);
                }

                const patch = diffLib.createTwoFilesPatch(`a/${args.path}`, `b/${args.path}`, content, newContent, '', '', { context: 3 });
                await vscode.workspace.fs.writeFile(uri, Buffer.from(newContent, 'utf-8'));
                const count = args.replace_all ? content.split(args.old_string).length - 1 : 1;
                return { content: `Edited \`${args.path}\` (${count} replacement${count > 1 ? 's' : ''})\n\n\`\`\`diff\n${patch}\n\`\`\`` };
            } catch (err: any) {
                return { content: `Error editing file: ${err.message}`, isError: true };
            }
        },
    };
}
