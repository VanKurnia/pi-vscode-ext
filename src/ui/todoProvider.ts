import * as vscode from 'vscode';

// ── Types ───────────────────────────────────────────────────────────

export type TaskState = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoTask {
    id: number;
    label: string;
    state: TaskState;
    detail?: string;
}

const STATE_ICONS: Record<TaskState, string> = {
    pending: '⏳',
    in_progress: '🔄',
    completed: '✅',
    cancelled: '❌',
};

const STATE_LABELS: Record<TaskState, string> = {
    pending: 'Pending',
    in_progress: 'In Progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
};

// ── TreeItem ────────────────────────────────────────────────────────

export class TodoTreeItem extends vscode.TreeItem {
    constructor(public readonly task: TodoTask) {
        super(task.label, vscode.TreeItemCollapsibleState.None);
        this.description = STATE_LABELS[task.state];
        this.tooltip = `${STATE_ICONS[task.state]} ${task.label} (${STATE_LABELS[task.state]})${task.detail ? '\n' + task.detail : ''}`;
        this.contextValue = 'todoItem';

        // Icon based on state
        const iconMap: Record<TaskState, string> = {
            pending: 'clock',
            in_progress: 'sync~spin',
            completed: 'pass',
            cancelled: 'close',
        };
        const colorMap: Record<TaskState, string> = {
            pending: 'charts.gray',
            in_progress: 'charts.yellow',
            completed: 'testing.iconPassed',
            cancelled: 'testing.iconFailed',
        };
        this.iconPath = new vscode.ThemeIcon(
            iconMap[task.state],
            new vscode.ThemeColor(colorMap[task.state])
        );
    }
}

// ── TreeDataProvider ────────────────────────────────────────────────

export class TodoTreeProvider implements vscode.TreeDataProvider<TodoTreeItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<TodoTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private tasks: TodoTask[] = [];
    private nextId = 1;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TodoTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TodoTreeItem): Thenable<TodoTreeItem[]> {
        if (element) { return Promise.resolve([]); }

        if (this.tasks.length === 0) {
            const empty = new TodoTreeItem({ id: 0, label: 'No tasks', state: 'pending' });
            empty.description = 'Run @pi plan to create tasks';
            empty.iconPath = new vscode.ThemeIcon('info');
            empty.contextValue = 'todoEmpty';
            return Promise.resolve([empty]);
        }

        // Sort: in_progress first, then pending, then completed/cancelled
        const stateOrder: Record<TaskState, number> = {
            in_progress: 0,
            pending: 1,
            completed: 2,
            cancelled: 3,
        };
        const sorted = [...this.tasks].sort((a, b) => {
            const so = stateOrder[a.state] - stateOrder[b.state];
            if (so !== 0) { return so; }
            return a.id - b.id;
        });

        return Promise.resolve(sorted.map(t => new TodoTreeItem(t)));
    }

    // ── Task management methods ─────────────────────────────────

    /** Add a new task and return its id */
    addTask(label: string, detail?: string): number {
        const id = this.nextId++;
        this.tasks.push({ id, label, state: 'pending', detail });
        this.refresh();
        return id;
    }

    /** Update a task by id or index */
    updateTask(idOrIndex: number, updates: Partial<Pick<TodoTask, 'label' | 'state' | 'detail'>>): boolean {
        const task = this.findTask(idOrIndex);
        if (!task) { return false; }
        if (updates.label !== undefined) { task.label = updates.label; }
        if (updates.state !== undefined) { task.state = updates.state; }
        if (updates.detail !== undefined) { task.detail = updates.detail; }
        this.refresh();
        return true;
    }

    /** Remove a task by id */
    removeTask(id: number): boolean {
        const idx = this.tasks.findIndex(t => t.id === id);
        if (idx < 0) { return false; }
        this.tasks.splice(idx, 1);
        this.refresh();
        return true;
    }

    /** Clear all tasks */
    clearAll(): void {
        this.tasks = [];
        this.nextId = 1;
        this.refresh();
    }

    /** Replace the entire task list */
    setTasks(tasks: { label: string; state?: TaskState; detail?: string }[]): void {
        this.tasks = [];
        this.nextId = 1;
        for (const t of tasks) {
            this.tasks.push({
                id: this.nextId++,
                label: t.label,
                state: t.state || 'pending',
                detail: t.detail,
            });
        }
        this.refresh();
    }

    /** Get progress summary */
    getProgress(): { total: number; completed: number; inProgress: number; pending: number; cancelled: number; percentage: number } {
        const total = this.tasks.length;
        const completed = this.tasks.filter(t => t.state === 'completed').length;
        const inProgress = this.tasks.filter(t => t.state === 'in_progress').length;
        const pending = this.tasks.filter(t => t.state === 'pending').length;
        const cancelled = this.tasks.filter(t => t.state === 'cancelled').length;
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { total, completed, inProgress, pending, cancelled, percentage };
    }

    /** Get all tasks */
    getTasks(): TodoTask[] {
        return [...this.tasks];
    }

    /** Mark a task as done by step number (e.g., DONE:2 marks task #2 as completed) */
    markDone(stepNumber: number): boolean {
        // Step numbers are 1-indexed, tasks are in order
        if (stepNumber < 1 || stepNumber > this.tasks.length) { return false; }
        const task = this.tasks[stepNumber - 1];
        if (!task) { return false; }
        task.state = 'completed';
        this.refresh();
        return true;
    }

    /** Process a plan mode [DONE:n] marker */
    processPlanMarker(text: string): void {
        const regex = /\[DONE:(\d+)\]/g;
        let match: RegExpExecArray | null;
        // eslint-disable-next-line no-cond-assign
        while ((match = regex.exec(text)) !== null) {
            const step = parseInt(match[1], 10);
            this.markDone(step);
        }
    }

    private findTask(idOrIndex: number): TodoTask | undefined {
        // Try by id first
        let task = this.tasks.find(t => t.id === idOrIndex);
        if (task) { return task; }
        // Try by 1-indexed position
        if (idOrIndex >= 1 && idOrIndex <= this.tasks.length) {
            return this.tasks[idOrIndex - 1];
        }
        return undefined;
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}
