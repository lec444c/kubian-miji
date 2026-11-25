export type FightAction =
  | 'idle' | 'walk' | 'run' | 'jump' | 'jumpBack'
  | 'slash' | 'slashAlt' | 'impact' | 'impactAlt' | 'guard' | 'turn' | 'turnAlt' | 'down' | 'ko'
  | 'skillBall' | 'skillCat' | 'skillVolley' | 'skillDog';

export type FightSkill = 'ball' | 'cat' | 'volley' | 'dog';

export interface FightInput {
  move: number;
  run: boolean;
  jump: boolean;
  light: boolean;
  heavy: boolean;
  guard: boolean;
  /** Pulse-only skill presses. Repeated frames do not recast. */
  skills?: readonly FightSkill[];
}

export const NEUTRAL_INPUT: FightInput = Object.freeze({
  move: 0, run: false, jump: false, light: false, heavy: false, guard: false,
});

/** Both seats start with the same health; the 100 s limit keeps one round near the requested length. */
export const MAX_HP = 200;
export const ROUND_SECONDS = 100;
export const SKILL_ORDER: readonly FightSkill[] = ['ball', 'cat', 'volley', 'dog'];
export const SKILL_NAMES: Record<FightSkill, string> = {
  ball: '自由球', cat: '老吴出击', volley: '万杆齐发', dog: '大狗大狗叫叫叫',
};
export const SKILL_COOLDOWNS: Record<FightSkill, number> = { ball: 20, cat: 24, volley: 28, dog: 0 };
/** Every skill knocks its target down; the rage ultimate hits hardest and stuns longest. */
export const SKILL_DAMAGE: Record<FightSkill, number> = { ball: 30, cat: 24, volley: 4, dog: 60 };

/** Knockdown: a short lie-down before the fighter rises again. */
export const DOWN_DURATION = 2.0;
/** The dog ultimate launches its target and keeps it stunned for three seconds. */
export const STUN_DURATION = 3.0;
/** Consecutive clean melee hits build up to five stacks; each stack speeds the next swing. */
export const COMBO_MAX = 5;
export const COMBO_WINDOW = 2.5;
export const COMBO_SPEED = 0.18;
/** The third consecutive clean hit knocks the target down and resets the chain. */
export const COMBO_KNOCKDOWN = 3;
/** A successful guard refunds this many seconds off every skill cooldown. */
export const GUARD_COOLDOWN_REFUND = 3;
/** A successful guard builds rage; four guards fill the meter and unlock the ultimate. */
export const GUARD_RAGE_GAIN = 25;
export const RAGE_MAX = 100;
/** A running takeoff carries extra horizontal momentum, lengthening the jump. */
export const RUN_JUMP_BOOST = 3.2;
/** Airborne targets above this height dodge skills 1 and 2; skills 3 and the ultimate always connect. */
export const DODGE_HEIGHT = 0.35;

export function attackSpeed(combo: number): number {
  return 1 + COMBO_SPEED * Math.max(0, Math.min(COMBO_MAX, combo));
}

export interface FighterState {
  x: number;
  y: number;
  vy: number;
  /** Ballistic horizontal momentum from a running jump; decays airborne, zero grounded. */
  vx: number;
  facing: 1 | -1;
  hp: number;
  action: FightAction;
  actionTime: number;
  /** Increments whenever a new animation/action starts. */
  serial: number;
  /** Confirmed outgoing contacts, including blocked strikes. */
  hits: number;
  /** Current consecutive-hit stacks (0..COMBO_MAX) and the time left to keep them. */
  combo: number;
  comboTimer: number;
  /** Rage meter (0..RAGE_MAX); filled by successful guards, spent by the dog ultimate. */
  rage: number;
  /** How long the current knockdown lasts; the dog ultimate extends it to STUN_DURATION. */
  downDuration: number;
}

export interface FightProjectile {
  id: number;
  owner: 0 | 1;
  skill: FightSkill;
  x: number;
  y: number;
  z: number;
  vx: number;
  radius: number;
  damage: number;
  spin: number;
  life: number;
}

