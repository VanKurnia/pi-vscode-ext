import * as vscode from 'vscode';

export interface GuardResult {
    safe: boolean;
    reason?: string;
}

interface BlockedPattern {
    pattern: RegExp;
    reason: string;
}

const DEFAULT_BLOCKED_PATTERNS: BlockedPattern[] = [
    // Destructive filesystem operations
    { pattern: /\brm\s+(-[a-zA-Z]*[rfRF]{1,}[a-zA-Z]*\s+)?\/(\s|$)/, reason: 'Blocked: rm -rf / (root filesystem deletion)' },
    { pattern: /\brm\s+(-[a-zA-Z]*[rfRF]{1,}[a-zA-Z]*\s+)?\/\*/, reason: 'Blocked: rm -rf /* (root filesystem deletion)' },
    { pattern: /\bmkfs\b/, reason: 'Blocked: mkfs (filesystem formatting)' },
    { pattern: /\bdd\s+.*of=\/dev\//, reason: 'Blocked: dd writing to device' },
    { pattern: />\s*\/dev\/sd[a-z]/, reason: 'Blocked: writing to raw disk device' },

    // Privilege escalation
    { pattern: /\bsudo\b/, reason: 'Blocked: sudo not allowed' },
    { pattern: /\bsu\s+-?\s*root/, reason: 'Blocked: su to root not allowed' },
    { pattern: /\bchmod\s+.*\b777\b/, reason: 'Blocked: chmod 777 is overly permissive' },
    { pattern: /\bchown\s+.*root/, reason: 'Blocked: chown to root not allowed' },

    // Network exfiltration / reverse shells
    { pattern: /\bnc\s+.*-[elp]\b/, reason: 'Blocked: netcat listener (potential reverse shell)' },
    { pattern: /\bbash\s+-i\s+>&\s*\/dev\/tcp\//, reason: 'Blocked: bash reverse shell' },
    { pattern: /\bcurl\s+.*\|\s*(bash|sh|python|node)/, reason: 'Blocked: piping curl to interpreter' },
    { pattern: /\bwget\s+.*\|\s*(bash|sh|python|node)/, reason: 'Blocked: piping wget to interpreter' },

    // Fork bombs
    { pattern: /:\(\)\s*\{.*\|.*&\s*\};/, reason: 'Blocked: fork bomb detected' },
    { pattern: /\bfork\b.*\bbomb\b/i, reason: 'Blocked: fork bomb reference' },

    // System service manipulation
    { pattern: /\bsystemctl\s+(stop|disable|mask)\b/, reason: 'Blocked: system service manipulation' },
    { pattern: /\bservice\s+.*\b(stop|restart)\b/, reason: 'Blocked: service manipulation' },
    { pattern: /\bkill\s+-9\s+1\b/, reason: 'Blocked: killing init process' },
    { pattern: /\bpkill\s+.*-f\s+.*\binit\b/, reason: 'Blocked: killing init process' },

    // Dangerous environment manipulation
    { pattern: /\benv\s+-i\b/, reason: 'Blocked: clearing environment' },
    { pattern: /\bunset\s+PATH\b/, reason: 'Blocked: unsetting PATH' },

    // Container escape attempts
    { pattern: /\bdocker\s+run\s+.*--privileged/, reason: 'Blocked: privileged docker container' },
    { pattern: /\bnspawn\b/, reason: 'Blocked: container escape tool' },

    // Git force push to main/master
    { pattern: /\bgit\s+push\s+.*--force.*\b(main|master|production|release)\b/, reason: 'Blocked: force push to protected branch' },
];

export class BashGuard {
    private blockedPatterns: BlockedPattern[];

    constructor(customPatterns?: BlockedPattern[]) {
        this.blockedPatterns = customPatterns ?? DEFAULT_BLOCKED_PATTERNS;
    }

    /**
     * Check if a command is safe to execute.
     */
    check(command: string): GuardResult {
        const trimmed = command.trim();
        if (!trimmed) {
            return { safe: true };
        }

        // Split on command separators to check each sub-command
        const subCommands = this.splitCommands(trimmed);

        for (const sub of subCommands) {
            const result = this.checkSingleCommand(sub.trim());
            if (!result.safe) {
                return result;
            }
        }

        return { safe: true };
    }

    /**
     * Check multiple commands (e.g., from a script or multi-line input).
     */
    checkMultiple(commands: string[]): GuardResult {
        for (const cmd of commands) {
            const result = this.check(cmd);
            if (!result.safe) {
                return result;
            }
        }
        return { safe: true };
    }

    /**
     * Add a custom blocked pattern.
     */
    addBlockedPattern(pattern: RegExp, reason: string): void {
        this.blockedPatterns.push({ pattern, reason });
    }

    /**
     * Get all current blocked patterns (for UI display).
     */
    getBlockedPatterns(): Array<{ pattern: string; reason: string }> {
        return this.blockedPatterns.map(p => ({
            pattern: p.pattern.source,
            reason: p.reason,
        }));
    }

    private checkSingleCommand(command: string): GuardResult {
        for (const blocked of this.blockedPatterns) {
            if (blocked.pattern.test(command)) {
                return { safe: false, reason: blocked.reason };
            }
        }
        return { safe: true };
    }

    /**
     * Split a command string on common shell separators.
     * Handles: &&, ||, ;, |, and newlines
     */
    private splitCommands(command: string): string[] {
        // Simple split on common separators, respecting basic quoting
        const commands: string[] = [];
        let current = '';
        let inSingleQuote = false;
        let inDoubleQuote = false;
        let i = 0;

        while (i < command.length) {
            const ch = command[i];

            if (ch === "'" && !inDoubleQuote) {
                inSingleQuote = !inSingleQuote;
                current += ch;
                i++;
                continue;
            }

            if (ch === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                current += ch;
                i++;
                continue;
            }

            if (!inSingleQuote && !inDoubleQuote) {
                // Check for separators
                if (ch === '|' && command[i + 1] === '|') {
                    commands.push(current);
                    current = '';
                    i += 2;
                    continue;
                }
                if (ch === '&' && command[i + 1] === '&') {
                    commands.push(current);
                    current = '';
                    i += 2;
                    continue;
                }
                if (ch === ';') {
                    commands.push(current);
                    current = '';
                    i++;
                    continue;
                }
                if (ch === '|') {
                    commands.push(current);
                    current = '';
                    i++;
                    continue;
                }
                if (ch === '\n') {
                    commands.push(current);
                    current = '';
                    i++;
                    continue;
                }
            }

            current += ch;
            i++;
        }

        if (current.trim()) {
            commands.push(current);
        }

        return commands;
    }
}

/**
 * Singleton guard instance, configurable via VSCode settings.
 */
let _guardInstance: BashGuard | undefined;

export function getBashGuard(): BashGuard {
    if (!_guardInstance) {
        const config = vscode.workspace.getConfiguration('pi.bashGuard');
        const extraPatterns: BlockedPattern[] = [];

        const customPatterns = config.get<Array<{ pattern: string; reason: string }>>('customPatterns', []);
        for (const p of customPatterns) {
            extraPatterns.push({
                pattern: new RegExp(p.pattern, 'i'),
                reason: p.reason,
            });
        }

        _guardInstance = new BashGuard(
            extraPatterns.length > 0
                ? [...DEFAULT_BLOCKED_PATTERNS, ...extraPatterns]
                : undefined,
        );
    }
    return _guardInstance;
}

/**
 * Reset the singleton (useful for config changes or testing).
 */
export function resetBashGuard(): void {
    _guardInstance = undefined;
}
