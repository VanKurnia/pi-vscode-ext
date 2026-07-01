/**
 * Speed meter — tracks tokens/sec during streaming.
 */
export interface SpeedReport {
    tokensPerSec: number;
    totalTokens: number;
    elapsedMs: number;
    display: string;
}

export class SpeedTracker {
    private startTime = 0;
    private tokenCount = 0;
    private lastReport: SpeedReport | null = null;

    start(): void {
        this.startTime = Date.now();
        this.tokenCount = 0;
    }

    update(tokens: number): void {
        this.tokenCount += tokens;
    }

    stop(): SpeedReport {
        const elapsedMs = Date.now() - this.startTime;
        const tokensPerSec = elapsedMs > 0 ? (this.tokenCount / (elapsedMs / 1000)) : 0;
        const report: SpeedReport = {
            tokensPerSec: Math.round(tokensPerSec * 10) / 10,
            totalTokens: this.tokenCount,
            elapsedMs,
            display: formatSpeed(tokensPerSec, this.tokenCount, elapsedMs),
        };
        this.lastReport = report;
        return report;
    }

    getLastReport(): SpeedReport | null {
        return this.lastReport;
    }
}

function formatSpeed(tps: number, tokens: number, ms: number): string {
    const sec = (ms / 1000).toFixed(1);
    const tpsStr = tps >= 100 ? Math.round(tps).toString() : tps.toFixed(1);
    const tokStr = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens.toString();
    return `${tpsStr} tok/s | ${tokStr} tokens | ${sec}s`;
}
