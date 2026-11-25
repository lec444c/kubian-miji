import { describe, expect, it } from 'vitest';
import { FakeFreeBallMachine } from '../../src/skills/fakeFreeBall';

 describe('fake free ball state machine', () => {
  it('accepts a moving opponent shot at 9.999 seconds and awards the user a true free ball once', () => {
    const machine = new FakeFreeBallMachine(0);
    expect(machine.advance(9999)).toBeNull();
    expect(machine.opponentShot(false)).toEqual({ accepted: false, reason: 'no-movement' });

    const result = machine.opponentShot(true);
    expect(result.accepted).toBe(true);
    expect(machine.status).toBe('specialFoul');
    expect(machine.outcome).toMatchObject({
      kind: 'specialFoul',
      freeBallFor: 0,
      trueFreeBall: true,
      elapsedMs: 9999,
    });
    const firstOutcome = machine.outcome;
    expect(machine.opponentPlaced()).toMatchObject({ accepted: false, reason: 'already-resolved' });
    expect(machine.advance(1000)).toBeNull();
    expect(machine.outcome).toBe(firstOutcome);
  });

  it('treats active opponent placement as a special foul', () => {
    const machine = new FakeFreeBallMachine(1);
    const result = machine.opponentPlaced();
    expect(result).toMatchObject({ accepted: true });
    expect(machine.outcome).toMatchObject({ kind: 'specialFoul', freeBallFor: 1, trueFreeBall: true });
  });

  it('times out first at 10.000 seconds, awards the opponent, and rejects late or repeated operations', () => {
    const machine = new FakeFreeBallMachine(0);
    expect(machine.advanceTo(9999)).toBeNull();
    const timeout = machine.advance(1);
    expect(timeout).toMatchObject({
      kind: 'timeout',
      freeBallFor: 1,
      trueFreeBall: true,
      elapsedMs: 10_000,
    });
    expect(machine.status).toBe('timeout');
    expect(machine.elapsedMs).toBe(10_000);

    expect(machine.opponentShot(true)).toMatchObject({ accepted: false, reason: 'already-resolved' });
    expect(machine.opponentPlaced()).toMatchObject({ accepted: false, reason: 'already-resolved' });
    expect(machine.advance(1)).toBeNull();
    expect(machine.outcome).toBe(timeout);
  });

  it('advances across the deadline in one injected step and resolves only once', () => {
    const machine = new FakeFreeBallMachine(1);
    const timeout = machine.advance(10_001);
    expect(timeout).toMatchObject({ kind: 'timeout', freeBallFor: 0, elapsedMs: 10_000 });
    expect(machine.advance(10_000)).toBeNull();
    expect(machine.opponentShot(true)).toMatchObject({ accepted: false, reason: 'already-resolved' });
    expect(machine.outcome).toBe(timeout);
  });
});
