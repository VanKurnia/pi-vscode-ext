/**
 * UI Bridge — maps agent UI requests to VSCode dialogs.
 *
 * Provides a clean interface for the agent to interact with the user
 * through VSCode's native UI components:
 * - QuickPick (selection)
 * - InputBox (text input)
 * - Information/Warning/Error messages (confirmation)
 * - Progress indicators
 *
 * Usage:
 *   const ui = createUIBridge();
 *   const choice = await ui.select('Pick one', ['Option A', 'Option B']);
 *   const confirmed = await ui.confirm('Are you sure?');
 */

import * as vscode from 'vscode';

export interface UIBridge {
    /** Show a quick pick selection dialog */
    select(title: string, options: string[]): Promise<string | undefined>;
    /** Show an input box for text entry */
    input(title: string, placeholder?: string, defaultValue?: string): Promise<string | undefined>;
    /** Show a confirmation dialog (Yes/No) */
    confirm(message: string): Promise<boolean>;
    /** Show an information notification */
    info(message: string): void;
    /** Show a warning notification */
    warn(message: string): void;
    /** Show an error notification */
    error(message: string): void;
    /** Run an async task with progress indicator */
    withProgress<T>(title: string, task: () => Promise<T>): Promise<T>;
}

export function createUIBridge(): UIBridge {
    return {
        async select(title: string, options: string[]): Promise<string | undefined> {
            return await vscode.window.showQuickPick(options, {
                placeHolder: title,
            });
        },

        async input(title: string, placeholder?: string, defaultValue?: string): Promise<string | undefined> {
            return await vscode.window.showInputBox({
                prompt: title,
                placeHolder: placeholder,
                value: defaultValue,
            });
        },

        async confirm(message: string): Promise<boolean> {
            const result = await vscode.window.showInformationMessage(
                message,
                { modal: true },
                'Yes',
                'No'
            );
            return result === 'Yes';
        },

        info(message: string): void {
            vscode.window.showInformationMessage(message);
        },

        warn(message: string): void {
            vscode.window.showWarningMessage(message);
        },

        error(message: string): void {
            vscode.window.showErrorMessage(message);
        },

        async withProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
            return await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `π ${title}`,
                },
                async () => await task()
            );
        },
    };
}
