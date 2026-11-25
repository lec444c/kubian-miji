import { describe, expect, it } from 'vitest';
import { tabletopCameraFrame, FIGHT_WORLD_SCALE, FIGHT_SURFACE_Y, TABLETOP_BOUNDS } from '../../src/fight/TabletopArena';
import { TABLE_WORLD_SCALE } from '../../src/view/SittingRoom';

// The frame keeps the cloth edge in view: edge = (CUSHION_HALF_X + 0.25) * TABLE_WORLD_SCALE.
const EDGE = TABLETOP_BOUNDS.halfX + 0.25 * TABLE_WORLD_SCALE;
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

describe('桌面格斗镜头', () => {
  it.each([1280 / 520, 1024 / 430, 844 / 189, 390 / 468])('宽高比 %s 下两角色均在取景内且镜头随人物平移', aspect => {
    for (const [left, right] of [[-1.3, 1.3], [-4.6, 4.6], [-4.6, -4], [4, 4.6], [-2, -1]]) {
      const frame = tabletopCameraFrame(aspect, left!, right!, false);
      expect(frame.width / frame.height).toBeCloseTo(aspect, 6);
      // Closer than the old whole-table framing: a 1.7 m minimum height.
      expect(frame.height).toBeGreaterThanOrEqual(1.7);
      // Both fighter centres plus a body margin stay inside the frame.
      for (const x of [left!, right!]) {
        expect(Math.abs(x * FIGHT_WORLD_SCALE - frame.centerX) + 0.3).toBeLessThan(frame.width / 2);
      }
      expect(frame.targetY).toBeGreaterThan(FIGHT_SURFACE_Y);
      // The centre pans with the fighters, clamped so the cloth edge never leaves view.
      const pan = Math.max(0, EDGE - frame.width / 2);
      const middle = (left! + right!) / 2 * FIGHT_WORLD_SCALE;
      expect(frame.centerX).toBeCloseTo(clamp(middle, -pan, pan), 10);
    }
  });

  it('对称站位居中，单侧站位向该侧平移', () => {
    expect(tabletopCameraFrame(1280 / 520, -1.3, 1.3, false).centerX).toBeCloseTo(0, 10);
    expect(tabletopCameraFrame(390 / 468, -4.6, -4, false).centerX).toBeLessThan(0);
    expect(tabletopCameraFrame(390 / 468, 4, 4.6, false).centerX).toBeGreaterThan(0);
  });

  it('预览不受实战位置影响且输入宽高比无效时仍可取景', () => {
    expect(tabletopCameraFrame(1, -4.6, -4, true)).toEqual(tabletopCameraFrame(1, 4, 4.6, true));
    for (const aspect of [0, -1, NaN, Infinity]) {
      const frame = tabletopCameraFrame(aspect, 0, 0, false);
      expect(frame.width).toBe(frame.height);
      expect(Number.isFinite(frame.width)).toBe(true);
    }
  });
});