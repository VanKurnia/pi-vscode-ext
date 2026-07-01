/**
 * VCC (Virtual Context Compaction) module for pi-vscode-ext.
 *
 * Provides deterministic structured conversation summaries that override
 * the default LLM-based compaction in AgentHarness.
 *
 * Pipeline: normalize → filterNoise → buildSections → formatSummary
 */
export { registerVccCompaction } from './vcc-hook.js';
export { compile } from './summarize.js';
export type { CompileInput } from './summarize.js';
export type { NormalizedBlock, SectionData, FileOps } from './types.js';
