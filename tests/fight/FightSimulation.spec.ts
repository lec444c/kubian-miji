import { describe, expect, it } from 'vitest';
import {
  FightSimulation, MAX_HP, NEUTRAL_INPUT, ROUND_SECONDS, SKILL_COOLDOWNS, SKILL_DAMAGE, SKILL_ORDER,
  COMBO_MAX, COMBO_WINDOW, COMBO_KNOCKDOWN, DOWN_DURATION, STUN_DURATION, DODGE_HEIGHT, RUN_JUMP_BOOST,
  GUARD_COOLDOWN_REFUND, GUARD_RAGE_GAIN, RAGE_MAX, attackSpeed, aiInput,
  type FightAction, type FightEvent, type FightInput, type FightSkill,
} from '../../src/fight/FightSimulation';

const DT = 1 / 120;
const input = (overrides: Partial<FightInput> = {}): FightInput => ({ ...NEUTRAL_INPUT, ...overrides });
const pair = (first: Partial<FightInput> = {}, second: Partial<FightInput> = {}): [FightInput, FightInput] => [input(first), input(second)];

function advance(sim: FightSimulation, frames: number, inputs = pair()): FightEvent[] {
  const events: FightEvent[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    sim.step(DT, inputs);
    events.push(...sim.events.map(event => ({ ...event })));
  }
  return events;
}

function nearby(distance = 1.2): FightSimulation {
  const sim = new FightSimulation();
  sim.fighters[0].x = -distance / 2;
  sim.fighters[1].x = distance / 2;
  return sim;
}

/** One clean light hit plus full recovery, leaving seat 0 idle and the combo window open. */
function landLightHit(sim: FightSimulation): void {
  advance(sim, 1, pair({ light: true }));
  advance(sim, 30);
  advance(sim, 1);
  advance(sim, 120);
}

const attacks = [
  { button: 'light', action: 'slash', startupFrames: 16, hitFrame: 17, durationFrames: 75, damage: 12, chip: 2, reach: 1.65, stun: 'impact', stunFrames: 39 },
  { button: 'heavy', action: 'slashAlt', startupFrames: 28, hitFrame: 29, durationFrames: 96, damage: 20, chip: 4, reach: 1.85, stun: 'impactAlt', stunFrames: 58 },
] as const;

describe('FightSimulation movement and clock', () => {
  it(`starts an independent ${MAX_HP} HP, ${ROUND_SECONDS} second round`, () => {
    const sim = new FightSimulation();
    expect(sim.fighters.map(fighter => fighter.x)).toEqual([-1.3, 1.3]);
    expect(sim.fighters.map(fighter => fighter.facing)).toEqual([1, -1]);
    for (const fighter of sim.fighters) {
      expect(fighter).toMatchObject({ y: 0, vy: 0, hp: MAX_HP, action: 'idle', actionTime: 0, serial: 0, hits: 0 });
    }
    expect(sim.getSnapshot()).toMatchObject({
      timeLeft: ROUND_SECONDS, elapsed: 0, winner: null, events: [],
      skillCooldowns: [{ ball: 0, cat: 0, volley: 0, dog: 0 }, { ball: 0, cat: 0, volley: 0, dog: 0 }], projectiles: [],
    });
    advance(sim, 120);
    expect(sim.elapsed).toBeCloseTo(1, 10);
    expect(sim.timeLeft).toBeCloseTo(ROUND_SECONDS - 1, 10);
  });

  it.each([
    { move: -1, run: false, speed: -2.2, action: 'walk' },
    { move: -1, run: true, speed: -4.0, action: 'run' },
    { move: -0.5, run: false, speed: -1.1, action: 'walk' },
    { move: 0, run: true, speed: 0, action: 'idle' },
  ])('uses exact grounded movement: $move, run=$run', ({ move, run, speed, action }) => {
    const sim = new FightSimulation();
    advance(sim, 60, pair({ move, run }));
    expect(sim.fighters[0].x).toBeCloseTo(-1.3 + speed / 2, 10);
    expect(sim.fighters[0].action).toBe(action);
  });

  it('clamps both arena boundaries, including running and jumping', () => {
    const sim = new FightSimulation();
    advance(sim, 600, pair({ move: -1, run: true, jump: true }, { move: 1, run: true, jump: true }));
    expect(sim.fighters[0].x).toBe(-4.6);
    expect(sim.fighters[1].x).toBe(4.6);
    expect(sim.fighters.every(fighter => fighter.y === 0 && fighter.vy === 0)).toBe(true);
  });

  it('prevents grounded crossing and maintains 0.6m separation under pressure', () => {
    const sim = new FightSimulation();
    advance(sim, 600, pair({ move: 1, run: true }, { move: -1, run: true }));
    expect(sim.fighters[1].x - sim.fighters[0].x).toBeCloseTo(0.6, 10);
    expect(sim.fighters[0].x).toBeLessThan(sim.fighters[1].x);
    expect(sim.fighters[0].x + sim.fighters[1].x).toBeCloseTo(0, 10);
  });

  it('resolves body pressure without pushing either fighter through the wall', () => {
    const sim = new FightSimulation();
    sim.fighters[0].x = 3.9;
    sim.fighters[1].x = 4.6;
    advance(sim, 240, pair({ move: 1, run: true }));
    expect(sim.fighters[0].x).toBeCloseTo(4, 10);
    expect(sim.fighters[1].x).toBe(4.6);
  });

  it('automatically turns once, without indefinitely resetting its animation', () => {
    const sim = nearby();
    sim.fighters[0].x = 0.6;
    sim.fighters[1].x = -0.6;
    advance(sim, 1);
    expect(sim.fighters[0]).toMatchObject({ facing: -1, action: 'turnAlt', serial: 1 });
    expect(sim.fighters[1]).toMatchObject({ facing: 1, action: 'turn', serial: 1 });
    advance(sim, 30);
    expect(sim.fighters[0].action).toBe('idle');
    expect(sim.fighters[1].action).toBe('idle');
    advance(sim, 1, pair({ light: true }));
    expect(sim.fighters[0].action).toBe('slash');
  });

  it('allows movement and attack cancellation of a short cosmetic turn', () => {
    const sim = nearby();
    sim.fighters[0].facing = 1;
    advance(sim, 1, pair({ move: -1 }));
    expect(sim.fighters[0].x).toBeLessThan(-0.6);
    expect(sim.fighters[0].action).toBe('turnAlt');
    advance(sim, 1, pair({ light: true }));
    expect(sim.fighters[0].action).toBe('slash');
  });
});

