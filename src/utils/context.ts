import * as vscode from 'vscode';
import * as path from 'path';

export function getActiveFileInfo() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    const doc = editor.document;
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    return {
        filePath: doc.fileName, language: doc.languageId,
        selection: doc.getText(editor.selection), lineCount: doc.lineCount,
        currentLine: editor.selection.active.line + 1,
        relativePath: ws ? path.relative(ws, doc.fileName) : doc.fileName,
    };
}

export function getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) throw new Error('No workspace folder open');
    return folders[0].uri.fsPath;
}

export function buildContextString(): string {
    const parts: string[] = [];
    const fi = getActiveFileInfo();
    if (fi) {
        parts.push(`**Active file:** \`${fi.relativePath}\` (${fi.language}, line ${fi.currentLine}/${fi.lineCount})`);
        if (fi.selection) {
            const preview = fi.selection.length > 200 ? fi.selection.slice(0, 200) + '...' : fi.selection;
            parts.push(`**Selection:**\n\`\`\`${fi.language}\n${preview}\n\`\`\``);
        }
    }
    const ws = vscode.workspace.workspaceFolders?.map(f => f.name) || [];
    if (ws.length > 0) parts.push(`**Workspace:** ${ws.join(', ')}`);
    return parts.join('\n\n');
}
