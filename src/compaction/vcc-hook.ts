/**
 * VCC compaction hook for AgentHarness.
 *
 * Registers a `session_before_compact` handler that produces structured
 * VCC summaries instead of LLM-based freeform compaction.
 */
import type { AgentHarness } from '@earendil-works/pi-agent-core/node';
import { convertToLlm } from '@earendil-works/pi-agent-core';
import type { AgentMessage, SessionBeforeCompactEvent, SessionBeforeCompactResult } from '@earendil-works/pi-agent-core';
import { compile } from './summarize';

/**
 * Register the VCC compaction hook on an AgentHarness instance.
 *
 * This overrides the default LLM-based compaction with a deterministic
 * structured summary pipeline. Returns a disposer function.
 */
export function registerVccCompaction(harness: AgentHarness): () => void {
  return harness.on('session_before_compact', (event: SessionBeforeCompactEvent): SessionBeforeCompactResult => {
    const messages = event.preparation.messagesToSummarize;
    const previousSummary = event.preparation.previousSummary;

    // Build file ops from the preparation's FileOperations
    const fileOps = {
      readFiles: [...event.preparation.fileOps.read],
      modifiedFiles: [...event.preparation.fileOps.written, ...event.preparation.fileOps.edited],
    };

    // Convert AgentMessage[] to LLM-compatible Message[] for the VCC pipeline
    const llmMessages = convertToLlm(messages);

    const summary = compile({
      messages: llmMessages,
      previousSummary,
      fileOps,
    });

    return {
      compaction: {
        summary,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      },
    };
  });
}