describe('FightSimulation attacks, guarding and interruption', () => {
  it.each(attacks)('$action has separate startup, active and recovery phases', attack => {
    const sim = nearby();
    const events = advance(sim, attack.startupFrames, pair({ [attack.button]: true }));
    expect(events).toEqual([{ kind: 'swing', seat: 0, damage: 0 }]);
    expect(sim.fighters[1].hp).toBe(MAX_HP);
    expect(sim.fighters[0].action).toBe(attack.action);
    expect(advance(sim, 1)).toEqual([{ kind: 'hit', seat: 1, damage: attack.damage }]);
    expect(sim.fighters[1]).toMatchObject({ hp: MAX_HP - attack.damage, action: attack.stun, actionTime: 0 });
    advance(sim, attack.durationFrames - attack.hitFrame - 1);
    expect(sim.fighters[0].action).toBe(attack.action);
    advance(sim, 2);
    expect(sim.fighters[0].action).toBe('idle');
    expect(sim.fighters[0].hits).toBe(1);
  });

  it.each(attacks)('$action reaches exactly $reach metres', attack => {
    const sim = nearby(attack.reach);
    const events = advance(sim, 160, pair({ [attack.button]: true }));
    expect(sim.fighters[1].hp).toBe(MAX_HP - attack.damage);
    expect(events.filter(event => event.kind === 'hit')).toHaveLength(1);
  });

  it.each(attacks)('$action whiffs beyond its range', attack => {
    const sim = nearby(attack.reach + 0.01);
    const events = advance(sim, 180, pair({ [attack.button]: true }));
    expect(sim.fighters[1].hp).toBe(MAX_HP);
    expect(events).toEqual([{ kind: 'swing', seat: 0, damage: 0 }]);
  });

  it.each(attacks)('$action connects only once and does not auto-repeat while held', attack => {
    const sim = nearby();
    const events = advance(sim, 360, pair({ [attack.button]: true }));
    expect(events.filter(event => event.kind === 'swing')).toHaveLength(1);
    expect(events.filter(event => event.kind === 'hit')).toHaveLength(1);
    expect(sim.fighters[1].hp).toBe(MAX_HP - attack.damage);
    advance(sim, 1);
    const next = advance(sim, attack.hitFrame, pair({ [attack.button]: true }));
    expect(next.filter(event => event.kind === 'swing')).toHaveLength(1);
    expect(sim.fighters[1].hp).toBe(MAX_HP - 2 * attack.damage);
    expect(sim.fighters[0].hits).toBe(2);
  });

  it('does not hit someone who enters range during recovery', () => {
    const sim = nearby(2.2);
    advance(sim, 45, pair({ light: true }));
    sim.fighters[1].x = 0;
    expect(advance(sim, 90).filter(event => event.kind === 'hit')).toHaveLength(0);
    expect(sim.fighters[1].hp).toBe(MAX_HP);
  });

  it('can connect later in its active window, but not twice on re-entry', () => {
    const sim = nearby(2.2);
    advance(sim, 30, pair({ light: true }));
    sim.fighters[1].x = 0;
    advance(sim, 1);
    expect(sim.fighters[1].hp).toBe(MAX_HP - 12);
    sim.fighters[1].x = 3;
    advance(sim, 1);
    sim.fighters[1].x = 0;
    expect(advance(sim, 10).filter(event => event.kind === 'hit')).toHaveLength(0);
    expect(sim.fighters[1].hp).toBe(MAX_HP - 12);
  });

  it('locks attack facing and never damages a target behind it', () => {
    const sim = nearby();
    advance(sim, 1, pair({ light: true }));
    sim.fighters[1].x = -1.5;
    const events = advance(sim, 60);
    expect(sim.fighters[0].facing).toBe(1);
    expect(sim.fighters[1].hp).toBe(MAX_HP);
    expect(events).toEqual([]);
    advance(sim, 80);
    expect(sim.fighters[0].facing).toBe(-1);
  });

  it.each([{ height: 0.9, damage: 0 }, { height: 0.8, damage: 12 }])('requires a vertical difference below 0.85m ($height)', ({ height, damage }) => {
    const sim = nearby();
    advance(sim, 16, pair({ light: true }));
    sim.fighters[1].y = height;
    advance(sim, 1);
    expect(sim.fighters[1].hp).toBe(MAX_HP - damage);
  });

  it.each(attacks)('guard reduces $action to $chip chip damage with one block event', attack => {
    const sim = nearby();
    const events = advance(sim, 180, pair({ [attack.button]: true }, { guard: true, move: -1, run: true }));
    expect(sim.fighters[1]).toMatchObject({ hp: MAX_HP - attack.chip, x: 0.6, action: 'guard' });
    expect(events).toEqual([{ kind: 'swing', seat: 0, damage: 0 }, { kind: 'block', seat: 1, damage: attack.chip }]);
    expect(sim.fighters[0].hits).toBe(1);
  });

  it('a held guard does not block attacks arriving from behind', () => {
    const sim = nearby();
    advance(sim, 1, pair({}, { guard: true }));
    sim.fighters[0].x = 1.6;
    const events = advance(sim, 30, pair({ light: true }, { guard: true }));
    expect(sim.fighters[1].hp).toBe(MAX_HP - 12);
    expect(events.some(event => event.kind === 'block')).toBe(false);
    expect(events).toContainEqual({ kind: 'hit', seat: 1, damage: 12 });
  });

  it('cannot attack and guard simultaneously', () => {
    const sim = nearby();
    const events = advance(sim, 30, pair({ light: true, guard: true }, { light: true, guard: true }));
    expect(sim.fighters.map(fighter => fighter.hp)).toEqual([MAX_HP - 12, MAX_HP - 12]);
    expect(events.filter(event => event.kind === 'block')).toHaveLength(0);
    expect(events.filter(event => event.kind === 'hit')).toHaveLength(2);
  });

  it('gives a simultaneous heavy/light press one heavy swing', () => {
    const sim = nearby();
    const events = advance(sim, 150, pair({ light: true, heavy: true }));
    expect(events.filter(event => event.kind === 'swing')).toHaveLength(1);
    expect(sim.fighters[1].hp).toBe(MAX_HP - 20);
  });

  it.each(attacks)('$stun locks movement, jumping, guarding and attacks without buffering held buttons', attack => {
    const sim = nearby();
    advance(sim, attack.hitFrame, pair({ [attack.button]: true }));
    const x = sim.fighters[1].x;
    const held = pair({}, { light: true, heavy: true, jump: true, guard: true, move: 1, run: true });
    const events = advance(sim, attack.stunFrames - 1, held);
    expect(sim.fighters[1]).toMatchObject({ action: attack.stun, x, y: 0 });
    expect(events).toEqual([]);
    const later = advance(sim, 30, held);
    expect(sim.fighters[1].action).toBe('guard');
    expect(later.filter(event => event.kind === 'swing')).toHaveLength(0);
    advance(sim, 1);
    advance(sim, 1, pair({}, { light: true }));
    expect(sim.fighters[1].action).toBe('slash');
  });

  it('an earlier light hit interrupts a heavy startup', () => {
    const sim = nearby();
    const events = advance(sim, 170, pair({ light: true }, { heavy: true }));
    expect(sim.fighters.map(fighter => fighter.hp)).toEqual([MAX_HP, MAX_HP - 12]);
    expect(events.filter(event => event.kind === 'swing')).toHaveLength(2);
    expect(events.filter(event => event.kind === 'hit')).toEqual([{ kind: 'hit', seat: 1, damage: 12 }]);
  });
});

