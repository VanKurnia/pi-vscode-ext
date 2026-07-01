/**
 * Plan Mode — tracks multi-step plan state and enforces read-only during planning.
 */

export type PlanState = 'inactive' | 'planning' | 'executing';

interface PlanStep {
    number: number;
    description: string;
    done: boolean;
}

export interface PlanProgress {
    total: number;
    completed: number;
    percentage: number;
}

/**
 * Manages plan mode: tracks steps, progress, and provides
 * a system-prompt modifier so the LLM knows the current plan context.
 */
export class PlanModeManager {
    private state: PlanState = 'inactive';
    private steps: PlanStep[] = [];

    // ── Public API ───────────────────────────────

    /** Enter planning mode. Returns a prompt instruction for the LLM. */
    startPlan(): string {
        this.state = 'planning';
        this.steps = [];
        return (
            'Plan mode activated. You are now in PLANNING phase.\n' +
            'Generate a numbered list of steps the user should approve before execution.\n' +
            'While in planning mode, file-editing and file-writing tools are DISABLED (read-only).\n' +
            'When the plan is ready, call execute_plan to switch to execution mode.'
        );
    }

    /** Add a step to the plan (called during planning phase). */
    addStep(description: string): number {
        const num = this.steps.length + 1;
        this.steps.push({ number: num, description, done: false });
        return num;
    }

    /** Parse steps from an LLM response that contains a numbered list. */
    parseSteps(text: string): number[] {
        const regex = /^\s*(\d+)\.\s+(.+)$/gm;
        const added: number[] = [];
        let match: RegExpExecArray | null;
        // Clear existing steps and re-parse
        this.steps = [];
        while ((match = regex.exec(text)) !== null) {
            const num = parseInt(match[1], 10);
            this.steps.push({ number: num, description: match[2].trim(), done: false });
            added.push(num);
        }
        return added;
    }

    /** Mark a specific step as done by its number. */
    markStepDone(stepNum: number): boolean {
        const step = this.steps.find((s) => s.number === stepNum);
        if (!step) return false;
        step.done = true;
        return true;
    }

    /** Get current progress. */
    getProgress(): PlanProgress {
        const total = this.steps.length;
        const completed = this.steps.filter((s) => s.done).length;
        return {
            total,
            completed,
            percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
        };
    }

    /** Switch from planning → execution mode. Returns false if no steps exist. */
    executePlan(): boolean {
        if (this.steps.length === 0) return false;
        this.state = 'executing';
        return true;
    }

    /** Reset everything back to inactive. */
    reset(): void {
        this.state = 'inactive';
        this.steps = [];
    }

    // ── Query ────────────────────────────────────

    getState(): PlanState {
        return this.state;
    }

    isActive(): boolean {
        return this.state !== 'inactive';
    }

    isPlanning(): boolean {
        return this.state === 'planning';
    }

    isExecuting(): boolean {
        return this.state === 'executing';
    }

    getSteps(): ReadonlyArray<PlanStep> {
        return this.steps;
    }

    /**
     * Returns true if a given tool name should be blocked in the current state.
     * During planning, write/edit tools are read-only.
     */
    isToolBlocked(toolName: string): boolean {
        if (this.state !== 'planning') return false;
        const blocked = new Set([
            'write_file',
            'edit_file',
            'replace_in_file',
            'bash',
            'git_add',
            'git_commit',
            'git_reset',
        ]);
        return blocked.has(toolName);
    }

    // ── System prompt modifier ───────────────────

    /**
     * Returns extra system-prompt text describing the current plan context.
     * Inject this into the system message when plan mode is active.
     */
    getSystemPromptModifier(): string | null {
        if (this.state === 'inactive') return null;

        const lines: string[] = [];
        lines.push(`## Plan Mode: ${this.state.toUpperCase()}`);
        lines.push('');

        if (this.steps.length > 0) {
            lines.push('**Plan steps:**');
            for (const s of this.steps) {
                const mark = s.done ? '✅' : '⬜';
                lines.push(`${mark} ${s.number}. ${s.description}`);
            }
            const progress = this.getProgress();
            lines.push('');
            lines.push(`Progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`);
        } else {
            lines.push('No plan steps defined yet. Generate a numbered plan for the user.');
        }

        if (this.state === 'planning') {
            lines.push('');
            lines.push(
                '⚠️ READ-ONLY mode active. File editing and writing tools are disabled. ' +
                'Use only read/search tools until the plan is approved.'
            );
        }

        return lines.join('\n');
    }
}
