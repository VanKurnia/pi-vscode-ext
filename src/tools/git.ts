import { spawn } from 'child_process';
import { Tool } from '../agent/tools';

function getWorkspaceRoot(): string {
    const vscode = require('vscode');
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { throw new Error('No workspace folder open'); }
    return folders[0].uri.fsPath;
}

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
        parameters: { type: 'object' as const, properties: { repo_path: { type: 'string', description: 'Path to repo' } }, required: [] },
        async execute(args: any) {
            try {
                const o = await runGit(['status'], args?.repo_path);
                return { content: o ? o : 'Working tree clean' };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
    {
        name: 'git_diff',
        description: 'Shows unstaged changes in working directory',
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
        description: 'Shows staged changes',
        parameters: { type: 'object' as const, properties: { repo_path: { type: 'string', description: 'Path to repo' }, context_lines: { type: 'number', description: 'Context lines' } }, required: [] },
        async execute(args: any) {
            try {
                const c = args?.context_lines ?? 3;
                const o = await runGit(['diff', '--staged', '-U' + c], args?.repo_path);
                return { content: o ? o : 'No staged changes' };
            } catch (e: any) { return { content: e.message, isError: true }; }
        },
    },
    {
        name: 'git_add',
        description: 'Stage files for commit',
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
        parameters: { type: 'object' as const, properties: { message: { type: 'string', description: 'Commit message' }, repo_path: { type: 'string', description: 'Path to repo' } }, required: ['message'] },
        async execute(args: any) {
            try {
                const o = await runGit(['commit', '-m', args.message], args?.repo_path);
                return { content: 'Committed:\n' + o };
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
        name: 'git_branch',
        description: 'List, create, or switch branches',
        parameters: { type: 'object' as const, properties: { action: { type: 'string', description: 'list/create/checkout' }, branch_name: { type: 'string', description: 'Branch name' }, repo_path: { type: 'string', description: 'Path to repo' } }, required: [] },
        async execute(args: any) {
            try {
                const action = args?.action || 'list';
                if (action === 'list') { const o = await runGit(['branch', '-a'], args?.repo_path); return { content: o }; }
                if ((action === 'create' || action === 'checkout') && args?.branch_name) {
                    const gitArgs = action === 'create' ? ['checkout', '-b', args.branch_name] : ['checkout', args.branch_name];
                    await runGit(gitArgs, args?.repo_path);
                    return { content: (action === 'create' ? 'Created' : 'Switched to') + ' branch: ' + args.branch_name };
                }
                return { content: 'Specify branch_name for create/checkout', isError: true };
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
