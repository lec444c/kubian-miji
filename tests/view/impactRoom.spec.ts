import { describe, expect, it, vi } from 'vitest';
import { createImpactRoomImpulse, IMPACT_ROOM } from '../../src/view/impactRoom';

const energy = (samples: Float32Array): number => samples.reduce((sum, value) => sum + value * value, 0);
const absoluteSum = (samples: Float32Array): number => samples.reduce((sum, value) => sum + Math.abs(value), 0);

describe('impact room parameters and deterministic impulse', () => {
  it('短房间、克制干湿比和静态余量，不靠压缩改变瞬态', () => {
    expect(IMPACT_ROOM.duration).toBe(0.30);
    expect(IMPACT_ROOM.preDelay).toBeGreaterThanOrEqual(0.015);
    expect(IMPACT_ROOM.preDelay).toBeLessThanOrEqual(0.020);
    expect(IMPACT_ROOM.wet).toBeGreaterThanOrEqual(0.10);
    expect(IMPACT_ROOM.wet).toBeLessThanOrEqual(0.15);
    expect(IMPACT_ROOM.dry + IMPACT_ROOM.wet).toBeCloseTo(1);
    expect(IMPACT_ROOM.headroom).toBeGreaterThan(0);
    // EQ's +3 dB maximum boost still leaves nominal single-impact headroom.
    // This is not a claim that arbitrary overlapping sources cannot clip.
    expect(IMPACT_ROOM.headroom * 10 ** (IMPACT_ROOM.presence.gain / 20)).toBeLessThan(0.92);
    expect(IMPACT_ROOM.lowShelf).toEqual({ frequency: 250, gain: -4 });
    expect(IMPACT_ROOM.presence).toEqual({ frequency: 2400, gain: 3, Q: 0.8 });
    expect(Object.isFrozen(IMPACT_ROOM)).toBe(true);
    expect(Object.isFrozen(IMPACT_ROOM.lowShelf)).toBe(true);
    expect(Object.isFrozen(IMPACT_ROOM.presence)).toBe(true);
  });

  it.each([8000, 22050, 44100, 48000, 96000, 192000])(
    '%s Hz 下长 0.30s，前 18ms 无湿声，双声道有限、去相关且衰减至零', sampleRate => {
      const channels = createImpactRoomImpulse(sampleRate);
      expect(channels).toHaveLength(2);
      expect(channels[0]).not.toEqual(channels[1]);
      for (const data of channels) {
        expect(data.length).toBe(Math.ceil(sampleRate * IMPACT_ROOM.duration));
        expect(data.every(Number.isFinite)).toBe(true);
        const firstReflection = data.findIndex(value => value !== 0);
        expect(firstReflection / sampleRate).toBeGreaterThanOrEqual(0.018);
        expect(firstReflection / sampleRate).toBeLessThan(0.020);
        expect(data.slice(0, Math.ceil(sampleRate * IMPACT_ROOM.preDelay)).every(value => value === 0)).toBe(true);
        expect(data.at(-1)).toBe(0);
        expect(data.filter(value => value !== 0)).toHaveLength(24);
        const sum = absoluteSum(data);
        expect(sum).toBeLessThanOrEqual(1);
        expect(sum).toBeGreaterThan(0.99999);
        const first = energy(data.slice(0, Math.floor(sampleRate * 0.1)));
        const middle = energy(data.slice(Math.floor(sampleRate * 0.1), Math.floor(sampleRate * 0.2)));
        const last = energy(data.slice(Math.floor(sampleRate * 0.2)));
        expect(first).toBeGreaterThan(0);
        expect(middle).toBeGreaterThan(0);
        expect(last).toBeGreaterThan(0);
        expect(middle).toBeLessThan(first * 0.05);
        expect(last).toBeLessThan(middle * 0.01);
        expect(Math.abs(data.filter(value => value !== 0).at(-1)!)).toBeLessThan(0.0001);
      }
    },
  );

  it('生成结果逐采样确定且独立，不消费音乐洗牌使用的 Math.random', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('No global RNG'); });
    try {
      const first = createImpactRoomImpulse(48000);
      const second = createImpactRoomImpulse(48000);
      expect(first).toEqual(second);
      expect(first[0]).not.toBe(second[0]);
      expect(first[1]).not.toBe(second[1]);
      first[0].fill(0);
      expect(energy(second[0])).toBeGreaterThan(0);
      expect(energy(first[1])).toBeGreaterThan(0);
      expect(random).not.toHaveBeenCalled();
    } finally { random.mockRestore(); }
  });

  it.each([NaN, Infinity, -Infinity, -1, 0, 7999, 192001])('拒绝非法采样率 %s，避免无界分配', sampleRate => {
    expect(() => createImpactRoomImpulse(sampleRate)).toThrow(RangeError);
  });
});