describe('FightSimulation jumping', () => {
  it('follows the 7m/s, 18m/s² arc and lands without sinking or bouncing', () => {
    const sim = new FightSimulation();
    advance(sim, 1, pair({ jump: true }));
    expect(sim.fighters[0].vy).toBeCloseTo(7 - 18 * DT, 10);
    expect(sim.fighters[0].action).toBe('jump');
    advance(sim, 46);
    const t = 47 / 120;
    expect(sim.fighters[0].y).toBeCloseTo(7 * t - 9 * t * t, 10);
    expect(sim.fighters[0].y).toBeGreaterThan(1.3);
    advance(sim, 50);
    expect(sim.fighters[0]).toMatchObject({ y: 0, vy: 0, action: 'idle' });
  });

  it('uses jumpBack for a backward takeoff', () => {
    const sim = new FightSimulation();
    advance(sim, 1, pair({ jump: true, move: -1 }));
    expect(sim.fighters[0].action).toBe('jumpBack');
    expect(sim.fighters[0].x).toBeLessThan(-1.3);
    expect(sim.fighters[0].y).toBeGreaterThan(0);
  });

  it('does not repeatedly jump while the button is held', () => {
    const sim = new FightSimulation();
    advance(sim, 240, pair({ jump: true }));
    expect(sim.fighters[0]).toMatchObject({ y: 0, vy: 0, action: 'idle', serial: 2 });
    advance(sim, 1);
    advance(sim, 1, pair({ jump: true }));
    expect(sim.fighters[0].y).toBeGreaterThan(0);
  });

  it('passes over an opponent, changes facing, and restores spacing on landing', () => {
    const sim = nearby(0.8);
    advance(sim, 60, pair({ jump: true, move: 1, run: true }));
    expect(sim.fighters[0].x).toBeGreaterThan(sim.fighters[1].x);
    expect(sim.fighters[0].y).toBeGreaterThan(0);
    expect(sim.fighters[0].facing).toBe(-1);
    expect(sim.fighters[1].facing).toBe(1);
    advance(sim, 40);
    expect(sim.fighters[0]).toMatchObject({ y: 0, vy: 0 });
    expect(sim.fighters[0].x - sim.fighters[1].x).toBeGreaterThanOrEqual(0.6 - 1e-9);
  });

  it('continues airborne gravity while an attack is playing', () => {
    const sim = new FightSimulation();
    advance(sim, 1, pair({ jump: true }));
    advance(sim, 1, pair({ heavy: true }));
    expect(sim.fighters[0].action).toBe('slashAlt');
    advance(sim, 94);
    expect(sim.fighters[0]).toMatchObject({ y: 0, vy: 0, action: 'slashAlt' });
  });
});

