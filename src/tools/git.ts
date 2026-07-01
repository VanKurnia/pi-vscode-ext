import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { Tool } from '../agent/tools';
import { getWorkspaceRoot } from '../utils/pathGuard';

function runGit(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const repoPath = cwd || getWorkspaceRoot();
        const child = spawn('git', args, { cwd: repoPath, timeout: 30000 });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        child.on('close', (code) => {
            if (code === 0) resolve(stdout.trim());
            else reject(new Error(stderr.trim() || stdout.trim() || 'git exited with ' + code));
        });
        child.on('error', reject);
    });
}

const gitTools: Tool[] = [
    {
        name: 'git_status',
        description: 'Shows the working tree status',
        promptSnippet: 'Check git working tree status',
        promptGuidelines: ['Use this to check what files are modified, staged, or untracked before other git operations'],
        parameters: { type: 'object' as const, properties: { repo_path: { type: 'string', description: 'Path to repo' } }, required: [] },
        async execute(args: any) {
            try {
                const o = await runGit(['status'], args?.repo_path);
                return { content: o ? o : 'Working tree clean' };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
    {
        name: 'git_diff_unstaged',
        description: 'Shows unstaged changes in working directory not yet staged',
        promptSnippet: 'Show unstaged changes in working directory',
        promptGuidelines: ['Shows changes not yet staged — use to review local edits before committing'],
        parameters: { type: 'object' as const, properties: { repo_path: { type: 'string', description: 'Path to repo' }, context_lines: { type: 'number', description: 'Context lines (default: 3)' } }, required: [] },
        async execute(args: any) {
            try {
                const c = args?.context_lines ?? 3;
                const o = await runGit(['diff', '-U' + c], args?.repo_path);
                return { content: o ? o : 'No unstaged changes' };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
    {
        name: 'git_diff_staged',
        description: 'Shows staged changes ready for commit',
        promptSnippet: 'Show staged changes ready for commit',
        promptGuidelines: ['Use after git_add to review what will be committed'],
        parameters: { type: 'object' as const, properties: { repo_path: { type: 'string', description: 'Path to repo' }, context_lines: { type: 'number', description: 'Context lines (default: 3)' } }, required: [] },
        async execute(args: any) {
            try {
                const c = args?.context_lines ?? 3;
                const o = await runGit(['diff', '--staged', '-U' + c], args?.repo_path);
                return { content: o ? o : 'No staged changes' };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
    {
        name: 'git_diff',
        description: 'Shows all uncommitted changes (staged + unstaged combined)',
        promptSnippet: 'Show all uncommitted changes for review',
        promptGuidelines: ['Use for a comprehensive view of all pending changes before commit'],
        parameters: { type: 'object' as const, properties: { repo_path: { type: 'string', description: 'Path to repo' }, context_lines: { type: 'number', description: 'Context lines (default: 3)' } }, required: [] },
        async execute(args: any) {
            try {
                const c = args?.context_lines ?? 3;
                const unstaged = await runGit(['diff', '-U' + c], args?.repo_path);
                const staged = await runGit(['diff', '--staged', '-U' + c], args?.repo_path);
                const parts = [];
                if (staged) parts.push('## Staged\n' + staged);
                if (unstaged) parts.push('## Unstaged\n' + unstaged);
                return { content: parts.join('\n\n') || 'No uncommitted changes' };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
    {
        name: 'git_add',
        description: 'Stage files for commit',
        promptSnippet: 'Stage files for the next commit',
        promptGuidelines: ['Stage only the files relevant to your current change'],
        parameters: { type: 'object' as const, properties: { files: { type: 'string', description: 'Space-separated files or "."' }, repo_path: { type: 'string', description: 'Path to repo' } }, required: ['files'] },
        async execute(args: any) {
            try {
                const files = args.files.split(/\s+/);
                await runGit(['add', ...files], args?.repo_path);
                return { content: 'Staged: ' + files.join(', ') };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
    {
        name: 'git_commit',
        description: 'Create a commit with a message',
        promptSnippet: 'Commit staged changes',
        promptGuidelines: ['Always git_diff_staged first to review; use conventional commit messages'],
        parameters: { type: 'object' as const, properties: { message: { type: 'string', description: 'Commit message' }, repo_path: { type: 'string', description: 'Path to repo' } }, required: ['message'] },
        async execute(args: any) {
            try {
                const o = await runGit(['commit', '-m', args.message], args?.repo_path);
                return { content: 'Committed:\n' + o };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
    {
        name: 'git_reset',
        description: 'Unstage all staged changes (soft reset)',
        parameters: { type: 'object' as const, properties: { repo_path: { type: 'string', description: 'Path to repo' } }, required: [] },
        async execute(args: any) {
            try {
                await runGit(['reset'], args?.repo_path);
                return { content: 'Successfully unstaged all changes' };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
    {
        name: 'git_log',
        description: 'Show commit log',
        parameters: { type: 'object' as const, properties: { repo_path: { type: 'string', description: 'Path to repo' }, count: { type: 'number', description: 'Number of entries' } }, required: [] },
        async execute(args: any) {
            try {
                const n = args?.count || 10;
                const o = await runGit(['log', '--oneline', '-n', String(n)], args?.repo_path);
                return { content: o || 'No commits yet' };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
    {
        name: 'git_create_branch',
        description: 'Create a new branch and switch to it',
        parameters: { type: 'object' as const, properties: { branch_name: { type: 'string', description: 'Name for the new branch' }, repo_path: { type: 'string', description: 'Path to repo' } }, required: ['branch_name'] },
        async execute(args: any) {
            try {
                await runGit(['checkout', '-b', args.branch_name], args?.repo_path);
                return { content: 'Created and switched to branch: ' + args.branch_name };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
    {
        name: 'git_checkout',
        description: 'Switch to an existing branch',
        parameters: { type: 'object' as const, properties: { branch_name: { type: 'string', description: 'Branch name to checkout' }, repo_path: { type: 'string', description: 'Path to repo' } }, required: ['branch_name'] },
        async execute(args: any) {
            try {
                await runGit(['checkout', args.branch_name], args?.repo_path);
                return { content: 'Switched to branch: ' + args.branch_name };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
    {
        name: 'git_branch',
        description: 'List all branches',
        parameters: { type: 'object' as const, properties: { repo_path: { type: 'string', description: 'Path to repo' } }, required: [] },
        async execute(args: any) {
            try {
                const o = await runGit(['branch', '-a'], args?.repo_path);
                return { content: o || 'No branches' };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
    {
        name: 'git_show',
        description: 'Show a specific commit',
        parameters: { type: 'object' as const, properties: { ref: { type: 'string', description: 'Commit hash/branch/tag (default: HEAD)' }, repo_path: { type: 'string', description: 'Path to repo' } }, required: [] },
        async execute(args: any) {
            try {
                const o = await runGit(['show', args?.ref || 'HEAD', '--stat'], args?.repo_path);
                return { content: o };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
];

export function createGitTools(): Tool[] {
    return gitTools;
}
