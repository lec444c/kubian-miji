import { Simulation } from './Simulation';
import { BALL_RADIUS, TABLE_HALF_X, createBall, type BallState, type Vec2 } from './SimulationState';

// Rack geometry and constraints are adapted from
// third_party/tailuge-billiards/src/utils/rack.ts (GPLv3, reuse approved).

function randomGenerator(seed: number): () => number {
  let value = (Number.isFinite(seed) ? seed : 0) >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values: number[], random: () => number): number[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Return a deterministic, non-overlapping standard fifteen-ball triangle. */
export function createRack(seed = 0): BallState[] {
  const random = randomGenerator(seed);
  const gap = BALL_RADIUS * 2 + 0.0004;
  const rowAdvance = (Math.sqrt(3) / 2) * gap;
  const apexX = TABLE_HALF_X / 2;
  const positions: Vec2[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      positions.push({
        x: apexX + row * rowAdvance,
        y: (column - row / 2) * gap,
      });
    }
  }

  const labels = Array<number>(15).fill(0);
  labels[0] = 1; // Conventional apex ball.
  labels[4] = 8; // Centre of the third row.
  const backLeftIsSolid = random() < 0.5;
  labels[10] = backLeftIsSolid ? 2 : 9;
  labels[14] = backLeftIsSolid ? 9 : 2;

  const solids = shuffle([3, 4, 5, 6, 7], random);
  const stripes = shuffle([10, 11, 12, 13, 14, 15], random);
  let solidIndex = 0;
  let stripeIndex = 0;
  for (let i = 1; i < labels.length; i += 1) {
    if (labels[i] !== 0) continue;
    // Alternating pools avoid accidental all-solid/all-stripe regions while
    // retaining seeded variation and the required opposite-group back corners.
    if ((i % 2 === 0 && solidIndex < solids.length) || stripeIndex >= stripes.length) {
      labels[i] = solids[solidIndex++]!;
    } else {
      labels[i] = stripes[stripeIndex++]!;
    }
  }

  const balls = [createBall(0, { x: -TABLE_HALF_X / 2, y: 0 })];
  for (let i = 0; i < positions.length; i += 1) {
    balls.push(createBall(labels[i]!, positions[i]!));
  }
  return balls.sort((a, b) => a.id - b.id);
}

export function createRackedSimulation(seed = 0): Simulation {
  return new Simulation({ balls: createRack(seed), step: 0, braking: [] });
}
