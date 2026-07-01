import * as vscode from 'vscode';
import { Tool } from '../agent/tools';
import { resolveSafePath } from '../utils/pathGuard';

export function createReadFileTool(): Tool {
    return {
        name: 'read_file',
        description: 'Read a file content with line numbers. Supports offset and limit for large files.',
        parameters: {
            type: 'object' as const,
            properties: {
                path: { type: 'string', description: 'Absolute or workspace-relative path to the file' },
                offset: { type: 'number', description: 'Line number to start from (1-indexed, default: 1)' },
                limit: { type: 'number', description: 'Max lines to read (default: 500, max: 2000)' },
            },
            required: ['path'],
        },
        async execute(args: any) {
            try {
                const safe = resolveSafePath(args.path);
                if (safe.error) return { content: safe.error, isError: true };
                const filePath = safe.resolved;
                const offset = Math.max(1, args.offset ?? 1);
                const limit = Math.min(2000, Math.max(1, args.limit ?? 500));

                const uri = vscode.Uri.file(filePath);
                const bytes = await vscode.workspace.fs.readFile(uri);
                const text = Buffer.from(bytes).toString('utf-8');
                const allLines = text.split('\n');
                const totalLines = allLines.length;
                const startIdx = offset - 1;
                const endIdx = Math.min(startIdx + limit, totalLines);

                if (startIdx >= totalLines) {
                    return { content: `Offset ${offset} exceeds file length (${totalLines} lines)`, isError: true };
                }

                const selectedLines = allLines.slice(startIdx, endIdx);
                const numberedLines = selectedLines.map((line, i) => {
                    const lineNum = startIdx + i + 1;
                    return `${lineNum.toString().padStart(5, ' ')}|  ${line}`;
                }).join('\n');

                const rangeInfo = offset === 1 && limit >= totalLines ? '' : ` showing ${startIdx + 1}-${endIdx}`;
                return { content: `**File: ${args.path}** (${totalLines} total lines${rangeInfo})\n\n${numberedLines}` };
            } catch (err: any) {
                return { content: `Error reading file: ${err.message}`, isError: true };
            }
        },
    };
}
