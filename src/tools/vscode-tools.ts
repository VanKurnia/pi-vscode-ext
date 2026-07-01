import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Tool } from '../agent/tools';
import { resolveSafePath, getWorkspaceRoot } from '../utils/pathGuard';

export function createLsTool(): Tool {
    return {
        name: 'ls',
        executionMode: 'parallel',
        description: 'List directory contents with file sizes and types',
        parameters: {
            type: 'object' as const,
            properties: {
                path: { type: 'string', description: 'Directory path (default: workspace root)' },
            },
            required: [],
        },
        async execute(args: any) {
            try {
                const dir = args?.path || getWorkspaceRoot();
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                const lines = entries.map(e => {
                    const prefix = e.isDirectory() ? '📁' : '📄';
                    let size = '';
                    if (!e.isDirectory()) {
                        try {
                            const stat = fs.statSync(path.join(dir, e.name));
                            size = ' (' + formatSize(stat.size) + ')';
                        } catch { /* ignore */ }
                    }
                    return prefix + ' ' + e.name + size;
                });
                return { content: '**' + dir + ':**\n\n' + lines.join('\n') };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    };
}

export function createPwdTool(): Tool {
    return {
        name: 'pwd',
        executionMode: 'parallel',
        description: 'Show current workspace root directory',
        parameters: { type: 'object' as const, properties: {}, required: [] },
        async execute() {
            return { content: getWorkspaceRoot() };
        },
    };
}

export function createContextTool(): Tool {
    return {
        name: 'context',
        executionMode: 'parallel',
        description: 'Show current workspace context: active file, cursor/selection, open files, diagnostics. Equivalent to pi-x-ide IDE context integration.',
        promptSnippet: 'Get current editor context',
        promptGuidelines: [
            'Use to understand what the user is currently looking at',
            'Returns cursor position, selection content, and active file info',
        ],
        parameters: { type: 'object' as const, properties: { include_content: { type: 'boolean', description: 'Include a preview of the active file content (default: false)' } }, required: [] },
        async execute(args: any) {
            const parts: string[] = [];

            // Workspace
            const folders = vscode.workspace.workspaceFolders;
            if (folders) {
                parts.push('**Workspace:** ' + folders.map((f: any) => f.name).join(', '));
            }

            // Active editor — enhanced with pi-x-ide style context
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const doc = editor.document;
                const wsRoot = getWorkspaceRoot();
                const relPath = path.relative(wsRoot, doc.fileName);
                parts.push('**Active file:** ' + relPath);
                parts.push('**Language:** ' + doc.languageId);
                parts.push('**Line count:** ' + doc.lineCount);

                // Cursor position (pi-x-ide style)
                const pos = editor.selection.active;
                parts.push('**Cursor:** L' + (pos.line + 1) + ':C' + (pos.character + 1));

                // Selection details
                if (!editor.selection.isEmpty) {
                    const sel = editor.selection;
                    const selText = doc.getText(sel);
                    const selLines = selText.split('\n');
                    parts.push('**Selection:** L' + (sel.start.line + 1) + ':C' + (sel.start.character + 1) + ' → L' + (sel.end.line + 1) + ':C' + (sel.end.character + 1) + ' (' + selLines.length + ' lines, ' + selText.length + ' chars)');
                    if (selText.length < 500) {
                        parts.push('```' + doc.languageId + '\n' + selText + '\n```');
                    }
                }

                // Context around cursor (surrounding lines)
                const ctxStart = Math.max(0, pos.line - 5);
                const ctxEnd = Math.min(doc.lineCount - 1, pos.line + 5);
                const ctxLines: string[] = [];
                for (let i = ctxStart; i <= ctxEnd; i++) {
                    const marker = i === pos.line ? ' → ' : '   ';
                    ctxLines.push(marker + (i + 1) + ': ' + doc.lineAt(i).text);
                }
                parts.push('**Context around cursor:**\n```' + doc.languageId + '\n' + ctxLines.join('\n') + '\n```');

                // Include full file content if requested
                if (args?.include_content && doc.lineCount <= 500) {
                    parts.push('**Full file content:**\n```' + doc.languageId + '\n' + doc.getText() + '\n```');
                }
            } else {
                parts.push('**No active editor**');
            }

            // All open editors (not just visible)
            const openEditors: string[] = [];
            for (const e of vscode.window.visibleTextEditors) {
                if (e !== editor) {
                    openEditors.push(path.relative(getWorkspaceRoot(), e.document.fileName));
                }
            }
            if (openEditors.length > 0) {
                parts.push('**Open editors:** ' + openEditors.join(', '));
            }

            // Diagnostics summary
            const diags = vscode.languages.getDiagnostics();
            let errors = 0, warnings = 0;
            for (const [, diagsList] of diags) {
                for (const d of diagsList) {
                    if (d.severity === vscode.DiagnosticSeverity.Error) errors++;
                    if (d.severity === vscode.DiagnosticSeverity.Warning) warnings++;
                }
            }
            if (errors > 0 || warnings > 0) {
                parts.push('**Diagnostics:** ' + errors + ' errors, ' + warnings + ' warnings');
            }

            return { content: parts.join('\n') };
        },
    };
}

export function createDiagnosticsTool(): Tool {
    return {
        name: 'get_diagnostics',
        executionMode: 'parallel',
        description: 'Get compiler/linter diagnostics (errors, warnings) for open files',
        parameters: {
            type: 'object' as const,
            properties: {
                file: { type: 'string', description: 'Specific file path (optional, defaults to all open files)' },
            },
            required: [],
        },
        async execute(args: any) {
            const parts: string[] = [];

            for (const [uri, diags] of vscode.languages.getDiagnostics()) {
                if (args?.file && !uri.fsPath.includes(args.file)) continue;
                if (diags.length === 0) continue;

                parts.push('**' + path.basename(uri.fsPath) + ':**');
                for (const d of diags) {
                    const sev = d.severity === vscode.DiagnosticSeverity.Error ? '🔴' : d.severity === vscode.DiagnosticSeverity.Warning ? '🟡' : 'ℹ️';
                    parts.push(sev + ' L' + (d.range.start.line + 1) + ': ' + d.message);
                }
            }

            return { content: parts.length ? parts.join('\n') : 'No diagnostics — all clean! ✅' };
        },
    };
}

export function createGetOpenEditorsTool(): Tool {
    return {
        name: 'get_open_editors',
        executionMode: 'parallel',
        description: 'List all currently open editor tabs/files',
        parameters: { type: 'object' as const, properties: {}, required: [] },
        async execute() {
            const parts: string[] = [];

            // Active editor
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                parts.push('**Active:** ' + editor.document.fileName);
            }

            // Visible editors
            for (const e of vscode.window.visibleTextEditors) {
                if (e !== editor) {
                    parts.push('- ' + e.document.fileName);
                }
            }

            return { content: parts.length ? parts.join('\n') : 'No editors open' };
        },
    };
}

export function createReplaceInFileTool(): Tool {
    return {
        name: 'replace_in_file',
        description: 'Find and replace text in a file. Use for targeted edits.',
        parameters: {
            type: 'object' as const,
            properties: {
                file_path: { type: 'string', description: 'Path to file' },
                old_string: { type: 'string', description: 'Text to find (must be unique)' },
                new_string: { type: 'string', description: 'Replacement text' },
            },
            required: ['file_path', 'old_string', 'new_string'],
        },
        async execute(args: any) {
            try {
                const safe = resolveSafePath(args.file_path);
                if (safe.error) return { content: safe.error, isError: true };
                const filePath = safe.resolved;
                const content = fs.readFileSync(filePath, 'utf-8');
                if (!content.includes(args.old_string)) {
                    return { content: 'Text not found in file', isError: true };
                }
                const updated = content.replace(args.old_string, args.new_string);
                fs.writeFileSync(filePath, updated, 'utf-8');
                return { content: '✅ Replaced in ' + path.basename(filePath) };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    };
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}
