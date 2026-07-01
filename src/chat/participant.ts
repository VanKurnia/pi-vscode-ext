/**
 * Chat Participant — native VS Code Chat integration via @pi.
 * Wires VCC compaction and speed tracking.
 */

import * as vscode from 'vscode';
import type { PiBridgeContext } from '../bridge/types';
import { streamFromHarness } from '../bridge/stream-bridge';
import { handleSlashCommand, helpMarkdown } from './commands';
import { PlanModeManager } from './planMode';
import { SpeedTracker } from '../tools/speedMeter';
import { registerVccCompaction } from '../compaction';
import { Logger } from '../utils/logger';

const logger = Logger.getInstance();

export function registerChatParticipant(
    bridge: PiBridgeContext,
    extensionUri: vscode.Uri
): vscode.ChatParticipant {
    const planMode = new PlanModeManager();
    const speedTracker = new SpeedTracker();

    // Wire VCC compaction hook into AgentHarness
    registerVccCompaction(bridge.harness);
    logger.info('[chat] VCC compaction hook registered');

    // Wire speed tracking into harness events
    bridge.harness.on('before_provider_request', () => {
        speedTracker.start(); return undefined;
    });
    bridge.harness.on('after_provider_response', () => {
        speedTracker.stop();
        logger.info(`[speed] ${speedTracker.getLastReport()?.display || 'n/a'}`); return undefined;
    });

    const chatParticipant = vscode.chat.createChatParticipant(
        'pi-agent.chat',
        async (
            request: vscode.ChatRequest,
            _chatContext: vscode.ChatContext,
            stream: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ): Promise<vscode.ChatResult> => {
            const prompt = request.prompt;

            // Slash commands
            if (request.command) {
                return await handleSlashCommand(request.command, prompt, stream, bridge.harness, planMode, speedTracker);
            }

            // Empty message
            if (!prompt.trim()) {
                stream.markdown('Type a message or use a command:\n\n');
                stream.markdown(helpMarkdown());
                return {};
            }

            // If plan mode is active, inject plan context
            let fullPrompt = prompt;
            if (planMode.isActive()) {
                const modifier = planMode.getSystemPromptModifier();
                if (modifier) {
                    fullPrompt = `${modifier}\n\nUser message: ${prompt}`;
                }
            }

            // Regular message → AgentHarness
            logger.info(`[chat] User message: ${prompt.slice(0, 100)}`);
            try {
                await streamFromHarness(bridge.harness, fullPrompt, stream, token);
            } catch (err: any) {
                logger.error(`[chat] Error: ${err.message}`);
            }

            return {};
        }
    );

    chatParticipant.iconPath = vscode.Uri.joinPath(extensionUri, 'images', 'icon.svg');

    chatParticipant.followupProvider = {
        provideFollowups(): vscode.ChatFollowup[] {
            return [
                { prompt: '/fix', label: '🔧 Fix issues', command: 'fix' },
                { prompt: '/refactor', label: '♻️ Refactor', command: 'refactor' },
                { prompt: '/test', label: '🧪 Generate tests', command: 'test' },
                { prompt: '/review', label: '👁️ Review code', command: 'review' },
            ];
        },
    };

    logger.info('[chat] ChatParticipant registered: @pi');
    return chatParticipant;
}
