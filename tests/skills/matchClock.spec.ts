import { describe, expect, it } from 'vitest';
import { MatchClock } from '../../src/core/time/MatchClock';

describe('MatchClock effective play time', () => {
  it('does not advance while paused for menus, drafts or hidden pages', () => {
    const clock = new MatchClock();
    clock.advance(100_000);
    expect(clock.elapsed).toBe(0);
    clock.setRunning(true);
    clock.advance(1_000);
    clock.setRunning(false);
    clock.advance(500_000);
    expect(clock.elapsed).toBe(1_000);
    clock.setRunning(true);
    clock.advance(2_000);
    expect(clock.elapsed).toBe(3_000);
  });

  it('raises overtime once at ten minutes and never rearms after consumption', () => {
    const clock = new MatchClock();
    clock.setRunning(true);
    clock.advance(599_999);
    expect(clock.hasOvertimePending).toBe(false);
    clock.advance(1);
    expect(clock.hasOvertimePending).toBe(true);
    expect(clock.overtimeUsed).toBe(false);
    clock.advance(50_000);
    expect(clock.hasOvertimePending).toBe(true);
    clock.consumeOvertime();
    expect(clock.hasOvertimePending).toBe(false);
    expect(clock.overtimeUsed).toBe(true);
    const elapsed = clock.elapsed;
    clock.advance(600_000);
    expect(clock.elapsed).toBe(elapsed);
    expect(clock.hasOvertimePending).toBe(false);
  });

  it('clamps invalid negative deltas and resets all state', () => {
    const clock = new MatchClock();
    clock.setRunning(true);
    clock.advance(-100);
    expect(clock.elapsed).toBe(0);
    clock.advance(600_000);
    clock.consumeOvertime();
    clock.reset();
    expect(clock.elapsed).toBe(0);
    expect(clock.hasOvertimePending).toBe(false);
    expect(clock.overtimeUsed).toBe(false);
  });
});
