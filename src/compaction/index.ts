/**
 * VCC (Virtual Context Compaction) module for pi-vscode-ext.
 *
 * Provides deterministic structured conversation summaries that override
 * the default LLM-based compaction in AgentHarness.
 *
 * Pipeline: normalize → filterNoise → buildSections → formatSummary
 */
export { registerVccCompaction } from './vcc-hook';
export { compile } from './summarize';
export type { CompileInput } from './summarize';
export type { NormalizedBlock, SectionData, FileOps } from './types';
