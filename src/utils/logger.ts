import * as vscode from 'vscode';

export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Pi Agent');
    }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    debug(message: string): void {
        this.log('DEBUG', message);
    }

    info(message: string): void {
        this.log('INFO', message);
    }

    warn(message: string): void {
        this.log('WARN', message);
    }

    error(message: string, error?: Error): void {
        this.log('ERROR', message);
        if (error?.stack) {
            this.log('ERROR', error.stack);
        }
    }

    private log(level: string, message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);
    }

    show(): void {
        this.outputChannel.show();
    }

    getChannel(): vscode.OutputChannel {
        return this.outputChannel;
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}
