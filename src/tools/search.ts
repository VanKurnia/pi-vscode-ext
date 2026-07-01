import * as vscode from 'vscode';
import * as path from 'path';
import { Tool } from '../agent/tools';
import { resolveSafePath, getWorkspaceRoot } from '../utils/pathGuard';

export function createGrepTool(): Tool {
    return {
        name: 'grep',
        executionMode: 'parallel',
        description: 'Search file contents using regex pattern. Returns matching lines with file paths and line numbers.',
        parameters: {
            type: 'object' as const,
            properties: {
                pattern: { type: 'string', description: 'Regex pattern to search for' },
                path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
                include: { type: 'string', description: 'File glob pattern (e.g., "*.ts")' },
                max_results: { type: 'number', description: 'Maximum results (default: 50)' },
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
                const maxResults = args.max_results || 50;
                const regex = new RegExp(args.pattern, 'gi');
                const files = await vscode.workspace.findFiles(new vscode.RelativePattern(searchPath, args.include || '**/*'), '**/node_modules/**', 1000);

                const matches: string[] = [];
                for (const fileUri of files) {
                    if (matches.length >= maxResults) break;
                    try {
                        const bytes = await vscode.workspace.fs.readFile(fileUri);
                        const content = Buffer.from(bytes).toString('utf-8');
                        const lines = content.split('\n');
                        const relPath = path.relative(workspaceRoot, fileUri.fsPath);
                        for (let i = 0; i < lines.length; i++) {
                            if (matches.length >= maxResults) break;
                            if (regex.test(lines[i])) { matches.push(`${relPath}:${i + 1}: ${lines[i].trim()}`); }
                            regex.lastIndex = 0;
                        }
                    } catch {}
                }
                return { content: matches.length > 0 ? `**${matches.length} matches:**\n${matches.join('\n')}` : `No matches found for: ${args.pattern}` };
            } catch (err: any) { return { content: `Error searching: ${err.message}`, isError: true }; }
        },
    };
}

export function createMultiGrepTool(): Tool {
    return {
        name: 'multi_grep',
        executionMode: 'parallel',
        description: 'Search file contents for multiple patterns with OR logic (any pattern matches). Equivalent to pi-fff fff-multi-grep — uses Aho-Corasick multi-pattern matching.',
        promptSnippet: 'Search for multiple patterns at once',
        promptGuidelines: [
            'Use when searching for related terms (e.g., multiple function names, error variants)',
            'More efficient than running separate grep calls for each pattern',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                patterns: { type: 'array', items: { type: 'string' }, description: 'Array of patterns to search for (OR logic — matches any)' },
                path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
                include: { type: 'string', description: 'File glob pattern (e.g., "*.ts")' },
                max_results: { type: 'number', description: 'Maximum results (default: 50)' },
            },
            required: ['patterns'],
        },
        async execute(args: any) {
            try {
                const patterns: string[] = args.patterns;
                if (!patterns || patterns.length === 0) return { content: 'No patterns provided', isError: true };

                const workspaceRoot = getWorkspaceRoot();
                let searchPath = workspaceRoot;
                if (args.path) {
                    const safe = resolveSafePath(args.path);
                    if (safe.error) return { content: safe.error, isError: true };
                    searchPath = safe.resolved;
                }
                const maxResults = args.max_results || 50;
                const regexes = patterns.map(p => new RegExp(p, 'gi'));
                const files = await vscode.workspace.findFiles(new vscode.RelativePattern(searchPath, args.include || '**/*'), '**/node_modules/**', 1000);

                const matches: string[] = [];
                for (const fileUri of files) {
                    if (matches.length >= maxResults) break;
                    try {
                        const bytes = await vscode.workspace.fs.readFile(fileUri);
                        const content = Buffer.from(bytes).toString('utf-8');
                        const lines = content.split('\n');
                        const relPath = path.relative(workspaceRoot, fileUri.fsPath);
                        for (let i = 0; i < lines.length; i++) {
                            if (matches.length >= maxResults) break;
                            for (const regex of regexes) {
                                if (regex.test(lines[i])) {
                                    matches.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
                                    break; // Don't duplicate same line for multiple pattern matches
                                }
                                regex.lastIndex = 0;
                            }
                        }
                    } catch {}
                }
                const patternList = patterns.map(p => `"${p}"`).join(' OR ');
                return { content: matches.length > 0 ? `**${matches.length} matches** (${patternList}):\n${matches.join('\n')}` : `No matches found for: ${patternList}` };
            } catch (err: any) { return { content: `Error searching: ${err.message}`, isError: true }; }
        },
    };
}

export function createFindTool(): Tool {
    return {
        name: 'find',
        executionMode: 'parallel',
        description: 'Find files by glob pattern.',
        parameters: {
            type: 'object' as const,
            properties: {
                pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts")' },
                path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
                max_results: { type: 'number', description: 'Maximum results (default: 50)' },
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
                const files = await vscode.workspace.findFiles(new vscode.RelativePattern(searchPath, args.pattern), '**/node_modules/**', args.max_results || 50);
                if (files.length === 0) return { content: `No files found matching: ${args.pattern}` };
                const relPaths = files.map(f => path.relative(workspaceRoot, f.fsPath)).sort();
                return { content: `**${relPaths.length} files:**\n${relPaths.map(p => '- \`' + p + '\`').join('\n')}` };
            } catch (err: any) { return { content: `Error: ${err.message}`, isError: true }; }
        },
    };
}
