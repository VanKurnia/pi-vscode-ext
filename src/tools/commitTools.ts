import { spawn } from 'child_process';
import * as path from 'path';
import { Tool } from '../agent/tools.js';
import { getWorkspaceRoot, resolveSafePath } from '../utils/pathGuard.js';

function runGit(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        let repoPath = cwd || getWorkspaceRoot();
        if (cwd) {
            const safe = resolveSafePath(cwd);
            if (safe.error) { reject(new Error('Invalid repo_path: ' + safe.error)); return; }
            repoPath = safe.resolved;
        }
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

/** Parse a git diff --stat output to get file summary */
function parseDiffStats(diff: string): { file: string; additions: number; deletions: number }[] {
    const stats: { file: string; additions: number; deletions: number }[] = [];
    const statLineRegex = /^\s*(.+?)\s+\|\s+(\d+)\s+([+-]+)/;
    for (const line of diff.split('\n')) {
        const match = line.match(statLineRegex);
        if (match) {
            const pluses = (match[3].match(/\+/g) || []).length;
            const minuses = (match[3].match(/-/g) || []).length;
            const total = pluses + minuses;
            const additions = Math.round((pluses / total) * parseInt(match[2], 10));
            const deletions = parseInt(match[2], 10) - additions;
            stats.push({ file: match[1].trim(), additions, deletions });
        }
    }
    return stats;
}

/** Classify changes into conventional commit type based on diff content */
function inferCommitType(diff: string): { type: string; scope: string; description: string } {
    const filesChanged = diff.match(/^diff --git a\/(.+?) b\//gm)?.map(m => m.replace(/^diff --git a\//, '').replace(/ b\/.*/, '')) || [];
    const addedLines = (diff.match(/^\+[^+]/gm) || []).length;
    const removedLines = (diff.match(/^-[^-]/gm) || []).length;

    let type = 'feat';
    let scope = '';

    // Infer type from file patterns
    const allFiles = filesChanged.join(' ');
    if (/test|spec|__test__/.test(allFiles)) type = 'test';
    else if (/\.md|readme|changelog|docs/.test(allFiles)) type = 'docs';
    else if (/ci|\.github|dockerfile|\.yml|\.yaml/.test(allFiles)) type = 'ci';
    else if (/package\.json|lock|dependencies/.test(allFiles)) type = 'build';
    else if (/eslint|prettier|format|lint/.test(allFiles)) type = 'style';
    else if (/fix|bug|patch|hotfix/.test(allFiles.toLowerCase())) type = 'fix';
    else if (/refactor|clean|rename|move/.test(allFiles.toLowerCase())) type = 'refactor';
    else if (removedLines > addedLines * 2) type = 'refactor';
    else if (addedLines < 10 && removedLines < 10) type = 'chore';

    // Infer scope from directory
    const dirs = filesChanged.map(f => path.dirname(f).split('/')[0]).filter(d => d && d !== '.');
    const uniqueDirs = Array.from(new Set(dirs));
    if (uniqueDirs.length === 1) scope = uniqueDirs[0];
    else if (uniqueDirs.length <= 3) scope = uniqueDirs.join(', ');

    const description = filesChanged.length === 1
        ? `update ${path.basename(filesChanged[0])}`
        : `update ${filesChanged.length} files`;

    return { type, scope, description };
}

/** Assess risk level from diff */
function assessRisk(diff: string): { level: 'low' | 'medium' | 'high'; reasons: string[] } {
    const reasons: string[] = [];
    let risk = 0;

    // Large changeset
    const totalLines = (diff.match(/^[+-]/gm) || []).length;
    if (totalLines > 500) { risk += 2; reasons.push(`Large changeset (${totalLines} changed lines)`); }

    // Sensitive patterns
    if (/password|secret|token|apikey|api_key/i.test(diff)) {
        risk += 3;
        reasons.push('Possible secrets/credentials detected in diff');
    }
    if (/\beval\b|\bexec\b|child_process|dangerouslySetInnerHTML/i.test(diff)) {
        risk += 2;
        reasons.push('Potentially dangerous operations (eval/exec/innerHTML)');
    }
    if (/rm\s+-rf|unlink|rmdir|drop\s+table|delete\s+from/i.test(diff)) {
        risk += 2;
        reasons.push('Destructive operations detected');
    }
    if (/\.env|config\.json|credentials/i.test(diff)) {
        risk += 1;
        reasons.push('Configuration files modified');
    }

    // Many files touched
    const fileCount = (diff.match(/^diff --git/gm) || []).length;
    if (fileCount > 20) { risk += 1; reasons.push(`Many files changed (${fileCount})`); }

    const level = risk >= 4 ? 'high' : risk >= 2 ? 'medium' : 'low';
    return { level, reasons };
}

/** Check if diff should be split into multiple commits */
function suggestSplit(diff: string): string[] {
    const suggestions: string[] = [];
    const fileGroups = new Map<string, string[]>();

    const diffs = diff.split(/^diff --git /m).filter(Boolean);
    for (const d of diffs) {
        const fileMatch = d.match(/a\/(.+?) b\//);
        if (!fileMatch) continue;
        const filePath = fileMatch[1];
        const dir = path.dirname(filePath).split('/')[0] || 'root';
        if (!fileGroups.has(dir)) fileGroups.set(dir, []);
        fileGroups.get(dir)!.push(filePath);
    }

    if (fileGroups.size > 3) {
        const groupList = Array.from(fileGroups.entries())
            .map(([dir, files]) => `  - ${dir}/ (${files.length} file${files.length > 1 ? 's' : ''})`)
            .join('\n');
        suggestions.push(`Changes span ${fileGroups.size} distinct areas — consider splitting:\n${groupList}`);
    }

    // Check for mixed concerns
    const allContent = diff;
    const hasTests = /test|spec/.test(allContent);
    const hasSrc = /src\//.test(allContent);
    if (hasTests && hasSrc) {
        suggestions.push('Mix of test and source file changes — consider separate commits for test additions');
    }

    return suggestions;
}

export function createCommitGenerateTool(): Tool {
    return {
        name: 'commit_generate',
        description: 'Generate a conventional commit message from staged changes. Analyzes the staged diff and suggests a structured commit message in Conventional Commits format.',
        promptSnippet: 'Generate a conventional commit message from staged changes',
        promptGuidelines: [
            'Run this after staging files (git_add) to get a suggested commit message',
            'The tool analyzes staged diff content and infers commit type, scope, and description',
            'Returns a structured Conventional Commits format message ready for git_commit',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                repo_path: { type: 'string', description: 'Path to repo (default: workspace root)' },
            },
            required: [],
        },
        async execute(args: any) {
            try {
                const diff = await runGit(['diff', '--staged'], args?.repo_path);
                if (!diff) {
                    return { content: 'No staged changes found. Stage files with git_add first.', isError: true };
                }

                const statOutput = await runGit(['diff', '--staged', '--stat'], args?.repo_path);
                const stats = parseDiffStats(statOutput);
                const { type, scope, description } = inferCommitType(diff);

                const scopePart = scope ? `(${scope})` : '';
                const subject = `${type}${scopePart}: ${description}`;

                // Build body from stats
                const bodyLines = stats.slice(0, 10).map(s => {
                    const parts: string[] = [];
                    if (s.additions > 0) parts.push(`+${s.additions}`);
                    if (s.deletions > 0) parts.push(`-${s.deletions}`);
                    return `- ${s.file} (${parts.join(', ')})`;
                });
                if (stats.length > 10) bodyLines.push(`- ... and ${stats.length - 10} more files`);

                const totalAdded = stats.reduce((s, f) => s + f.additions, 0);
                const totalRemoved = stats.reduce((s, f) => s + f.deletions, 0);

                const message = `${subject}\n\n${bodyLines.join('\n')}\n\nTotal: +${totalAdded} -${totalRemoved} across ${stats.length} file(s)`;

                return {
                    content: `## Suggested Commit Message\n\n\`\`\`\n${subject}\n\`\`\`\n\n### With body:\n\`\`\`\n${message}\n\`\`\`\n\n### Analysis:\n- **Type**: ${type}\n- **Scope**: ${scope || '(none detected)'}\n- **Files**: ${stats.length}\n- **Changes**: +${totalAdded} / -${totalRemoved}\n\nUse \`git_commit\` with the suggested message.`,
                };
            } catch (err: any) {
                return { content: `Error generating commit message: ${err.message}`, isError: true };
            }
        },
    };
}

export function createCommitReviewTool(): Tool {
    return {
        name: 'commit_review',
        description: 'Review uncommitted changes before commit. Shows diff with risk assessment and suggests if changes should be split into multiple commits.',
        promptSnippet: 'Review all uncommitted changes with risk assessment',
        promptGuidelines: [
            'Use before committing to check for issues',
            'Provides risk assessment (low/medium/high) with reasons',
            'Suggests splitting large commits into smaller focused ones',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                repo_path: { type: 'string', description: 'Path to repo (default: workspace root)' },
            },
            required: [],
        },
        async execute(args: any) {
            try {
                const staged = await runGit(['diff', '--staged'], args?.repo_path);
                const unstaged = await runGit(['diff'], args?.repo_path);

                if (!staged && !unstaged) {
                    return { content: 'No uncommitted changes to review.' };
                }

                const sections: string[] = [];

                // Risk assessment on staged (what will be committed)
                if (staged) {
                    const risk = assessRisk(staged);
                    const splitSuggestions = suggestSplit(staged);
                    const statOutput = await runGit(['diff', '--staged', '--stat'], args?.repo_path);

                    sections.push(`## Staged Changes Review\n`);
                    sections.push(`### Risk Level: **${risk.level.toUpperCase()}**`);
                    if (risk.reasons.length > 0) {
                        sections.push(risk.reasons.map(r => `- ⚠️ ${r}`).join('\n'));
                    } else {
                        sections.push('- ✅ No risk indicators detected');
                    }

                    if (splitSuggestions.length > 0) {
                        sections.push(`\n### Split Suggestions`);
                        sections.push(splitSuggestions.map(s => `- 💡 ${s}`).join('\n'));
                    }

                    sections.push(`\n### Diff Summary\n\`\`\`\n${statOutput}\n\`\`\``);
                }

                if (unstaged) {
                    sections.push(`\n## Unstaged Changes\nThere are also unstaged changes not included in the review above. Run \`git_add\` to stage them.`);
                }

                return { content: sections.join('\n') };
            } catch (err: any) {
                return { content: `Error reviewing changes: ${err.message}`, isError: true };
            }
        },
    };
}

export function createDiffPromptTool(): Tool {
    return {
        name: 'diff_prompt',
        description: 'Generate a structured code review prompt for the current diff. Focuses on correctness, security, and performance. Returns a review template.',
        promptSnippet: 'Generate a code review prompt for the current diff',
        promptGuidelines: [
            'Use to get a structured review of staged or unstaged changes',
            'Returns a review template focusing on correctness, security, and performance',
            'The generated prompt can be fed to the LLM for detailed code review',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                scope: { type: 'string', description: 'Which changes to review: "staged", "unstaged", or "all" (default: "all")' },
                repo_path: { type: 'string', description: 'Path to repo (default: workspace root)' },
            },
            required: [],
        },
        async execute(args: any) {
            try {
                const scope = args?.scope || 'all';
                let diff = '';

                if (scope === 'staged') {
                    diff = await runGit(['diff', '--staged'], args?.repo_path);
                } else if (scope === 'unstaged') {
                    diff = await runGit(['diff'], args?.repo_path);
                } else {
                    const staged = await runGit(['diff', '--staged'], args?.repo_path);
                    const unstaged = await runGit(['diff'], args?.repo_path);
                    const parts = [];
                    if (staged) parts.push('## Staged\n' + staged);
                    if (unstaged) parts.push('## Unstaged\n' + unstaged);
                    diff = parts.join('\n\n');
                }

                if (!diff) {
                    return { content: 'No changes to generate a review prompt for.' };
                }

                const fileCount = (diff.match(/^diff --git/gm) || []).length;
                const risk = assessRisk(diff);

                const reviewPrompt = `## Code Review Request

### Changes Under Review
- **Scope**: ${scope}
- **Files changed**: ${fileCount}
- **Risk level**: ${risk.level}
${risk.reasons.length > 0 ? risk.reasons.map(r => `- Risk factor: ${r}`).join('\n') : '- No risk factors detected'}

### Review Checklist

**1. Correctness**
- Does the logic correctly implement the intended behavior?
- Are edge cases handled (null/undefined, empty arrays, boundary values)?
- Are error conditions handled gracefully?
- Is there any off-by-one or logic error?

**2. Security**
- Are there any injection vulnerabilities (SQL, XSS, command injection)?
- Are secrets or credentials properly handled (not hardcoded)?
- Is user input validated and sanitized?
- Are permissions/access controls correct?

**3. Performance**
- Are there any N+1 queries or unnecessary loops?
- Could any operation be batched or cached?
- Are there memory leaks (unclosed resources, growing arrays)?
- Is there any blocking I/O in a hot path?

**4. Code Quality**
- Does the code follow existing patterns and conventions?
- Are there any code smells (duplicated logic, overly complex functions)?
- Is naming clear and consistent?
- Are types properly defined (no unnecessary \`any\`)?

**5. Testing**
- Are new features covered by tests?
- Are edge cases tested?
- Do existing tests still pass with these changes?

### Diff Content
\`\`\`diff
${diff.length > 8000 ? diff.slice(0, 8000) + '\n... (truncated, diff too large)' : diff}
\`\`\`

Please review the above changes following the checklist. For each issue found, indicate the file, line, severity (critical/warning/info), and suggested fix.`;

                return { content: reviewPrompt };
            } catch (err: any) {
                return { content: `Error generating diff prompt: ${err.message}`, isError: true };
            }
        },
    };
}

export function createCommitTools(): Tool[] {
    return [
        createCommitGenerateTool(),
        createCommitReviewTool(),
        createDiffPromptTool(),
    ];
}
