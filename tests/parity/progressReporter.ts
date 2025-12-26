import fs from "node:fs";
import path from "node:path";
import type {
  FullConfig,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

function formatMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default class ProgressReporter implements Reporter {
  private total = 0;
  private done = 0;
  private startedAt = 0;
  private logFile: string | null = null;

  onBegin(config: FullConfig, suite: Suite) {
    this.startedAt = Date.now();
    this.total = suite.allTests().length;
    this.done = 0;
    const defaultLog = path.join(process.cwd(), "test-results", "parity-progress.log");
    this.logFile = process.env.PARITY_PROGRESS_FILE || defaultLog;
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      fs.writeFileSync(this.logFile, "");
    } catch {
      this.logFile = null;
    }
    // eslint-disable-next-line no-console
    console.log(`[parity] starting: ${this.total} tests, workers=${config.workers}`);
    this.appendLine(`[parity] starting: ${this.total} tests, workers=${config.workers}`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.done += 1;
    const pct = this.total ? Math.floor((this.done / this.total) * 100) : 0;
    const status = result.status.toUpperCase();
    const elapsed = Date.now() - this.startedAt;
    const avg = this.done ? elapsed / this.done : 0;
    const eta = this.total && avg ? Math.max(0, Math.round(avg * (this.total - this.done))) : 0;
    // eslint-disable-next-line no-console
    console.log(
      `[parity] ${this.done}/${this.total} (${pct}%) ${status} ${test.parent.project()?.name ?? ""} ${test.title} (${formatMs(
        result.duration,
      )}) ETA ${formatMs(eta)}`,
    );
    this.appendLine(
      `[parity] ${this.done}/${this.total} (${pct}%) ${status} ${test.parent.project()?.name ?? ""} ${test.title} (${formatMs(
        result.duration,
      )}) ETA ${formatMs(eta)}`,
    );
  }

  onEnd() {
    const elapsed = Date.now() - this.startedAt;
    // eslint-disable-next-line no-console
    console.log(`[parity] finished in ${formatMs(elapsed)}`);
    this.appendLine(`[parity] finished in ${formatMs(elapsed)}`);
  }

  private appendLine(line: string) {
    if (!this.logFile) return;
    try {
      fs.appendFileSync(this.logFile, `${line}\n`);
    } catch {
      this.logFile = null;
    }
  }
}
