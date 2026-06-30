import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { Tool } from '../agent/tools';
import { getBashGuard } from './bashGuard';
import { getConfig } from '../utils/config';

function getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { throw new Error('No workspace folder open'); }
    return folders[0].uri.fsPath;
}

export function createBashTool(): Tool {
    return {
        name: 'bash',
        description: 'Execute a bash/shell command in the workspace. Returns stdout, stderr, and exit code.',
        parameters: {
            type: 'object' as const,
            properties: {
                command: { type: 'string', description: 'The shell command to execute' },
                timeout: { type: 'number', description: 'Timeout in seconds (default: 120)' },
                cwd: { type: 'string', description: 'Working directory (default: workspace root)' },
            },
            required: ['command'],
        },
        async execute(args: any) {
            const config = getConfig();
            if (config.tools.enableBashGuard) {
                const guard = getBashGuard();
                const result = guard.check(args.command);
                if (!result.safe) { return { content: `⛔ Command blocked: ${result.reason}`, isError: true }; }
            }

            const cwd = args.cwd || getWorkspaceRoot();
            const timeout = (args.timeout || 120) * 1000;

            return new Promise((resolve) => {
                let stdout = ''; let stderr = '';
                const child = spawn('bash', ['-c', args.command], { cwd, env: { ...process.env, TERM: 'dumb' }, timeout });
                child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
                child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
                const timer = setTimeout(() => {
                    child.kill('SIGKILL');
                    resolve({ content: `Command timed out after ${args.timeout || 120}s\n\nStdout:\n${stdout.slice(-2000)}\nStderr:\n${stderr.slice(-2000)}`, isError: true });
                }, timeout);
                child.on('close', (code) => {
                    clearTimeout(timer);
                    const parts: string[] = [];
                    if (stdout) parts.push(`**Stdout:**\n${stdout.slice(0, 50000)}`);
                    if (stderr) parts.push(`**Stderr:**\n${stderr.slice(0, 10000)}`);
                    parts.push(`**Exit code:** ${code}`);
                    resolve({ content: parts.join('\n\n'), isError: code !== 0 });
                });
                child.on('error', (err) => { clearTimeout(timer); resolve({ content: `Failed to execute: ${err.message}`, isError: true }); });
            });
        },
    };
}
