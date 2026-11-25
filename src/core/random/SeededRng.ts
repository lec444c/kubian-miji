export class SeededRng {
  private state: number;

  constructor(seed = Date.now()) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  next(): number {
    let t = this.state += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number { return min + (max - min) * this.next(); }
  integer(maxExclusive: number): number { return Math.floor(this.next() * maxExclusive); }

  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.integer(i + 1);
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  }

  getState(): number { return this.state >>> 0; }
}
