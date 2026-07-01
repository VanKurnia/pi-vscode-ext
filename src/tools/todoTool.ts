import { Tool } from '../agent/tools.js';
import { TodoTreeProvider } from '../ui/todoProvider.js';

export function createTodoTool(provider: TodoTreeProvider): Tool {
    return {
        name: 'todo_update',
        description: 'Create, update, or query the agent task/progress tracking list. Manage tasks shown in the sidebar. Supports adding tasks, updating their state (pending/in_progress/completed/cancelled), and getting progress.',
        promptSnippet: 'Manage the task progress tracker',
        promptGuidelines: [
            'Use action "set_tasks" to initialize a task list from a plan',
            'Use action "update" to change a task\'s state (e.g., mark in_progress or completed)',
            'Use action "progress" to get current completion status',
            'Use action "add" to append a new task',
            'Use action "clear" to remove all tasks',
        ],
        parameters: {
            type: 'object' as const,
            properties: {
                action: {
                    type: 'string',
                    enum: ['add', 'update', 'remove', 'set_tasks', 'progress', 'clear'],
                    description: 'Action: add (new task), update (change task state), remove (delete task), set_tasks (replace all tasks), progress (get summary), clear (clear all)'
                },
                label: { type: 'string', description: 'Task label (for add/update)' },
                id: { type: 'number', description: 'Task id or 1-indexed position (for update/remove)' },
                state: {
                    type: 'string',
                    enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                    description: 'New state for a task (for update)'
                },
                detail: { type: 'string', description: 'Optional detail/note for a task' },
                tasks: {
                    type: 'array',
                    description: 'Array of task objects for set_tasks: [{label, state?, detail?}]',
                    items: {
                        type: 'object',
                        properties: {
                            label: { type: 'string' },
                            state: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
                            detail: { type: 'string' },
                        },
                    },
                },
            },
            required: ['action'],
        },
        async execute(args: any) {
            try {
                const action = args.action;

                switch (action) {
                    case 'add': {
                        if (!args.label) { return { content: 'Missing required field: label', isError: true }; }
                        const id = provider.addTask(args.label, args.detail);
                        return { content: `Added task #${id}: "${args.label}"` };
                    }

                    case 'update': {
                        if (args.id === undefined) { return { content: 'Missing required field: id', isError: true }; }
                        const updates: any = {};
                        if (args.label) { updates.label = args.label; }
                        if (args.state) { updates.state = args.state; }
                        if (args.detail) { updates.detail = args.detail; }
                        const ok = provider.updateTask(args.id, updates);
                        if (!ok) { return { content: `Task #${args.id} not found`, isError: true }; }
                        return { content: `Updated task #${args.id}` };
                    }

                    case 'remove': {
                        if (args.id === undefined) { return { content: 'Missing required field: id', isError: true }; }
                        const ok = provider.removeTask(args.id);
                        if (!ok) { return { content: `Task #${args.id} not found`, isError: true }; }
                        return { content: `Removed task #${args.id}` };
                    }

                    case 'set_tasks': {
                        if (!Array.isArray(args.tasks)) { return { content: 'Missing required field: tasks (array)', isError: true }; }
                        provider.setTasks(args.tasks);
                        const progress = provider.getProgress();
                        return { content: `Set ${progress.total} tasks. Progress: ${progress.completed}/${progress.total} (${progress.percentage}%)` };
                    }

                    case 'progress': {
                        const p = provider.getProgress();
                        const tasks = provider.getTasks();
                        const lines = [
                            `## Task Progress: ${p.completed}/${p.total} complete (${p.percentage}%)`,
                            '',
                            `✅ Completed: ${p.completed} | 🔄 In Progress: ${p.inProgress} | ⏳ Pending: ${p.pending} | ❌ Cancelled: ${p.cancelled}`,
                            '',
                        ];
                        for (const t of tasks) {
                            const icons: Record<string, string> = { pending: '⏳', in_progress: '🔄', completed: '✅', cancelled: '❌' };
                            lines.push(`${icons[t.state]} #${t.id}: ${t.label}${t.detail ? ' — ' + t.detail : ''}`);
                        }
                        return { content: lines.join('\n') };
                    }

                    case 'clear': {
                        provider.clearAll();
                        return { content: 'All tasks cleared.' };
                    }

                    default:
                        return { content: `Unknown action: ${action}. Use: add, update, remove, set_tasks, progress, clear`, isError: true };
                }
            } catch (err: any) {
                return { content: `Todo tool error: ${err.message}`, isError: true };
            }
        },
    };
}