describe('FightSimulation skills', () => {
  const actions: Record<FightSkill, FightAction> = { ball: 'skillBall', cat: 'skillCat', volley: 'skillVolley', dog: 'skillDog' };
  it.each(['ball', 'cat', 'volley'] as const)('$s casts its action, consumes cooldown and lands projectile damage', skill => {
    const sim = nearby(2.2);
    const cast = advance(sim, 1, pair({ skills: [skill] }));
    expect(cast).toContainEqual({ kind: 'skillCast', seat: 0, damage: 0, skill });
    expect(sim.fighters[0].action).toBe(actions[skill]);
    expect(sim.skillCooldowns[0][skill]).toBeGreaterThan(0);
    const events = advance(sim, 300);
    const expected = SKILL_DAMAGE[skill] * (skill === 'volley' ? 5 : 1);
    expect(sim.fighters[1].hp).toBe(MAX_HP - expected);
    expect(events.filter(event => event.kind === 'skillHit').length).toBe(skill === 'volley' ? 5 : 1);
    expect(events.filter(event => event.kind === 'skillHit').every(event => event.skill === skill)).toBe(true);
    expect(sim.projectiles).toHaveLength(0);
    expect(sim.skillCooldowns[0][skill]).toBeGreaterThan(0);
    expect(sim.skillCooldowns[0][skill]).toBeLessThanOrEqual(SKILL_COOLDOWNS[skill]);
  });

  it('skills are not stopped by guard', () => {
    const sim = nearby(2.2);
    advance(sim, 1, pair({ skills: ['ball'] }, { guard: true }));
    const events = advance(sim, 120, pair({}, { guard: true }));
    expect(sim.fighters[1].hp).toBe(MAX_HP - SKILL_DAMAGE.ball);
    expect(events.some(event => event.kind === 'skillHit')).toBe(true);
    expect(events.some(event => event.kind === 'block')).toBe(false);
  });

  it('an interrupt before the spawn consumes the cooldown without creating a projectile', () => {
    const sim = nearby(1.2);
    advance(sim, 1, pair({ skills: ['cat'] }, { light: true }));
    expect(sim.fighters[0].action).toBe('skillCat');
    advance(sim, 30);
    expect(sim.projectiles).toHaveLength(0);
    expect(sim.skillCooldowns[0].cat).toBeGreaterThan(0);
    expect(sim.fighters[0].action).toBe('impact');
  });

  it('does not recast while cooling down and reset clears cooldowns/projectiles', () => {
    const sim = nearby(2.2);
    advance(sim, 1, pair({ skills: ['ball'] }));
    advance(sim, 200);
    const hp = sim.fighters[1].hp;
    const events = advance(sim, 1, pair({ skills: ['ball'] }));
    expect(events.filter(event => event.kind === 'skillCast')).toHaveLength(0);
    expect(sim.fighters[1].hp).toBe(hp);
    expect(sim.fighters[0].action).not.toBe('skillBall');
    sim.reset();
    expect(sim.skillCooldowns[0]).toEqual({ ball: 0, cat: 0, volley: 0, dog: 0 });
    expect(sim.projectiles).toEqual([]);
  });
});

describe('FightSimulation rage ultimate (dog)', () => {
  const pushDog = (sim: FightSimulation, vx = 11): void => {
    sim.projectiles.push({
      id: 1, owner: 0, skill: 'dog', x: sim.fighters[1].x - 0.1, y: 0.5, z: 0, vx,
      radius: 0.75, damage: SKILL_DAMAGE.dog, spin: 0, life: 2,
    });
  };

  it('refuses the ultimate below full rage and consumes all rage on cast', () => {
    const sim = nearby(2.2);
    sim.fighters[0].rage = RAGE_MAX - 1;
    advance(sim, 1, pair({ skills: ['dog'] }));
    expect(sim.fighters[0].action).toBe('idle');
    expect(sim.fighters[0].rage).toBe(RAGE_MAX - 1);
    advance(sim, 1);
    sim.fighters[0].rage = RAGE_MAX;
    const events = advance(sim, 1, pair({ skills: ['dog'] }));
    expect(sim.fighters[0].action).toBe('skillDog');
    expect(sim.fighters[0].rage).toBe(0);
    expect(events).toContainEqual({ kind: 'skillCast', seat: 0, damage: 0, skill: 'dog' });
  });

  it('launches the target, stuns it and deals heavy damage on hit', () => {
    const sim = nearby(1.2);
    pushDog(sim);
    const events = advance(sim, 1);
    const target = sim.fighters[1];
    expect(target.hp).toBe(MAX_HP - SKILL_DAMAGE.dog);
    expect(target.action).toBe('down');
    expect(target.downDuration).toBe(STUN_DURATION);
    expect(target.y).toBeGreaterThan(0);
    expect(target.vy).toBeGreaterThan(6);
    expect(target.vx).toBeGreaterThan(0);
    expect(events.some(event => event.kind === 'skillHit' && event.skill === 'dog')).toBe(true);
    expect(events.some(event => event.kind === 'down' && event.skill === 'dog')).toBe(true);
    expect(sim.projectiles).toHaveLength(0);
  });

  it('keeps the target down for the full 3 second stun, then rises', () => {
    const sim = nearby(1.2);
    pushDog(sim, 0);
    advance(sim, 1);
    advance(sim, Math.floor(STUN_DURATION * 120) - 2);
    expect(sim.fighters[1].action).toBe('down');
    advance(sim, 6);
    expect(sim.fighters[1].action).toBe('idle');
    expect(sim.fighters[1].y).toBe(0);
  });

  it('cannot be jumped over', () => {
    const sim = nearby(1.2);
    sim.fighters[1].y = 0.9;
    pushDog(sim, 0);
    advance(sim, 1);
    expect(sim.fighters[1].hp).toBe(MAX_HP - SKILL_DAMAGE.dog);
    expect(sim.fighters[1].action).toBe('down');
  });

  it('AI casts the ultimate once rage is full at range', () => {
    const sim = nearby(3);
    sim.fighters[1].rage = RAGE_MAX;
    expect(aiInput(sim)).toMatchObject({ skills: ['dog'] });
    sim.fighters[1].rage = RAGE_MAX - 1;
    expect(aiInput(sim).skills ?? []).not.toContain('dog');
  });
});

