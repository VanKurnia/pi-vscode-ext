import * as vscode from 'vscode';
import * as path from 'path';
import { Tool } from '../agent/tools.js';
import { resolveSafePath, getWorkspaceRoot } from '../utils/pathGuard.js';

/**
 * Fuzzy score: higher is better match.
 * Consecutive character matches get a bonus; exact character matches too.
 */
function fuzzyScore(pattern: string, target: string): number {
    const p = pattern.toLowerCase();
    const t = target.toLowerCase();
    if (p === t) return 1000;
    if (t.includes(p)) return 800 + (t.startsWith(p) ? 100 : 0);

    let score = 0;
    let pIdx = 0;
    let consecutive = 0;

    for (let tIdx = 0; tIdx < t.length && pIdx < p.length; tIdx++) {
        if (t[tIdx] === p[pIdx]) {
            pIdx++;
            consecutive++;
            score += consecutive * 10; // consecutive bonus
            // Bonus for matching at start of filename or after separator
            if (tIdx === 0 || '/._-'.includes(t[tIdx - 1])) {
                score += 30;
            }
        } else {
            consecutive = 0;
        }
    }

    // All pattern chars must be found
    if (pIdx < p.length) return -1;

    // Penalize long filenames (prefer shorter matches)
    score -= (t.length - p.length) * 2;
    return score;
}

function isGlobPattern(pattern: string): boolean {
    return /[*?{\[]/.test(pattern);
}

async function findFilesByGlob(
    pattern: string,
    searchPath: string,
    maxResults: number
): Promise<vscode.Uri[]> {
    // Exclude common non-useful dirs
    const exclude = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.next/**}';
    return vscode.workspace.findFiles(
        new vscode.RelativePattern(searchPath, pattern),
        exclude,
        maxResults
    );
}

async function fuzzySearchFiles(
    query: string,
    searchPath: string,
    maxResults: number
): Promise<{ filePath: string; score: number }[]> {
    // If it looks like a glob, use glob matching first, then fuzzy-rank the results
    if (isGlobPattern(query)) {
        const uris = await findFilesByGlob(query, searchPath, maxResults * 3);
        const scored = uris.map(uri => ({
            filePath: path.relative(searchPath, uri.fsPath),
            score: fuzzyScore(path.basename(uri.fsPath), path.basename(uri.fsPath)), // identity for pure glob
        }));
        return scored.slice(0, maxResults);
    }

    // Fuzzy search: collect all files, score them
    const uris = await findFilesByGlob('**/*', searchPath, 10000);
    const scored: { filePath: string; score: number }[] = [];

    for (const uri of uris) {
        const relPath = path.relative(searchPath, uri.fsPath);
        const basename = path.basename(uri.fsPath);

        // Score against basename and full relative path
        const baseScore = fuzzyScore(query, basename);
        const pathScore = fuzzyScore(query, relPath);
        const best = Math.max(baseScore, pathScore > 0 ? pathScore * 0.8 : -1);

        if (best > 0) {
            scored.push({ filePath: relPath, score: best });
        }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults);
}

export function createFuzzyFindTool(): Tool {
    return {
        name: 'fuzzy_find',
        executionMode: 'parallel',
        description: 'Find files by fuzzy pattern matching. Supports glob patterns (*.ts, **/*.json) and fuzzy matching (partial name, typo-tolerant). Returns file paths sorted by relevance.',
        promptSnippet: 'Fuzzy-find files by name or pattern',
        promptGuidelines: [
            'Use when you need to locate a file but don\'t know the exact path',
            'Supports glob patterns like "*.ts" or "**/*.json"',
            'Also supports fuzzy partial names like "toolReg" to find "ToolRegistry.ts"',
            'Results are ranked by relevance — best matches first',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                pattern: { type: 'string', description: 'Glob pattern (*.ts, **/*.json) or fuzzy name (partial match, typo-tolerant)' },
                path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
                max_results: { type: 'number', description: 'Maximum results (default: 20)' },
            },
            required: ['pattern'],
        },
        async execute(args: any) {
            try {
                const workspaceRoot = getWorkspaceRoot();
                let searchPath = workspaceRoot;
                if (args.path) {
                    const safe = resolveSafePath(args.path);
                    if (safe.error) return { content: safe.error, isError: true };
                    searchPath = safe.resolved;
                }
                const maxResults = args.max_results || 20;
                const results = await fuzzySearchFiles(args.pattern, searchPath, maxResults);

                if (results.length === 0) {
                    return { content: `No files found matching: "${args.pattern}"` };
                }

                const lines = results.map((r, i) => {
                    const scoreInfo = ` (score: ${Math.round(r.score)})`;
                    return `${i + 1}. \`${r.filePath}\`${scoreInfo}`;
                });
                return { content: `**${results.length} fuzzy matches for "${args.pattern}":**\n${lines.join('\n')}` };
            } catch (err: any) {
                return { content: `Error in fuzzy_find: ${err.message}`, isError: true };
            }
        },
    };
}

export function createFuzzyOpenTool(): Tool {
    return {
        name: 'fuzzy_open',
        executionMode: 'parallel',
        description: 'Quick-open a file by fuzzy name match and return a content preview (first 80 lines).',
        promptSnippet: 'Fuzzy-find and preview a file\'s contents',
        promptGuidelines: [
            'Use to quickly look at a file when you know part of its name',
            'Returns the first 80 lines of the best-matching file',
            'Use max_preview_lines to control how much content is returned',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                pattern: { type: 'string', description: 'Fuzzy file name or glob pattern to find the file' },
                path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
                max_preview_lines: { type: 'number', description: 'Number of lines to preview (default: 80)' },
            },
            required: ['pattern'],
        },
        async execute(args: any) {
            try {
                const workspaceRoot = getWorkspaceRoot();
                let searchPath = workspaceRoot;
                if (args.path) {
                    const safe = resolveSafePath(args.path);
                    if (safe.error) return { content: safe.error, isError: true };
                    searchPath = safe.resolved;
                }

                const results = await fuzzySearchFiles(args.pattern, searchPath, 1);
                if (results.length === 0) {
                    return { content: `No file found matching: "${args.pattern}"`, isError: true };
                }

                const bestMatch = results[0];
                const fullPath = path.join(searchPath, bestMatch.filePath);
                const maxLines = args.max_preview_lines || 80;

                try {
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
                    const totalLines = doc.lineCount;
                    const previewLineCount = Math.min(maxLines, totalLines);
                    const lines: string[] = [];
                    for (let i = 0; i < previewLineCount; i++) {
                        lines.push(`${i + 1}| ${doc.lineAt(i).text}`);
                    }
                    const truncated = totalLines > previewLineCount
                        ? `\n... (${totalLines - previewLineCount} more lines, ${totalLines} total)`
                        : '';

                    return {
                        content: `**${bestMatch.filePath}** (score: ${Math.round(bestMatch.score)}, ${totalLines} lines)\n\`\`\`\n${lines.join('\n')}${truncated}\n\`\`\``,
                    };
                } catch (readErr: any) {
                    return { content: `Found file "${bestMatch.filePath}" but could not read it: ${readErr.message}`, isError: true };
                }
            } catch (err: any) {
                return { content: `Error in fuzzy_open: ${err.message}`, isError: true };
            }
        },
    };
}
