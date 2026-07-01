import * as vscode from "vscode";
/**
 * Session Bridge — manages pi-agent-core sessions with JSONL persistence.
 *
 * Maps VSCode workspace folders to pi session directories. Uses pi's
 * JsonlSessionRepo for tree-based session support (fork, branch, navigate).
 *
 * Session storage: ~/.pi/agent/sessions/<workspace-hash>/
 */

import * as path from 'path';
import * as os from 'os';
import {
    NodeExecutionEnv,
    JsonlSessionRepo,
    type Session,
    type JsonlSessionMetadata,
} from '@earendil-works/pi-agent-core/node';
import { Logger } from '../utils/logger.js';

const logger = Logger.getInstance();

/** Default session storage root — matches pi's convention. */
const DEFAULT_SESSION_ROOT = path.join(os.homedir(), '.pi', 'agent', 'sessions');

/**
 * Create a JsonlSessionRepo for the given workspace.
 *
 * The repo stores sessions under ~/.pi/agent/sessions/, organized by
 * working directory, matching pi's native session layout.
 *
 * @param env - NodeExecutionEnv instance (shared with AgentHarness)
 */
export function createSessionRepo(env: NodeExecutionEnv): JsonlSessionRepo {
    return new JsonlSessionRepo({
        fs: env,
        sessionsRoot: DEFAULT_SESSION_ROOT,
    });
}

/**
 * Create a new session for the given workspace.
 */
export async function createSession(
    repo: JsonlSessionRepo,
    cwd: string
): Promise<Session<JsonlSessionMetadata>> {
    logger.info(`[session-bridge] Creating new session for ${cwd}`);
    return repo.create({ cwd });
}

/**
 * Open the most recent session for the given workspace, or create a new one.
 *
 * This matches pi's default behavior: `pi -c` continues the most recent session.
 */
export async function openOrCreateSession(
    repo: JsonlSessionRepo,
    cwd: string
): Promise<Session<JsonlSessionMetadata>> {
    const sessions = await repo.list({ cwd });

    if (sessions.length > 0) {
        // Sort by creation time, open the most recent
        const sorted = sessions.sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        logger.info(`[session-bridge] Resuming session ${sorted[0].id} for ${cwd}`);
        return repo.open(sorted[0]);
    }

    // No existing session — create a new one
    logger.info(`[session-bridge] No existing session found, creating new one for ${cwd}`);
    return createSession(repo, cwd);
}

/**
 * Fork the current session at a specific entry point.
 *
 * Creates a new session branching from the given entry, matching pi's
 * `/fork` command behavior.
 */
export async function forkSession(
    repo: JsonlSessionRepo,
    source: JsonlSessionMetadata,
    entryId?: string
): Promise<Session<JsonlSessionMetadata>> {
    logger.info(`[session-bridge] Forking session ${source.id} at entry ${entryId ?? 'end'}`);
    return repo.fork(source, { cwd: source.cwd, entryId });
}

/**
 * List all sessions for a workspace.
 */
export async function listSessions(
    repo: JsonlSessionRepo,
    cwd: string
): Promise<JsonlSessionMetadata[]> {
    return repo.list({ cwd });
}

/**
 * Delete a session.
 */
export async function deleteSession(
    repo: JsonlSessionRepo,
    metadata: JsonlSessionMetadata
): Promise<void> {
    logger.info(`[session-bridge] Deleting session ${metadata.id}`);
    return repo.delete(metadata);
}

/**
 * Get the workspace folder path for session management.
 * Returns the first workspace folder's path, or home directory as fallback.
 */
export function getWorkspaceCwd(): string {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            return workspaceFolder.uri.fsPath;
        }
    } catch {
        // Not in VSCode context
    }
    return os.homedir();
}
