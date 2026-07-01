import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';

export function getActiveFileInfo(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const doc = editor.document;
    const parts = [
        'File: ' + doc.fileName,
        'Language: ' + doc.languageId,
    ];

    if (!editor.selection.isEmpty) {
        const selectedText = doc.getText(editor.selection);
        const startLine = editor.selection.start.line + 1;
        const endLine = editor.selection.end.line + 1;
        parts.push('Selection: lines ' + startLine + '-' + endLine);
        parts.push('Selected code:\n```' + doc.languageId + '\n' + selectedText + '\n```');
    }

    return parts.join('\n');
}

export async function getWorkspaceInfo(): Promise<string> {
    const parts: string[] = [];

    // Workspace folders
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
        parts.push('Workspace: ' + folders.map(f => f.name).join(', '));
    }

    // Git branch (async with timeout)
    const wsRoot = folders?.[0]?.uri.fsPath;
    if (wsRoot) {
        try {
            const branch = await new Promise<string>((resolve) => {
                const child = spawn('git', ['branch', '--show-current'], { cwd: wsRoot, timeout: 5000 });
                let out = '';
                child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
                child.on('close', () => resolve(out.trim()));
                child.on('error', () => resolve(''));
                setTimeout(() => { try { child.kill(); } catch {} resolve(''); }, 5000);
            });
            if (branch) { parts.push('Git branch: ' + branch); }
        } catch { /* ignore */ }
    }

    // Open editors count
    parts.push('Open editors: ' + vscode.window.visibleTextEditors.length);

    // Diagnostics summary
    let errors = 0, warnings = 0;
    for (const [, diags] of vscode.languages.getDiagnostics()) {
        for (const d of diags) {
            if (d.severity === vscode.DiagnosticSeverity.Error) errors++;
            if (d.severity === vscode.DiagnosticSeverity.Warning) warnings++;
        }
    }
    if (errors || warnings) {
        parts.push('Diagnostics: ' + errors + ' errors, ' + warnings + ' warnings');
    }

    return parts.join('\n');
}

export async function buildContextString(): Promise<string> {
    const parts: string[] = [];

    const fileInfo = getActiveFileInfo();
    if (fileInfo) { parts.push(fileInfo); }

    const wsInfo = await getWorkspaceInfo();
    if (wsInfo) { parts.push(wsInfo); }

    return parts.join('\n');
}
