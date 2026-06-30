import * as diff from 'diff';

export interface FileDiff {
    filePath: string;
    hunks: DiffHunk[];
    added: number;
    removed: number;
    patch: string;
}

export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    content: string;
}

export function computeDiff(oldContent: string, newContent: string, filePath: string): FileDiff {
    const patch = diff.createTwoFilesPatch(
        `a/${filePath}`,
        `b/${filePath}`,
        oldContent,
        newContent,
        '',
        '',
        { context: 3 }
    );

    const changes = diff.diffLines(oldContent, newContent);
    let added = 0;
    let removed = 0;

    for (const change of changes) {
        if (change.added) {
            added += change.count ?? 0;
        } else if (change.removed) {
            removed += change.count ?? 0;
        }
    }

    return {
        filePath,
        hunks: parseHunks(patch),
        added,
        removed,
        patch,
    };
}

function parseHunks(patch: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const lines = patch.split('\n');
    let currentHunk: DiffHunk | null = null;

    for (const line of lines) {
        const hunkHeader = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (hunkHeader) {
            if (currentHunk) {
                hunks.push(currentHunk);
            }
            currentHunk = {
                oldStart: parseInt(hunkHeader[1]),
                oldLines: parseInt(hunkHeader[2] || '1'),
                newStart: parseInt(hunkHeader[3]),
                newLines: parseInt(hunkHeader[4] || '1'),
                content: '',
            };
        } else if (currentHunk) {
            currentHunk.content += line + '\n';
        }
    }

    if (currentHunk) {
        hunks.push(currentHunk);
    }

    return hunks;
}

export function formatDiffSummary(diffs: FileDiff[]): string {
    if (diffs.length === 0) {
        return 'No changes detected.';
    }

    const lines: string[] = ['## Changes Summary\n'];
    let totalAdded = 0;
    let totalRemoved = 0;

    for (const d of diffs) {
        totalAdded += d.added;
        totalRemoved += d.removed;
        lines.push(`- \`${d.filePath}\` +${d.added}/-${d.removed}`);
    }

    lines.unshift(`**+${totalAdded}/-${totalRemoved}** across ${diffs.length} file(s)\n`);
    return lines.join('\n');
}
