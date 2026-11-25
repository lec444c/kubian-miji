import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputController } from '../../src/view/InputController';
import type { SceneView } from '../../src/view/SceneView';

// Node EventTarget is enough: no renderer, DOM dependency, or browser required.
class FakeCanvas extends EventTarget {
  setPointerCapture = vi.fn();
}
class FakeInput extends EventTarget {}

function emit(target: EventTarget, type: string, properties: Record<string, unknown> = {}): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), properties);
  target.dispatchEvent(event);
  return event;
}

function setup() {
  const windowTarget = new EventTarget();
  const canvas = new FakeCanvas();
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('HTMLInputElement', FakeInput);
  const view = {
    renderer: { domElement: canvas },
    screenToTable: vi.fn(() => ({ x: 0.1, y: 0.2 })),
    pickBall: vi.fn(() => null),
    orbit: vi.fn(), zoomCamera: vi.fn(), adjustCamera: vi.fn(), resetCamera: vi.fn(),
  };
  const callbacks = {
    onAim: vi.fn(), onTableClick: vi.fn(), onBallClick: vi.fn(),
    onChargeCancel: vi.fn(), onCamera: vi.fn(), onNudgeAim: vi.fn(),
    onFineAim: vi.fn(), onNudgeSpin: vi.fn(), onKeyMove: vi.fn(),
    onPlaceConfirm: vi.fn(), onToggleLock: vi.fn(),
    cueLocked: vi.fn(() => false),
    strikeBackDirection: vi.fn(() => ({ x: 0, y: 1 })),
    onStrikeDragStart: vi.fn(() => true), onStrikeDrag: vi.fn(), onStrikeDragEnd: vi.fn(),
    placingActive: vi.fn(() => false), onPlaceDrag: vi.fn(),
  };
  const controller = new InputController(view as unknown as SceneView, callbacks);
  const key = (type: 'keydown' | 'keyup', code = 'Space', repeat = false): Event =>
    emit(windowTarget, type, { code, repeat, altKey: false, shiftKey: false });
  const pointer = (type: string, y: number): Event =>
    emit(canvas, type, { button: 0, pointerId: 1, clientX: 100, clientY: y, shiftKey: false });
  return { controller, windowTarget, canvas, callbacks, key, pointer };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('InputController: Space confirms placement, never charges or strikes', () => {
  it('long-held/repeated/released Space while aiming dispatches no gameplay action', () => {
    vi.useFakeTimers();
    const { callbacks, key } = setup();
    expect(key('keydown').defaultPrevented).toBe(false);
    vi.advanceTimersByTime(60_000);
    for (let i = 0; i < 20; i++) expect(key('keydown', 'Space', true).defaultPrevented).toBe(false);
    expect(key('keyup').defaultPrevented).toBe(false);
    for (const [name, callback] of Object.entries(callbacks)) {
      if (name.startsWith('on')) expect(callback, name).not.toHaveBeenCalled();
    }
  });

  it('only confirms active placement once, never on repeat or release', () => {
    const { callbacks, key } = setup();
    // Even if a rejected placement stays active, auto-repeat cannot reconfirm it.
    callbacks.placingActive.mockReturnValue(true);
    expect(key('keydown').defaultPrevented).toBe(true);
    expect(callbacks.onPlaceConfirm).toHaveBeenCalledTimes(1);
    expect(key('keydown', 'Space', true).defaultPrevented).toBe(true);
    key('keyup');
    expect(callbacks.onPlaceConfirm).toHaveBeenCalledTimes(1);
    // After a successful placement, holding/releasing Space cannot start a shot.
    callbacks.placingActive.mockReturnValue(false);
    key('keydown', 'Space', true);
    key('keyup');
    key('keydown');
    expect(callbacks.onPlaceConfirm).toHaveBeenCalledTimes(1);
    expect(callbacks.onStrikeDragStart).not.toHaveBeenCalled();
    expect(callbacks.onStrikeDragEnd).not.toHaveBeenCalled();
  });

  it('does not confirm when placement is inactive (including blocked placement states)', () => {
    const { callbacks, key } = setup();
    key('keydown');
    key('keyup');
    expect(callbacks.onPlaceConfirm).not.toHaveBeenCalled();
  });

  it('retains Enter placement confirmation without intercepting native Enter activation', () => {
    const { callbacks, key } = setup();
    callbacks.placingActive.mockReturnValue(true);
    expect(key('keydown', 'Enter').defaultPrevented).toBe(false);
    key('keydown', 'Enter', true);
    key('keyup', 'Enter');
    expect(callbacks.onPlaceConfirm).toHaveBeenCalledTimes(1);
  });

  it('Space leaves mouse charge intact and only mouse release ends the stroke', () => {
    const { callbacks, key, pointer } = setup();
    pointer('pointerdown', 100);
    pointer('pointermove', 210);
    expect(callbacks.onStrikeDragStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onStrikeDrag).toHaveBeenLastCalledWith(0.5);
    key('keydown');
    key('keydown', 'Space', true);
    key('keyup');
    expect(callbacks.onChargeCancel).not.toHaveBeenCalled();
    expect(callbacks.onPlaceConfirm).not.toHaveBeenCalled();
    expect(callbacks.onStrikeDragEnd).not.toHaveBeenCalled();
    expect(callbacks.onStrikeDrag).toHaveBeenCalledTimes(1);
    pointer('pointermove', 265);
    expect(callbacks.onStrikeDrag).toHaveBeenLastCalledWith(0.75);
    pointer('pointerup', 265);
    pointer('pointerup', 265);
    expect(callbacks.onStrikeDragEnd).toHaveBeenCalledExactlyOnceWith(true);
  });

  it.each(['Escape', 'blur', 'pointercancel'])('%s cancels mouse charge and later release cannot strike', cancel => {
    const { windowTarget, canvas, callbacks, key, pointer } = setup();
    pointer('pointerdown', 100);
    pointer('pointermove', 210);
    if (cancel === 'Escape') key('keydown', cancel);
    else emit(cancel === 'blur' ? windowTarget : canvas, cancel);
    expect(callbacks.onStrikeDragEnd).toHaveBeenCalledExactlyOnceWith(false);
    key('keyup');
    pointer('pointerup', 210);
    expect(callbacks.onStrikeDragEnd).toHaveBeenCalledTimes(1);
    expect(callbacks.onTableClick).not.toHaveBeenCalled();
  });

  it('reset discards a held gesture so release across menus cannot strike or click', () => {
    const { controller, callbacks, pointer } = setup();
    pointer('pointerdown', 100);
    pointer('pointermove', 210);
    expect(callbacks.onStrikeDragStart).toHaveBeenCalledTimes(1);
    controller.reset();
    pointer('pointerup', 210);
    expect(callbacks.onStrikeDragEnd).not.toHaveBeenCalled();
    expect(callbacks.onTableClick).not.toHaveBeenCalled();
    pointer('pointerdown', 100);
    pointer('pointermove', 210);
    pointer('pointerup', 210);
    expect(callbacks.onStrikeDragEnd).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('left-drag placement remains separate from charging, with Space confirmation', () => {
    const { callbacks, key, pointer } = setup();
    callbacks.placingActive.mockReturnValue(true);
    pointer('pointerdown', 100);
    pointer('pointermove', 210);
    pointer('pointerup', 210);
    expect(callbacks.onPlaceDrag).toHaveBeenCalledTimes(2);
    expect(callbacks.onStrikeDragStart).not.toHaveBeenCalled();
    expect(callbacks.onStrikeDragEnd).not.toHaveBeenCalled();
    key('keydown');
    expect(callbacks.onPlaceConfirm).toHaveBeenCalledTimes(1);
  });
});
