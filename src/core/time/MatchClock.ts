export class MatchClock {
  private elapsedMs = 0;
  private running = false;
  private overtimePending = false;
  private overtimeConsumed = false;

  setRunning(running: boolean): void { this.running = running; }

  advance(deltaMs: number): void {
    if (!this.running || this.overtimeConsumed) return;
    this.elapsedMs += Math.max(0, deltaMs);
    if (this.elapsedMs >= 600_000) this.overtimePending = true;
  }

  get elapsed(): number { return this.elapsedMs; }
  get hasOvertimePending(): boolean { return this.overtimePending && !this.overtimeConsumed; }
  consumeOvertime(): void {
    if (this.hasOvertimePending) {
      this.overtimePending = false;
      this.overtimeConsumed = true;
    }
  }
  get overtimeUsed(): boolean { return this.overtimeConsumed; }
  reset(): void {
    this.elapsedMs = 0;
    this.running = false;
    this.overtimePending = false;
    this.overtimeConsumed = false;
  }
}