export interface FightEvent {
  kind: 'swing' | 'hit' | 'block' | 'end' | 'skillCast' | 'skillHit' | 'down';
  /** Swing/cast: attacker; hit/block/skillHit/down: recipient; end: winner (0 for a draw). */
  seat: 0 | 1;
  damage: number;
  skill?: FightSkill;
  x?: number;
  y?: number;
  /** Projectile that caused a skillHit; the view uses it to keep the released model visible. */
  projectileId?: number;
}

export type SkillCooldowns = Record<FightSkill, number>;

type Seat = 0 | 1;
type SkillAction = 'skillBall' | 'skillCat' | 'skillVolley' | 'skillDog';
type Edges = Pick<FightInput, 'jump' | 'light' | 'heavy'> & { skills: FightSkill[] };
type Attack = 'slash' | 'slashAlt';

const SEATS: readonly Seat[] = [0, 1];
const LIMIT = 4.6;
const SEPARATION = 0.6;
const WALK_SPEED = 2.2;
const RUN_SPEED = 4.0;
const GRAVITY = 18;
const JUMP_SPEED = 7.0;
const PHYSICS_STEP = 1 / 120;
const EPSILON = 1e-9;
const NO_EDGES: Edges = { jump: false, light: false, heavy: false, skills: [] };

// Seconds: startup / active / recovery = .14/.16/.32 and .24/.18/.38.
const ATTACKS = {
  slash: { startup: 0.14, active: 0.16, duration: 0.62, reach: 1.65, damage: 12, chip: 2 },
  slashAlt: { startup: 0.24, active: 0.18, duration: 0.8, reach: 1.85, damage: 20, chip: 4 },
} as const;

const SKILLS = {
  ball: {
    action: 'skillBall', cast: 1.2, spawn: 0.42, speed: 9,
    radius: 0.42, height: 0.6, damage: SKILL_DAMAGE.ball,
  },
  cat: {
    action: 'skillCat', cast: 0.9, spawn: 0.28, speed: 7,
    radius: 0.52, height: 0.52, damage: SKILL_DAMAGE.cat,
  },
  volley: {
    action: 'skillVolley', cast: 1.4, spawn: 0.72, speed: 12,
    radius: 0.32, height: 0.95, damage: SKILL_DAMAGE.volley,
  },
  dog: {
    action: 'skillDog', cast: 1.5, spawn: 0.6, speed: 11,
    radius: 0.75, height: 0.5, damage: SKILL_DAMAGE.dog,
  },
} as const;
const SKILL_BY_ACTION: Record<SkillAction, FightSkill> = {
  skillBall: 'ball', skillCat: 'cat', skillVolley: 'volley', skillDog: 'dog',
};

function isAttack(action: FightAction): action is Attack {
  return action === 'slash' || action === 'slashAlt';
}

function isSkillAction(action: FightAction): action is SkillAction {
  return action === 'skillBall' || action === 'skillCat' || action === 'skillVolley' || action === 'skillDog';
}

function isLocked(action: FightAction): boolean {
  return isAttack(action) || isSkillAction(action) || action === 'impact' || action === 'impactAlt' || action === 'down' || action === 'ko';
}

function isTurn(action: FightAction): boolean {
  return action === 'turn' || action === 'turnAlt';
}

