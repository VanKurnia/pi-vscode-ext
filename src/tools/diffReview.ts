import { Tool } from '../agent/tools.js';

// We re-use runGit from git.ts — but it's not exported.
// Duplicate a lightweight version that invokes git the same way.
import { spawn } from 'child_process';
import { getWorkspaceRoot, resolveSafePath } from '../utils/pathGuard.js';

function runGit(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        let repoPath = cwd || getWorkspaceRoot();
        if (cwd) {
            const safe = resolveSafePath(cwd);
            if (safe.error) {
                reject(new Error('Invalid repo_path: ' + safe.error));
                return;
            }
            repoPath = safe.resolved;
        }
        const child = spawn('git', args, { cwd: repoPath, timeout: 30000 });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d: Buffer) => {
            stdout += d.toString();
        });
        child.stderr.on('data', (d: Buffer) => {
            stderr += d.toString();
        });
        child.on('close', (code) => {
            if (code === 0) resolve(stdout.trim());
            else reject(new Error(stderr.trim() || stdout.trim() || 'git exited with ' + code));
        });
        child.on('error', reject);
    });
}

// ────────────────────────────────────────────────
// Diff parsing helpers
// ────────────────────────────────────────────────

interface DiffFile {
    path: string;
    hunks: DiffHunk[];
}

interface DiffHunk {
    header: string;
    lines: string[];
    index: number; // 0-based hunk index within the file
}

function parseDiff(raw: string): DiffFile[] {
    if (!raw.trim()) return [];

    const files: DiffFile[] = [];
    const fileChunks = raw.split(/^diff --git /m).filter(Boolean);

    for (const chunk of fileChunks) {
        // Extract file path from "a/path b/path"
        const pathMatch = chunk.match(/^a\/(.+?) b\/(.+)/m);
        const filePath = pathMatch ? pathMatch[2] : '(unknown)';

        // Parse hunks
        const hunks: DiffHunk[] = [];
        const hunkChunks = chunk.split(/^@@ /m).slice(1); // skip header part
        for (let i = 0; i < hunkChunks.length; i++) {
            const hunkContent = hunkChunks[i];
            const headerMatch = hunkContent.match(/^(.+?@@ .*)$/m);
            const header = headerMatch ? '@@ ' + headerMatch[1] : '@@ (unknown)';
            const lines = hunkContent.split('\n').slice(1); // lines after header
            hunks.push({ header, lines, index: i });
        }

        files.push({ path: filePath, hunks });
    }

    return files;
}

// Cache the last diff so approve/reject work without re-fetching
let cachedDiffRaw = '';
let cachedParsedFiles: DiffFile[] = [];
let lastDiffType = 'all'; // 'all' | 'staged' | 'unstaged'

async function refreshDiff(repoPath?: string, file?: string): Promise<string> {
    const fileArgs = file ? [file] : [];
    const unstaged = await runGit(['diff', ...fileArgs], repoPath);
    const staged = await runGit(['diff', '--staged', ...fileArgs], repoPath);
    const parts: string[] = [];
    if (staged) parts.push('## Staged\n' + staged);
    if (unstaged) parts.push('## Unstaged\n' + unstaged);
    cachedDiffRaw = parts.join('\n\n') || '';

    // Also build a unified raw diff for parsing (staged + unstaged combined for single parse)
    const rawCombined = [staged, unstaged].filter(Boolean).join('\n');
    cachedParsedFiles = parseDiff(rawCombined);
    lastDiffType = 'all';
    return cachedDiffRaw;
}

// ────────────────────────────────────────────────
// Syntax-highlighted diff formatting
// ────────────────────────────────────────────────

function formatHunk(hunk: DiffHunk): string {
    const lines = [hunk.header];
    for (const line of hunk.lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
            lines.push(`🟢 ${line}`);
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            lines.push(`🔴 ${line}`);
        } else if (line.startsWith('@')) {
            lines.push(`🔵 ${line}`);
        } else {
            lines.push(`   ${line}`);
        }
    }
    return lines.join('\n');
}

function formatDiffFile(df: DiffFile): string {
    const parts = [`📄 **${df.path}**  (${df.hunks.length} hunk${df.hunks.length !== 1 ? 's' : ''})`];
    for (const hunk of df.hunks) {
        parts.push('');
        parts.push(`  [hunk #${hunk.index}]`);
        parts.push(formatHunk(hunk));
    }
    return parts.join('\n');
}