describe('FightSimulation facing, run-jump, dodging, knockdown and combo', () => {
  it('faces the movement direction while grounded and the opponent when idle', () => {
    const sim = nearby();
    advance(sim, 20, pair({ move: -1 }));
    expect(sim.fighters[0].facing).toBe(-1);
    advance(sim, 30);
    expect(sim.fighters[0].facing).toBe(1);
    advance(sim, 20, pair({ move: 1 }));
    expect(sim.fighters[0].facing).toBe(1);
  });

  it('carries running momentum so a running jump travels farther than a standing jump', () => {
    const standing = new FightSimulation();
    advance(standing, 1, pair({ jump: true }));
    expect(standing.fighters[0].vx).toBe(0);
    const standingStart = standing.fighters[0].x;
    advance(standing, 100);
    const standingDistance = Math.abs(standing.fighters[0].x - standingStart);

    const running = new FightSimulation();
    advance(running, 1, pair({ jump: true, move: 1, run: true }));
    expect(running.fighters[0].vx).toBeGreaterThan(RUN_JUMP_BOOST * 0.9);
    expect(running.fighters[0].vx).toBeLessThanOrEqual(RUN_JUMP_BOOST);
    const runningStart = running.fighters[0].x;
    advance(running, 100);
    const runningDistance = Math.abs(running.fighters[0].x - runningStart);

    expect(standing.fighters[0].y).toBe(0);
    expect(running.fighters[0].y).toBe(0);
    expect(running.fighters[0].vx).toBe(0);
    expect(runningDistance).toBeGreaterThan(standingDistance + 0.5);
  });

  it.each(['ball', 'cat'] as const)('an airborne target above the dodge height evades skill %s', skill => {
    const sim = nearby(1);
    sim.fighters[1].y = DODGE_HEIGHT + 0.25;
    sim.projectiles.push({
      id: 1, owner: 0, skill, x: sim.fighters[1].x - 0.1, y: 0.6, z: 0, vx: 0,
      radius: 0.42, damage: SKILL_DAMAGE[skill], spin: 0, life: 2,
    });
    const events = advance(sim, 1);
    expect(sim.fighters[1].y).toBeGreaterThan(DODGE_HEIGHT);
    expect(sim.fighters[1].hp).toBe(MAX_HP);
    expect(events.filter(event => event.kind === 'skillHit')).toHaveLength(0);
  });

  it('a grounded target still takes skills 1 and 2', () => {
    for (const skill of ['ball', 'cat'] as const) {
      const sim = nearby(1);
      sim.projectiles.push({
        id: 1, owner: 0, skill, x: sim.fighters[1].x - 0.1, y: 0.6, z: 0, vx: 0,
        radius: 0.42, damage: SKILL_DAMAGE[skill], spin: 0, life: 2,
      });
      advance(sim, 1);
      expect(sim.fighters[1].hp).toBe(MAX_HP - SKILL_DAMAGE[skill]);
      expect(sim.fighters[1].action).toBe('down');
      expect(sim.fighters[1].downDuration).toBe(DOWN_DURATION);
    }
  });

  it('skill 3 connects even against a high jump and knocks the target down', () => {
    const sim = nearby(1);
    sim.fighters[1].y = 0.9;
    sim.projectiles.push({
      id: 1, owner: 0, skill: 'volley', x: sim.fighters[1].x - 0.1, y: 0.36, z: 0, vx: 0,
      radius: 0.32, damage: SKILL_DAMAGE.volley, spin: 0, life: 2,
    });
    const events = advance(sim, 1);
    expect(sim.fighters[1].hp).toBe(MAX_HP - SKILL_DAMAGE.volley);
    expect(sim.fighters[1].action).toBe('down');
    expect(events.some(event => event.kind === 'down' && event.skill === 'volley')).toBe(true);
  });

  it('a knockdown locks the fighter for DOWN_DURATION, then it rises to idle', () => {
    const sim = nearby();
    sim.fighters[1].action = 'down';
    sim.fighters[1].actionTime = 0;
    const locked = advance(sim, Math.floor(DOWN_DURATION * 120) - 2, pair({}, { light: true, move: 1, run: true }));
    expect(sim.fighters[1].action).toBe('down');
    expect(locked.filter(event => event.kind === 'swing')).toHaveLength(0);
    advance(sim, 4);
    expect(sim.fighters[1].action).toBe('idle');
  });

  it('orders skill damage ball > cat > volley', () => {
    expect(SKILL_DAMAGE.ball).toBeGreaterThan(SKILL_DAMAGE.cat);
    expect(SKILL_DAMAGE.cat).toBeGreaterThan(SKILL_DAMAGE.volley);
  });

  it('knocks the target down on the third clean hit and resets the chain', () => {
    const sim = nearby();
    landLightHit(sim);
    landLightHit(sim);
    expect(sim.fighters[0].combo).toBe(2);
    advance(sim, 1, pair({ light: true }));
    advance(sim, 31);
    expect(sim.fighters[0].hits).toBe(COMBO_KNOCKDOWN);
    expect(sim.fighters[0].combo).toBe(0);
    expect(sim.fighters[1].action).toBe('down');
    expect(sim.fighters[1].downDuration).toBe(DOWN_DURATION);
    expect(sim.fighters[1].hp).toBe(MAX_HP - 3 * 12);
    expect(attackSpeed(0)).toBe(1);
    expect(attackSpeed(COMBO_MAX)).toBeCloseTo(1 + 0.18 * COMBO_MAX, 10);
  });

  it('accelerates the current swing while combo stacks are held', () => {
    const sim = nearby(3);
    sim.fighters[0].combo = COMBO_MAX;
    sim.fighters[0].comboTimer = COMBO_WINDOW;
    advance(sim, 1, pair({ light: true }));
    const start = sim.fighters[0].actionTime;
    advance(sim, 10);
    expect(sim.fighters[0].combo).toBe(COMBO_MAX);
    expect(sim.fighters[0].actionTime).toBeCloseTo(start + 10 * DT * attackSpeed(COMBO_MAX), 6);
  });

  it('cancels a connected swing into the next strike during recovery', () => {
    const sim = nearby();
    advance(sim, 40, pair({ light: true }));
    expect(sim.fighters[0].action).toBe('slash');
    const events = advance(sim, 1, pair({ heavy: true }));
    expect(sim.fighters[0].action).toBe('slashAlt');
    expect(events).toContainEqual({ kind: 'swing', seat: 0, damage: 0 });
  });

  it('does not cancel a whiffed swing during recovery', () => {
    const sim = nearby(3);
    advance(sim, 40, pair({ light: true }));
    advance(sim, 1, pair({ heavy: true }));
    expect(sim.fighters[0].action).toBe('slash');
  });

  it('successful guards refund skill cooldowns and fill the rage meter', () => {
    const sim = nearby();
    sim.skillCooldowns[1].ball = 20;
    for (let index = 0; index < 4; index += 1) {
      advance(sim, 1, pair({ light: true }, { guard: true }));
      advance(sim, 80, pair({}, { guard: true }));
    }
    expect(sim.fighters[1].rage).toBe(Math.min(RAGE_MAX, 4 * GUARD_RAGE_GAIN));
    expect(sim.fighters[1].rage).toBe(RAGE_MAX);
    expect(sim.skillCooldowns[1].ball).toBeCloseTo(20 - 4 * GUARD_COOLDOWN_REFUND - 324 * DT, 6);
    expect(sim.fighters[1].hp).toBe(MAX_HP - 4 * 2);
  });

  it('breaks the combo when the fighter is hit and after the window lapses', () => {
    const hit = nearby();
    landLightHit(hit);
    expect(hit.fighters[0].combo).toBe(1);
    advance(hit, 1, pair({}, { light: true }));
    advance(hit, 30);
    expect(hit.fighters[0].combo).toBe(0);

    const lapsed = nearby();
    landLightHit(lapsed);
    expect(lapsed.fighters[0].combo).toBe(1);
    advance(lapsed, Math.ceil(COMBO_WINDOW * 120) + 5);
    expect(lapsed.fighters[0].combo).toBe(0);
  });
});

