import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Resolve a file path and validate it stays within workspace boundaries.
 * Prevents path traversal attacks (e.g., LLM tricked into writing to /etc/passwd).
 */
export function resolveSafePath(inputPath: string): { resolved: string; error?: string } {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return { resolved: '', error: 'No workspace folder open' };
    }

    const workspaceRoot = folders[0].uri.fsPath;
    const resolved = path.isAbsolute(inputPath)
        ? path.resolve(inputPath)
        : path.resolve(workspaceRoot, inputPath);

    // Normalize to prevent traversal (../../etc/passwd)
    const normalized = path.normalize(resolved);

    // Allow paths within any workspace folder
    for (const folder of folders) {
        const folderRoot = path.resolve(folder.uri.fsPath);
        if (normalized === folderRoot || normalized.startsWith(folderRoot + path.sep)) {
            return { resolved: normalized };
        }
    }

    // Also allow /tmp and system temp for test scenarios
    const os = require('os');
    const tmpDir = path.resolve(os.tmpdir());
    if (normalized.startsWith(tmpDir)) {
        return { resolved: normalized };
    }

    return {
        resolved: normalized,
        error: `Path '${inputPath}' is outside workspace boundaries. Only files within the workspace can be accessed.`,
    };
}

export function getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        throw new Error('No workspace folder open');
    }
    return folders[0].uri.fsPath;
}