// ────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────

function createDiffReviewTool(): Tool {
    return {
        name: 'diff_review',
        description:
            'Show current uncommitted changes with syntax-highlighted diffs. ' +
            'Shows both staged and unstaged changes by default.',
        promptSnippet: 'Review uncommitted git changes',
        promptGuidelines: [
            'Use before committing to inspect all pending changes',
            'Provide file_path to review a single file',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                file_path: {
                    type: 'string',
                    description: 'Review a specific file only (optional)',
                },
                repo_path: { type: 'string', description: 'Path to repo' },
            },
            required: [],
        },
        async execute(args: any) {
            try {
                const raw = await refreshDiff(args?.repo_path, args?.file_path);
                if (!raw) {
                    return { content: 'No uncommitted changes.' };
                }

                const output: string[] = ['# Diff Review\n'];
                for (const df of cachedParsedFiles) {
                    output.push(formatDiffFile(df));
                    output.push('');
                }

                const progress = `Found changes in ${cachedParsedFiles.length} file(s), ` +
                    `${cachedParsedFiles.reduce((n, f) => n + f.hunks.length, 0)} hunk(s) total.\n` +
                    'Use diff_approve / diff_reject to manage hunks, then diff_commit.';

                return { content: output.join('\n') + '\n---\n' + progress };
            } catch (err: any) {
                return { content: `Diff review error: ${err.message}`, isError: true };
            }
        },
    };
}

function createDiffApproveTool(): Tool {
    return {
        name: 'diff_approve',
        description:
            'Stage (approve) specific hunks or entire files for commit. ' +
            'Use file_path + optional hunk_index to be selective.',
        promptSnippet: 'Approve/stage specific diff hunks',
        promptGuidelines: [
            'Call diff_review first to see available hunks',
            'Provide hunk_index to stage only that hunk',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                file_path: { type: 'string', description: 'File to approve' },
                hunk_index: {
                    type: 'number',
                    description: 'Specific hunk index to stage (omit to stage entire file)',
                },
                repo_path: { type: 'string', description: 'Path to repo' },
            },
            required: ['file_path'],
        },
        async execute(args: any) {
            try {
                const filePath = args.file_path;
                const hunkIdx = args?.hunk_index;
                const repoPath = args?.repo_path;

                if (hunkIdx !== undefined && hunkIdx !== null) {
                    // Stage specific hunk using `git apply` with patch
                    // We need to extract the specific hunk from the diff
                    // First, get the raw diff for the file
                    const fileDiff = await runGit(['diff', filePath], repoPath);
                    if (!fileDiff) {
                        // Maybe it's staged only
                        return {
                            content: `No unstaged changes for ${filePath}. Already staged or clean.`,
                        };
                    }

                    // Parse hunks from the raw diff
                    const hunks = parseDiff(fileDiff);
                    const fileHunks = hunks.find((f) => f.path === filePath);
                    if (!fileHunks) {
                        return {
                            content: `No hunks found for ${filePath}`,
                            isError: true,
                        };
                    }

                    const targetHunk = fileHunks.hunks[hunkIdx];
                    if (!targetHunk) {
                        return {
                            content: `Hunk #${hunkIdx} not found. Available: 0-${fileHunks.hunks.length - 1}`,
                            isError: true,
                        };
                    }

                    // Build a patch with just the file header + this hunk
                    const diffHeader = fileDiff.split(/^@@ /m)[0]; // everything before first @@
                    const patch = diffHeader + '@@ ' + targetHunk.header.replace(/^@@ /, '') + '\n' + targetHunk.lines.join('\n') + '\n';

                    // Apply with `git apply --cached`
                    const child = spawn('git', ['apply', '--cached'], {
                        cwd: repoPath || getWorkspaceRoot(),
                        timeout: 15000,
                    });
                    let stderr = '';
                    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
                    child.stdin.write(patch);
                    child.stdin.end();
                    await new Promise<void>((resolve, reject) => {
                        child.on('close', (code) => {
                            if (code === 0) resolve();
                            else reject(new Error(stderr.trim() || 'git apply failed'));
                        });
                        child.on('error', reject);
                    });

                    await refreshDiff(repoPath);
                    return {
                        content: `Approved (staged) hunk #${hunkIdx} of ${filePath}`,
                    };
                }

                // Stage entire file
                await runGit(['add', filePath], repoPath);
                await refreshDiff(repoPath);
                return { content: `Approved (staged) all changes in ${filePath}` };
            } catch (err: any) {
                return { content: `Approve error: ${err.message}`, isError: true };
            }
        },
    };
}