describe('FightSimulation round resolution and reset', () => {
  it.each([0, 1] as const)('awards seat %i a KO once, then freezes the world', seat => {
    const sim = nearby();
    const target = seat === 0 ? 1 : 0;
    sim.fighters[target].hp = 12;
    const inputs = pair();
    inputs[seat].light = true;
    const events = advance(sim, 40, inputs);
    expect(sim.winner).toBe(seat);
    expect(sim.fighters[target]).toMatchObject({ hp: 0, action: 'ko' });
    expect(events.filter(event => event.kind === 'end')).toEqual([{ kind: 'end', seat, damage: 0 }]);
    const frozen = sim.getSnapshot();
    expect(advance(sim, 240, pair({ move: 1, heavy: true, jump: true }, { move: -1, light: true }))).toEqual([]);
    expect(sim.getSnapshot()).toEqual(frozen);
  });

  it('commits simultaneous lethal strikes as a double KO draw', () => {
    const sim = nearby();
    sim.fighters[0].hp = 12;
    sim.fighters[1].hp = 12;
    const events = advance(sim, 27, pair({ light: true }, { light: true }));
    expect(sim.winner).toBe('draw');
    expect(sim.fighters.map(fighter => fighter.hp)).toEqual([0, 0]);
    expect(sim.fighters.map(fighter => fighter.action)).toEqual(['ko', 'ko']);
    expect(sim.fighters.map(fighter => fighter.hits)).toEqual([1, 1]);
    expect(events.filter(event => event.kind === 'hit')).toEqual([
      { kind: 'hit', seat: 1, damage: 12 }, { kind: 'hit', seat: 0, damage: 12 },
    ]);
    expect(events.filter(event => event.kind === 'end')).toHaveLength(1);
    expect(advance(sim, 120)).toEqual([]);
  });

  it('allows chip damage to finish a round, with HP clamped to zero', () => {
    const sim = nearby();
    sim.fighters[1].hp = 1;
    const events = advance(sim, 30, pair({ light: true }, { guard: true }));
    expect(sim.fighters[1]).toMatchObject({ hp: 0, action: 'ko' });
    expect(sim.winner).toBe(0);
    expect(events.filter(event => event.kind === 'block')).toHaveLength(1);
    expect(events.filter(event => event.kind === 'end')).toHaveLength(1);
  });

  it.each([
    { hp: [MAX_HP, MAX_HP], winner: 'draw' },
    { hp: [MAX_HP, MAX_HP - 20], winner: 0 },
    { hp: [MAX_HP - 20, MAX_HP], winner: 1 },
  ] as const)(`resolves the ${ROUND_SECONDS}s timeout exactly once: $hp => $winner`, ({ hp, winner }) => {
    const sim = new FightSimulation();
    sim.fighters[0].hp = hp[0];
    sim.fighters[1].hp = hp[1];
    const events = advance(sim, ROUND_SECONDS * 120);
    expect(sim.timeLeft).toBe(0);
    expect(sim.elapsed).toBe(ROUND_SECONDS);
    expect(sim.winner).toBe(winner);
    expect(events).toEqual([{ kind: 'end', seat: winner === 'draw' ? 0 : winner, damage: 0 }]);
    const fighters = sim.getSnapshot().fighters;
    expect(advance(sim, 120, pair({ light: true }, { heavy: true }))).toEqual([]);
    expect(sim.getSnapshot().fighters).toEqual(fighters);
    expect(sim.timeLeft).toBe(0);
    expect(sim.elapsed).toBe(ROUND_SECONDS);
  });

  it('commits both strikes before resolving a timeout on the same tick', () => {
    const sim = nearby();
    advance(sim, 16, pair({ light: true }, { light: true }));
    sim.fighters[0].hp = 12;
    sim.fighters[1].hp = 12;
    sim.timeLeft = DT;
    sim.elapsed = ROUND_SECONDS - DT;
    sim.step(DT, pair());
    expect(sim.winner).toBe('draw');
    expect(sim.fighters.map(fighter => fighter.hp)).toEqual([0, 0]);
    expect(sim.events.map(event => event.kind)).toEqual(['hit', 'hit', 'end']);
  });

  it('reset clears the outcome, events, counters, hit memory and input latches', () => {
    const sim = nearby();
    sim.fighters[1].hp = 12;
    advance(sim, 27, pair({ light: true }));
    expect(sim.winner).toBe(0);
    sim.reset();
    expect(sim.getSnapshot()).toEqual(new FightSimulation().getSnapshot());
    sim.fighters[0].x = -0.6;
    sim.fighters[1].x = 0.6;
    const events = advance(sim, 27, pair({ light: true }));
    expect(events).toEqual([{ kind: 'swing', seat: 0, damage: 0 }, { kind: 'hit', seat: 1, damage: 12 }]);
    expect(sim.fighters[0].hits).toBe(1);
  });
});

