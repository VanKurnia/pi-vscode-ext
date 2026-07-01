// Commands are now registered directly in extension.ts
// This file is kept for backward compatibility
import * as vscode from 'vscode';
import { PiAgentManager } from '../agent/manager';
import { Logger } from '../utils/logger';

export function registerCommands(context: vscode.ExtensionContext, manager: PiAgentManager, _logger: Logger): void {
    // All commands are registered in extension.ts
    // This is a no-op for backward compatibility
    context.subscriptions.push(
        vscode.commands.registerCommand('pi-agent.showChanges', () => {
            vscode.window.showInformationMessage('Changes tracked in sidebar');
        })
    );
}
