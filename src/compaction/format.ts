/**
 * Summary formatting for the VCC compaction pipeline.
 *
 * Ported from pi-blackhole (src/core/format.ts).
 * Replaces wrapTextWithAnsi from @earendil-works/pi-tui with simple word-wrap.
 */
import type { SectionData } from './types.js';

const section = (title: string, items: string[]): string => {
  if (items.length === 0) return '';
  const body = items.map((i) => `- ${i}`).join('\n');
  return `[${title}]\n${body}`;
};

const BRIEF_MAX_LINES = 120;
const TUI_SAFE_LINE_CHARS = 120;

/**
 * Simple word-wrap that preserves list-item continuation indent.
 */
function wrapLineWithContinuation(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line];

  const indent = line.match(/^\s*(?:[-*]\s+|\d+\.\s+)?/)?.[0] ?? '';
  const continuationIndent = indent ? ' '.repeat(Math.min(indent.length, 8)) : '';
  const safeMaxChars = continuationIndent ? maxChars - continuationIndent.length : maxChars;

  const words = line.slice(indent.length).split(/(\s+)/);
  const result: string[] = [];
  let currentLine = indent;

  for (const word of words) {
    if (currentLine.length + word.length > safeMaxChars && currentLine.length > indent.length) {
      result.push(currentLine.trimEnd());
      currentLine = continuationIndent + word.trimStart();
    } else {
      currentLine += word;
    }
  }
  if (currentLine.trim()) result.push(currentLine.trimEnd());

  return result.length > 0 ? result : [line];
}

export const wrapLongLines = (text: string, maxChars = TUI_SAFE_LINE_CHARS): string =>
  text.split('\n').flatMap((line) => wrapLineWithContinuation(line, maxChars)).join('\n');

export const capBrief = (text: string): string => {
  const lines = text.split('\n');
  if (lines.length <= BRIEF_MAX_LINES) return text;
  const omitted = lines.length - BRIEF_MAX_LINES;
  const kept = lines.slice(-BRIEF_MAX_LINES);
  let firstHeader = kept.findIndex((l) => /^\[.+\]/.test(l));
  if (firstHeader < 0) {
    const anyAnchor = kept.findIndex((l) => /^\[[^\]]+\]/.test(l));
    if (anyAnchor > 0) firstHeader = anyAnchor;
  }
  const clean = firstHeader > 0 ? kept.slice(firstHeader) : kept;
  return `...(${omitted} earlier lines omitted)\n\n${clean.join('\n')}`;
};

export const RECALL_NOTE =
  'The conversation before this point has been compacted into the summary above. ' +
  'Details not captured here — exact code, error messages, file paths — are only recoverable via `recall`. ' +
  'Use `recall` to search the session history. Do not redo work already completed.';

export const formatSummary = (data: SectionData): string => {
  const headerParts = [
    section('Session Goal', data.sessionGoal),
    section('Files And Changes', data.filesAndChanges),
    section('Commits', data.commits),
    section('Outstanding Context', data.outstandingContext),
    section('User Preferences', data.userPreferences),
  ].filter(Boolean);

  const parts: string[] = [];
  if (headerParts.length > 0) {
    parts.push(headerParts.join('\n\n'));
  }
  if (data.briefTranscript) {
    parts.push(capBrief(data.briefTranscript));
  }

  if (parts.length === 0) return '';

  return wrapLongLines(parts.join('\n\n---\n\n'));
};