function createDiffRejectTool(): Tool {
    return {
        name: 'diff_reject',
        description:
            'Revert (reject) specific hunks or entire files. Discards changes from the working tree.',
        promptSnippet: 'Reject/revert specific diff hunks',
        promptGuidelines: [
            'This is destructive — rejected changes are lost',
            'Call diff_review first to see what you are rejecting',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                file_path: { type: 'string', description: 'File to reject changes in' },
                hunk_index: {
                    type: 'number',
                    description:
                        'Specific hunk index to revert (omit to revert all unstaged changes for the file)',
                },
                repo_path: { type: 'string', description: 'Path to repo' },
            },
            required: ['file_path'],
        },
        async execute(args: any) {
            try {
                const filePath = args.file_path;
                const hunkIdx = args?.hunk_index;
                const repoPath = args?.repo_path;

                if (hunkIdx !== undefined && hunkIdx !== null) {
                    // Reverse-apply the hunk from working tree
                    const fileDiff = await runGit(['diff', filePath], repoPath);
                    if (!fileDiff) {
                        return { content: `No unstaged changes for ${filePath} to reject.` };
                    }

                    const hunks = parseDiff(fileDiff);
                    const fileHunks = hunks.find((f) => f.path === filePath);
                    if (!fileHunks) {
                        return { content: `No hunks found for ${filePath}`, isError: true };
                    }

                    const targetHunk = fileHunks.hunks[hunkIdx];
                    if (!targetHunk) {
                        return {
                            content: `Hunk #${hunkIdx} not found. Available: 0-${fileHunks.hunks.length - 1}`,
                            isError: true,
                        };
                    }

                    const diffHeader = fileDiff.split(/^@@ /m)[0];
                    const patch = diffHeader + '@@ ' + targetHunk.header.replace(/^@@ /, '') + '\n' + targetHunk.lines.join('\n') + '\n';

                    const child = spawn('git', ['apply', '--reverse'], {
                        cwd: repoPath || getWorkspaceRoot(),
                        timeout: 15000,
                    });
                    let stderr = '';
                    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
                    child.stdin.write(patch);
                    child.stdin.end();
                    await new Promise<void>((resolve, reject) => {
                        child.on('close', (code) => {
                            if (code === 0) resolve();
                            else reject(new Error(stderr.trim() || 'git apply --reverse failed'));
                        });
                        child.on('error', reject);
                    });

                    await refreshDiff(repoPath);
                    return { content: `Rejected (reverted) hunk #${hunkIdx} of ${filePath}` };
                }

                // Revert all unstaged changes for the file
                await runGit(['checkout', '--', filePath], repoPath);
                await refreshDiff(repoPath);
                return { content: `Rejected (reverted) all unstaged changes in ${filePath}` };
            } catch (err: any) {
                return { content: `Reject error: ${err.message}`, isError: true };
            }
        },
    };
}

function createDiffCommitTool(): Tool {
    return {
        name: 'diff_commit',
        description:
            'Commit all currently staged changes. Call diff_approve first to stage what you want.',
        promptSnippet: 'Commit approved changes',
        promptGuidelines: [
            'Only staged changes will be committed',
            'Use conventional commit messages (feat:, fix:, etc.)',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                message: { type: 'string', description: 'Commit message' },
                repo_path: { type: 'string', description: 'Path to repo' },
            },
            required: ['message'],
        },
        async execute(args: any) {
            try {
                const repoPath = args?.repo_path;
                // Check if there's anything staged
                const staged = await runGit(['diff', '--staged', '--stat'], repoPath);
                if (!staged) {
                    return {
                        content: 'Nothing staged to commit. Use diff_approve to stage changes first.',
                        isError: true,
                    };
                }
                const result = await runGit(['commit', '-m', args.message], repoPath);
                await refreshDiff(repoPath);
                return { content: `Committed:\n${result}` };
            } catch (err: any) {
                return { content: `Commit error: ${err.message}`, isError: true };
            }
        },
    };
}

export function createDiffReviewTools(): Tool[] {
    return [
        createDiffReviewTool(),
        createDiffApproveTool(),
        createDiffRejectTool(),
        createDiffCommitTool(),
    ];
}
