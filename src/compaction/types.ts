/**
 * Internal types for the VCC compaction pipeline.
 *
 * Ported from pi-blackhole with clean TypeScript.
 */

/** Normalized block extracted from conversation messages. */
export type NormalizedBlock =
  | { kind: 'user'; text: string; sourceIndex?: number }
  | { kind: 'assistant'; text: string; sourceIndex?: number }
  | { kind: 'tool_call'; name: string; args: Record<string, unknown>; sourceIndex?: number }
  | { kind: 'tool_result'; name: string; text: string; isError: boolean; sourceIndex?: number }
  | { kind: 'bash'; command: string; output: string; exitCode: number | undefined; sourceIndex?: number }
  | { kind: 'thinking'; text: string; redacted: boolean; sourceIndex?: number };

/** Structured section data extracted from blocks. */
export interface SectionData {
  sessionGoal: string[];
  outstandingContext: string[];
  filesAndChanges: string[];
  commits: string[];
  userPreferences: string[];
  briefTranscript: string;
}

/** File operation context passed from the harness. */
export interface FileOps {
  readFiles?: string[];
  modifiedFiles?: string[];
  createdFiles?: string[];
}