describe('FightSimulation safe inputs, snapshots and determinism', () => {
  it.each([NaN, Infinity, -Infinity, 0, -1])('ignores invalid dt %s without consuming the attack edge', dt => {
    const sim = nearby();
    const before = sim.getSnapshot();
    sim.step(dt, pair({ light: true }));
    expect(sim.getSnapshot()).toEqual(before);
    sim.step(DT, pair({ light: true }));
    expect(sim.events).toEqual([{ kind: 'swing', seat: 0, damage: 0 }]);
  });

  it('caps extreme finite dt and subdivides it without skipping startup or collision', () => {
    const sim = nearby();
    sim.step(Number.MAX_VALUE, pair({ light: true }, { move: -1, run: true }));
    expect(sim.elapsed).toBeCloseTo(0.1, 10);
    expect(sim.fighters[1].hp).toBe(MAX_HP);
    sim.step(Number.MAX_VALUE, pair({ light: true }, { move: -1, run: true }));
    expect(sim.fighters[1].hp).toBe(MAX_HP - 12);
    expect(sim.events.filter(event => event.kind === 'hit')).toHaveLength(1);
    sim.step(Number.MAX_VALUE, pair({ light: true }, { move: -1, run: true }));
    expect(sim.fighters[1].hp).toBe(MAX_HP - 12);
    expect(sim.fighters[1].x - sim.fighters[0].x).toBeGreaterThanOrEqual(0.6 - 1e-9);
    expect(Number.isFinite(sim.fighters[0].actionTime)).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity])('sanitizes non-finite move %s and malformed boolean fields', move => {
    const sim = new FightSimulation();
    const malformed = { move, run: NaN, jump: NaN, light: NaN, heavy: NaN, guard: NaN } as unknown as FightInput;
    advance(sim, 120, [malformed, NEUTRAL_INPUT]);
    expect(sim.fighters[0]).toMatchObject({ x: -1.3, y: 0, vy: 0, hp: MAX_HP, action: 'idle' });
    expect(sim.fighters[1].hp).toBe(MAX_HP);
    expect(Number.isFinite(sim.timeLeft)).toBe(true);
  });

  it('clamps finite move magnitudes to one', () => {
    const sim = new FightSimulation();
    advance(sim, 120, pair({ move: -Number.MAX_VALUE }, { move: Number.MAX_VALUE }));
    expect(sim.fighters[0].x).toBeCloseTo(-3.5, 10);
    expect(sim.fighters[1].x).toBeCloseTo(3.5, 10);
  });

  it('does not mutate caller inputs or the shared neutral input', () => {
    const sim = nearby();
    const first = Object.freeze(input({ light: true, move: 42, run: true }));
    const second = Object.freeze(input({ guard: true }));
    const inputs: [FightInput, FightInput] = [first, second];
    Object.freeze(inputs);
    const before = [{ ...first }, { ...second }];
    advance(sim, 150, inputs);
    expect(inputs).toEqual(before);
    expect(NEUTRAL_INPUT).toEqual({ move: 0, run: false, jump: false, light: false, heavy: false, guard: false });
    expect(Object.isFrozen(NEUTRAL_INPUT)).toBe(true);
  });

  it('copies button latches rather than retaining a caller-owned input reference', () => {
    const sim = nearby();
    const first = input();
    sim.step(DT, [first, NEUTRAL_INPUT]);
    first.light = true;
    sim.step(DT, pair({ light: true }));
    expect(sim.fighters[0].action).toBe('slash');
  });

  it('deep-copies fighters, the tuple, events and individual event objects', () => {
    const sim = nearby();
    advance(sim, 17, pair({ light: true }));
    const before = sim.getSnapshot();
    const snapshot = sim.getSnapshot();
    expect(snapshot.fighters).not.toBe(sim.fighters);
    expect(snapshot.fighters[0]).not.toBe(sim.fighters[0]);
    expect(snapshot.events).not.toBe(sim.events);
    expect(snapshot.events[0]).not.toBe(sim.events[0]);
    snapshot.fighters[0].hp = 1;
    snapshot.fighters[1].x = 999;
    const event = snapshot.events[0];
    if (!event) throw new Error('Expected the hit event');
    event.damage = 999;
    snapshot.events.push({ kind: 'end', seat: 1, damage: 0 });
    expect(sim.getSnapshot()).toEqual(before);
    advance(sim, 30);
    expect(before.fighters[1].actionTime).toBe(0);
    expect(before.events).toEqual([{ kind: 'hit', seat: 1, damage: 12 }]);
  });

  it('replays identical fixed-step commands with identical state and event ordering', () => {
    const first = new FightSimulation();
    const second = new FightSimulation();
    for (let frame = 0; frame < 2400; frame += 1) {
      const inputs = pair({
        move: frame % 400 < 200 ? 1 : -1, run: frame % 80 < 30,
        jump: frame % 211 === 0, light: frame % 151 === 0, heavy: frame % 193 === 0, guard: frame % 100 > 80,
        skills: frame % 131 === 0 ? [SKILL_ORDER[(frame / 131) % 3]!] : [],
      }, {
        move: frame % 360 < 180 ? -1 : 1, run: frame % 100 < 45,
        jump: frame % 227 === 0, light: frame % 149 === 0, heavy: frame % 179 === 0, guard: frame % 120 > 90,
      });
      first.step(DT, inputs);
      second.step(DT, inputs);
      expect(first.getSnapshot()).toEqual(second.getSnapshot());
    }
  });
});