function duration(action: FightAction, downDuration = DOWN_DURATION): number {
  if (isAttack(action)) return ATTACKS[action].duration;
  if (isSkillAction(action)) return SKILLS[SKILL_BY_ACTION[action]].cast;
  if (action === 'impact') return 0.32;
  if (action === 'impactAlt') return 0.48;
  if (action === 'down') return downDuration;
  if (isTurn(action)) return 0.14;
  return Infinity;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function cleanSkills(skills: readonly FightSkill[] | undefined): FightSkill[] {
  if (!Array.isArray(skills)) return [];
  const clean: FightSkill[] = [];
  for (const skill of skills) {
    if (SKILL_ORDER.includes(skill) && !clean.includes(skill)) clean.push(skill);
  }
  return clean;
}

function cleanInput(input: FightInput): FightInput {
  return {
    move: Number.isFinite(input.move) ? clamp(input.move, -1, 1) : 0,
    run: input.run === true,
    jump: input.jump === true,
    light: input.light === true,
    heavy: input.heavy === true,
    guard: input.guard === true,
    skills: cleanSkills(input.skills),
  };
}

function edges(input: FightInput, previous: FightInput): Edges {
  const previousSkills = new Set(cleanSkills(previous.skills));
  return {
    jump: input.jump && !previous.jump,
    light: input.light && !previous.light,
    heavy: input.heavy && !previous.heavy,
    skills: cleanSkills(input.skills).filter(skill => !previousSkills.has(skill)),
  };
}

function makeCooldowns(): SkillCooldowns {
  return { ball: 0, cat: 0, volley: 0, dog: 0 };
}

function makeFighter(seat: Seat): FighterState {
  return {
    x: seat === 0 ? -1.3 : 1.3, y: 0, vy: 0, vx: 0, facing: seat === 0 ? 1 : -1,
    hp: MAX_HP, action: 'idle', actionTime: 0, serial: 0, hits: 0, combo: 0, comboTimer: 0,
    rage: 0, downDuration: DOWN_DURATION,
  };
}

/** Pure rules. The caller normally supplies fixed 1/120-second steps. */
export class FightSimulation {
  fighters: [FighterState, FighterState] = [makeFighter(0), makeFighter(1)];
  timeLeft = ROUND_SECONDS;
  elapsed = 0;
  winner: Seat | 'draw' | null = null;
  skillCooldowns: [SkillCooldowns, SkillCooldowns] = [makeCooldowns(), makeCooldowns()];
  projectiles: FightProjectile[] = [];
  /** Events from the most recent step only; never a cumulative event log. */
  events: FightEvent[] = [];

  private previous: [FightInput, FightInput] = [{ ...NEUTRAL_INPUT }, { ...NEUTRAL_INPUT }];
  private connected: [boolean, boolean] = [false, false];
  private skillSpawned: [boolean, boolean] = [false, false];
  /** Swing speed frozen at takeoff so a landing hit speeds the NEXT swing, not its own recovery. */
  private attackRate: [number, number] = [1, 1];
  private nextProjectileId = 1;

  reset(): void {
    this.fighters = [makeFighter(0), makeFighter(1)];
    this.timeLeft = ROUND_SECONDS;
    this.elapsed = 0;
    this.winner = null;
    this.skillCooldowns = [makeCooldowns(), makeCooldowns()];
    this.projectiles = [];
    this.events = [];
    this.previous = [{ ...NEUTRAL_INPUT }, { ...NEUTRAL_INPUT }];
    this.connected = [false, false];
    this.skillSpawned = [false, false];
    this.attackRate = [1, 1];
    this.nextProjectileId = 1;
  }

  /** Invalid dt is ignored; positive dt is capped at .1s and safely subdivided. */
  step(dt: number, inputs: [FightInput, FightInput]): void {
    this.events = [];
    if (this.winner !== null || !Number.isFinite(dt) || dt <= 0) return;
    if (this.finishIfNeeded()) return;

    const clean: [FightInput, FightInput] = [cleanInput(inputs[0]), cleanInput(inputs[1])];
    let pressed: [Edges, Edges] = [edges(clean[0], this.previous[0]), edges(clean[1], this.previous[1])];
    this.previous = clean;
    let remaining = Math.min(dt, 0.1, this.timeLeft);
    while (remaining > EPSILON && this.winner === null) {
      const slice = Math.min(remaining, PHYSICS_STEP);
      this.tick(slice, clean, pressed);
      remaining -= slice;
      pressed = [NO_EDGES, NO_EDGES];
    }
  }

  getSnapshot(): {
    fighters: [FighterState, FighterState];
    timeLeft: number;
    elapsed: number;
    winner: Seat | 'draw' | null;
    events: FightEvent[];
    skillCooldowns: [SkillCooldowns, SkillCooldowns];
    projectiles: FightProjectile[];
  } {
    return {
      fighters: [{ ...this.fighters[0] }, { ...this.fighters[1] }],
      timeLeft: this.timeLeft,
      elapsed: this.elapsed,
      winner: this.winner,
      events: this.events.map(event => ({ ...event })),
      skillCooldowns: [{ ...this.skillCooldowns[0] }, { ...this.skillCooldowns[1] }],
      projectiles: this.projectiles.map(projectile => ({ ...projectile })),
    };
  }

  private setAction(fighter: FighterState, action: FightAction): void {
    if (fighter.action === action) return;
    fighter.action = action;
    fighter.actionTime = 0;
    fighter.serial += 1;
  }

  /** Face the movement direction while grounded and moving; otherwise face the opponent. */
  private autoFace(seat: Seat, input: FightInput): void {
    const fighter = this.fighters[seat];
    // Attacks, skills, knockdowns and held guards commit to their facing.
    if (isLocked(fighter.action) || (fighter.action === 'guard' && input.guard)) return;
    let desired: 1 | -1;
    if (fighter.y === 0 && input.move !== 0) {
      desired = input.move > 0 ? 1 : -1;
    } else {
      const dx = this.fighters[seat === 0 ? 1 : 0].x - fighter.x;
      if (Math.abs(dx) < EPSILON) return;
      desired = dx > 0 ? 1 : -1;
    }
    if (desired === fighter.facing) return;
    fighter.facing = desired;
    // Never restart an in-progress turn, even if the direction changes again.
    if (fighter.y === 0 && !isTurn(fighter.action)) {
      this.setAction(fighter, desired === 1 ? 'turn' : 'turnAlt');
    }
  }

  /** Attacks and skills always commit to facing the opponent at their start. */
  private faceTarget(seat: Seat): void {
    const fighter = this.fighters[seat];
    const dx = this.fighters[seat === 0 ? 1 : 0].x - fighter.x;
    if (Math.abs(dx) > EPSILON) fighter.facing = dx > 0 ? 1 : -1;
  }

  private locomotion(input: FightInput): FightAction {
    return input.move === 0 ? 'idle' : input.run ? 'run' : 'walk';
  }

  private castSkill(seat: Seat, skill: FightSkill): void {
    const fighter = this.fighters[seat];
    if (skill === 'dog') {
      if (fighter.rage < RAGE_MAX) return;
      fighter.rage = 0;
    }
    this.faceTarget(seat);
    this.setAction(fighter, SKILLS[skill].action);
    this.skillCooldowns[seat][skill] = SKILL_COOLDOWNS[skill];
    this.skillSpawned[seat] = false;
    this.connected[seat] = false;
    this.events.push({ kind: 'skillCast', seat, damage: 0, skill });
  }

  private advanceFighter(seat: Seat, dt: number, input: FightInput, pressed: Edges): void {
    const fighter = this.fighters[seat];
    if (fighter.actionTime + EPSILON >= duration(fighter.action, fighter.downDuration)) {
      this.setAction(fighter, fighter.y > 0 ? 'jump' : 'idle');
    }
    // KOF-style chain: a landed swing can be cancelled into the next one during recovery.
    if (isAttack(fighter.action) && this.connected[seat] && fighter.y === 0
      && fighter.actionTime + EPSILON >= ATTACKS[fighter.action].startup + ATTACKS[fighter.action].active
      && (pressed.heavy || pressed.light)) {
      this.faceTarget(seat);
      this.attackRate[seat] = attackSpeed(fighter.combo);
      this.setAction(fighter, pressed.heavy ? 'slashAlt' : 'slash');
      this.connected[seat] = false;
      this.events.push({ kind: 'swing', seat, damage: 0 });
    }
    if (!isLocked(fighter.action)) {
      this.autoFace(seat, input);
      const skill = fighter.y === 0
        ? pressed.skills.find(kind => this.skillCooldowns[seat][kind] <= EPSILON
          && (kind !== 'dog' || fighter.rage >= RAGE_MAX))
        : undefined;
      if (skill) {
        this.castSkill(seat, skill);
      } else if (pressed.heavy || pressed.light) {
        this.faceTarget(seat);
        this.attackRate[seat] = attackSpeed(fighter.combo);
        this.setAction(fighter, pressed.heavy ? 'slashAlt' : 'slash');
        this.connected[seat] = false;
        this.events.push({ kind: 'swing', seat, damage: 0 });
      } else if (pressed.jump && fighter.y === 0) {
        fighter.vy = JUMP_SPEED;
        // A running takeoff adds ballistic momentum so the jump travels farther.
        fighter.vx = input.run && input.move !== 0 ? input.move * RUN_JUMP_BOOST : 0;
        const opponent = this.fighters[seat === 0 ? 1 : 0];
        const backward = input.move !== 0 && input.move * (opponent.x - fighter.x) < 0;
        this.setAction(fighter, backward ? 'jumpBack' : 'jump');
      } else if (input.guard && fighter.y === 0) {
        this.setAction(fighter, 'guard');
      } else if (fighter.y > 0) {
        if (fighter.action !== 'jumpBack') this.setAction(fighter, 'jump');
      } else if (!isTurn(fighter.action)) {
        this.setAction(fighter, this.locomotion(input));
      }
      if (!isAttack(fighter.action) && !isSkillAction(fighter.action) && fighter.action !== 'guard') {
        const speed = input.move * (input.run ? RUN_SPEED : WALK_SPEED) + (fighter.y > 0 ? fighter.vx : 0);
        fighter.x = clamp(fighter.x + speed * dt, -LIMIT, LIMIT);
      }
    }

    if (fighter.y > 0 || fighter.vy > 0) {
      fighter.y += fighter.vy * dt - 0.5 * GRAVITY * dt * dt;
      fighter.vy -= GRAVITY * dt;
      fighter.vx -= fighter.vx * Math.min(1, dt * 2.5);
      // Locked airborne bodies (launched knockdowns) still travel with their momentum.
      if (isLocked(fighter.action)) fighter.x = clamp(fighter.x + fighter.vx * dt, -LIMIT, LIMIT);
      if (fighter.y <= 0) {
        fighter.y = 0;
        fighter.vy = 0;
        fighter.vx = 0;
        if (fighter.action === 'jump' || fighter.action === 'jumpBack') {
          this.setAction(fighter, this.locomotion(input));
        }
      }
    }
    // Combo stacks accelerate the swing frozen at its takeoff; everything else runs at real time.
    fighter.actionTime += dt * (isAttack(fighter.action) ? this.attackRate[seat] : 1);
  }

  private separate(leftSeat: Seat): void {
    const left = this.fighters[leftSeat];
    const right = this.fighters[leftSeat === 0 ? 1 : 0];
    // Grounded bodies cannot cross; airborne bodies may pass and land on either side.
    if (left.y > 0 || right.y > 0 || right.x - left.x >= SEPARATION) return;
    const middle = clamp((left.x + right.x) / 2, -LIMIT + SEPARATION / 2, LIMIT - SEPARATION / 2);
    left.x = middle - SEPARATION / 2;
    right.x = middle + SEPARATION / 2;
  }

  private spawnSkill(seat: Seat, skill: FightSkill): void {
    const fighter = this.fighters[seat];
    const spec = SKILLS[skill];
    const spawn = (y: number, z: number, speedScale = 1): void => {
      this.projectiles.push({
        id: this.nextProjectileId++,
        owner: seat,
        skill,
        x: fighter.x + fighter.facing * (skill === 'volley' ? 0.7 : skill === 'dog' ? 0.8 : 0.55),
        y,
        z,
        vx: fighter.facing * spec.speed * speedScale,
        radius: spec.radius,
        damage: spec.damage,
        spin: 0,
        life: 2.2,
      });
    };
    if (skill === 'volley') {
      const heights = [0.36, 0.66, 0.96, 1.26, 1.56];
      const depths = [-0.28, -0.14, 0, 0.14, 0.28];
      heights.forEach((y, index) => spawn(y, depths[index]!, 1 - index * 0.015));
    } else {
      spawn(spec.height, 0);
    }
  }

  private breakCombo(fighter: FighterState): void {
    fighter.combo = 0;
    fighter.comboTimer = 0;
  }

  private updateProjectiles(dt: number): void {
    const remaining: FightProjectile[] = [];
    for (const projectile of this.projectiles) {
      projectile.x += projectile.vx * dt;
      projectile.spin += dt * 9;
      projectile.life -= dt;
      const target = this.fighters[projectile.owner === 0 ? 1 : 0];
      const targetSeat: Seat = projectile.owner === 0 ? 1 : 0;
      const dx = target.x - projectile.x;
      const targetCenter = target.y + 0.9;
      const horizontal = Math.abs(dx) <= projectile.radius + 0.36;
      // Skills 3 and the ultimate ignore height; skills 1/2 miss a target that has jumped high enough.
      const dodgeable = projectile.skill === 'ball' || projectile.skill === 'cat';
      const vertical = Math.abs(targetCenter - projectile.y) <= 0.95;
      const dodged = dodgeable && target.y > DODGE_HEIGHT;
      if (horizontal && !dodged && (!dodgeable || vertical)) {
        target.hp = Math.max(0, target.hp - projectile.damage);
        this.breakCombo(target);
        // Every skill knocks the target down; the dog also launches it and extends the stun.
        target.downDuration = projectile.skill === 'dog' ? STUN_DURATION : DOWN_DURATION;
        if (projectile.skill === 'dog') {
          target.y = Math.max(target.y, 0.01);
          target.vy = 6.5;
          target.vx = Math.sign(projectile.vx) * 4.5;
        }
        target.action = 'down';
        target.actionTime = 0;
        target.serial += 1;
        this.events.push({ kind: 'down', seat: targetSeat, damage: projectile.damage, skill: projectile.skill, x: projectile.x, y: projectile.y });
        this.events.push({
          kind: 'skillHit', seat: targetSeat, damage: projectile.damage,
          skill: projectile.skill, x: projectile.x, y: projectile.y, projectileId: projectile.id,
        });
        continue;
      }
      if (projectile.life > 0 && Math.abs(projectile.x) < LIMIT + 2.5) remaining.push(projectile);
    }
    this.projectiles = remaining;
  }

  private tick(dt: number, inputs: [FightInput, FightInput], pressed: [Edges, Edges]): void {
    const [first, second] = this.fighters;
    const wereGrounded = first.y === 0 && second.y === 0;
    const oldLeft: Seat = first.x <= second.x ? 0 : 1;
    for (const seat of SEATS) this.advanceFighter(seat, dt, inputs[seat], pressed[seat]);
    this.separate(wereGrounded ? oldLeft : first.x <= second.x ? 0 : 1);
    for (const seat of SEATS) this.autoFace(seat, inputs[seat]);

    for (const seat of SEATS) {
      const fighter = this.fighters[seat];
      if (!isSkillAction(fighter.action) || this.skillSpawned[seat]) continue;
      const skill = SKILL_BY_ACTION[fighter.action];
      if (fighter.actionTime + EPSILON >= SKILLS[skill].spawn) {
        this.skillSpawned[seat] = true;
        this.spawnSkill(seat, skill);
      }
    }

    // Read both attacks before committing either hit: trades and double KOs are symmetric.
    const contacts: { attacker: Seat; target: Seat; damage: number; blocked: boolean; heavy: boolean }[] = [];
    for (const seat of SEATS) {
      const fighter = this.fighters[seat];
      if (!isAttack(fighter.action) || this.connected[seat]) continue;
      const attack = ATTACKS[fighter.action];
      if (fighter.actionTime + EPSILON < attack.startup || fighter.actionTime >= attack.startup + attack.active) continue;
      const targetSeat = seat === 0 ? 1 : 0;
      const target = this.fighters[targetSeat];
      const dx = target.x - fighter.x;
      if (dx * fighter.facing <= 0 || Math.abs(dx) > attack.reach || Math.abs(target.y - fighter.y) >= 0.85) continue;
      const blocked = target.action === 'guard' && -dx * target.facing > 0;
      contacts.push({
        attacker: seat, target: targetSeat, damage: blocked ? attack.chip : attack.damage,
        blocked, heavy: fighter.action === 'slashAlt',
      });
    }
    for (const contact of contacts) {
      this.connected[contact.attacker] = true;
      const attacker = this.fighters[contact.attacker];
      attacker.hits += 1;
      const target = this.fighters[contact.target];
      target.hp = Math.max(0, target.hp - contact.damage);
      this.events.push({ kind: contact.blocked ? 'block' : 'hit', seat: contact.target, damage: contact.damage });
      if (!contact.blocked) {
        // A clean hit builds the attacker's combo and breaks the recipient's.
        attacker.combo = Math.min(COMBO_MAX, attacker.combo + 1);
        attacker.comboTimer = COMBO_WINDOW;
        this.breakCombo(target);
        if (attacker.combo >= COMBO_KNOCKDOWN) {
          // The third consecutive hit knocks the target down and resets the chain.
          this.breakCombo(attacker);
          target.downDuration = DOWN_DURATION;
          target.action = 'down';
          target.actionTime = 0;
          target.serial += 1;
          this.events.push({ kind: 'down', seat: contact.target, damage: contact.damage, x: target.x, y: target.y });
        } else {
          // A fresh hit restarts stun even when its animation variant is unchanged.
          target.action = contact.heavy ? 'impactAlt' : 'impact';
          target.actionTime = 0;
          target.serial += 1;
        }
      } else {
        // A successful guard refunds skill cooldowns and builds the defender's rage.
        target.rage = Math.min(RAGE_MAX, target.rage + GUARD_RAGE_GAIN);
        for (const skill of SKILL_ORDER) {
          this.skillCooldowns[contact.target][skill] = Math.max(0, this.skillCooldowns[contact.target][skill] - GUARD_COOLDOWN_REFUND);
        }
      }
    }

    this.updateProjectiles(dt);

    this.elapsed = Math.min(ROUND_SECONDS, this.elapsed + dt);
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    for (const seat of SEATS) {
      const fighter = this.fighters[seat];
      if (fighter.combo > 0) {
        fighter.comboTimer -= dt;
        if (fighter.comboTimer <= 0) this.breakCombo(fighter);
      }
      for (const skill of SKILL_ORDER) {
        this.skillCooldowns[seat][skill] = Math.max(0, this.skillCooldowns[seat][skill] - dt);
      }
    }
    if (this.timeLeft < EPSILON) {
      this.timeLeft = 0;
      this.elapsed = ROUND_SECONDS;
    }
    this.finishIfNeeded();
  }

  private finishIfNeeded(): boolean {
    const [first, second] = this.fighters;
    if (first.hp > 0 && second.hp > 0 && this.timeLeft > 0) return false;
    if (this.winner !== null) return true;
    this.winner = first.hp === second.hp ? 'draw' : first.hp > second.hp ? 0 : 1;
    for (const fighter of this.fighters) {
      if (fighter.hp <= 0) this.setAction(fighter, 'ko');
    }
    this.events.push({ kind: 'end', seat: this.winner === 'draw' ? 0 : this.winner, damage: 0 });
    return true;
  }
}

/** Deterministic seat-1 opponent; 1.7s rhythm provides attack pulses and recovery gaps. */
export function aiInput(sim: FightSimulation): FightInput {
  const input = { ...NEUTRAL_INPUT };
  const [opponent, fighter] = sim.fighters;
  if (sim.winner !== null || isLocked(fighter.action)) return input;
  const dx = opponent.x - fighter.x;
  const distance = Math.abs(dx);
  const cycle = Math.floor((sim.elapsed + EPSILON) / 1.7);
  const phase = sim.elapsed - cycle * 1.7;
  if (fighter.rage >= RAGE_MAX && distance > 1.2) {
    return { ...input, skills: ['dog'] };
  }
  if (distance > 1.4) {
    input.move = dx > 0 ? 1 : -1;
    input.run = distance > 2.2;
    return input;
  }
  if (phase >= 0.28 && phase < 0.4) {
    input.light = cycle % 2 === 0;
    input.heavy = !input.light;
  } else {
    input.guard = fighter.y === 0 && (phase >= 1.3 || (cycle % 3 === 2 && isAttack(opponent.action)));
  }
  return input;
}