describe('deterministic aiInput', () => {
  it('approaches, alternates real attacks, and guards without cooldown-free spam', () => {
    const sim = new FightSimulation();
    expect(aiInput(sim)).toMatchObject({ move: -1, run: true });
    const attackActions: string[] = [];
    const swingTimes: number[] = [];
    let guardFrames = 0;
    for (let frame = 0; frame < 2400 && sim.winner === null; frame += 1) {
      const command = aiInput(sim);
      sim.step(DT, [NEUTRAL_INPUT, command]);
      if (sim.fighters[1].action === 'guard') guardFrames += 1;
      if (sim.events.some(event => event.kind === 'swing' && event.seat === 1)) {
        swingTimes.push(sim.elapsed);
        attackActions.push(sim.fighters[1].action);
      }
    }
    expect(sim.fighters[1].x).toBeLessThan(1.3);
    expect(sim.fighters[0].hp).toBeLessThan(MAX_HP);
    expect(attackActions).toContain('slash');
    expect(attackActions).toContain('slashAlt');
    expect(guardFrames).toBeGreaterThan(0);
    expect(swingTimes.length).toBeGreaterThan(2);
    expect(swingTimes.length).toBeLessThanOrEqual(Math.ceil(sim.elapsed / 1.7) + 1);
    for (let index = 1; index < swingTimes.length; index += 1) {
      expect(swingTimes[index]! - swingTimes[index - 1]!).toBeGreaterThan(1.5);
    }
    expect(aiInput(sim)).toEqual(NEUTRAL_INPUT);
  });

  it('is pure, returns fresh inputs, and reproduces an entire AI match', () => {
    const first = new FightSimulation();
    const second = new FightSimulation();
    const initial = first.getSnapshot();
    const command = aiInput(first);
    expect(aiInput(first)).toEqual(command);
    command.move = 999;
    expect(first.getSnapshot()).toEqual(initial);
    expect(aiInput(first).move).toBe(-1);
    for (let frame = 0; frame < 1800; frame += 1) {
      first.step(DT, [NEUTRAL_INPUT, aiInput(first)]);
      second.step(DT, [NEUTRAL_INPUT, aiInput(second)]);
      expect(first.getSnapshot()).toEqual(second.getSnapshot());
    }
  });
});
