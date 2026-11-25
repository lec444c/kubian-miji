import { describe, expect, it } from 'vitest';
import { createBall } from '../../src/sim/SimulationState';
import { groupAssignmentText, groupBallIds, pocketedBallIds, turnTargetText } from '../../src/ui/ballStatus';
import { createInitialRuleState, prepareShot, resolveChineseEight } from '../../src/rules/ruleTypes';
import { createRackedSimulation } from '../../src/sim/rack';
import type { ShotOutcome } from '../../src/sim/ShotOutcome';

describe('入袋球状态与目标提示', () => {
  it('独立于分球状态显示准确球号、白球与黑球，并保持排序', () => {
    const balls = [9, 0, 8, 2, 1].map(id => createBall(id, { x: 0, y: 0 }));
    for (const ball of balls) if (ball.id !== 1) { ball.pocketed = true; ball.onTable = false; }
    expect(pocketedBallIds(balls)).toEqual([0, 2, 8, 9]);
  });
  it('复位球和飞出台面但未入袋的球不计入，重开后清空', () => {
    const restored = { ...createBall(8, { x: 0, y: 0 }), pocketed: true };
    const flying = { ...createBall(2, { x: 0, y: 0 }), onTable: false };
    expect(pocketedBallIds([restored, flying])).toEqual([]);
    expect(pocketedBallIds(createRackedSimulation(1).state.balls)).toEqual([]);
  });
  it('全色与花色号码准确，不按入袋数量猜测球号', () => {
    expect(groupBallIds('solids')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(groupBallIds('stripes')).toEqual([9, 10, 11, 12, 13, 14, 15]);
  });
  it('首次分球提示双方，后续球权切换不会重复公告', () => {
    const first = groupAssignmentText([null, null], ['stripes', 'solids'], true);
    expect(first).toBe('分球已确定：你（甲方）击打花色球（9–15号）；电脑（乙方）击打全色球（1–7号）。');
    expect(groupAssignmentText(['stripes', 'solids'], ['stripes', 'solids'], true)).toBeNull();
    expect(groupAssignmentText([null, null], [null, null], false)).toBeNull();
    expect(groupAssignmentText([null, null], ['solids', null], false)).toBeNull();
  });
  it('未分球、开球、分球后及清台后的目标提示准确', () => {
    expect(turnTargetText(0, null, 7, true, true)).toContain('开球进球不分组');
    expect(turnTargetText(0, null, 7, true, false)).toContain('尚未分球');
    expect(turnTargetText(1, 'stripes', 5, false, false)).toBe('乙方目标：花色球（9–15号）');
    expect(turnTargetText(0, 'solids', 0, true, false)).toBe('你（甲方）目标：8号球');
  });
});

describe('公告遵循真实规则结算', () => {
  it('浏览器分球场景在四十种摆球种子下均进1号球且不洗袋', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sim = createRackedSimulation(seed);
      sim.state.balls.find(ball => ball.id === 0)!.position = { x: 0, y: 0.13 };
      sim.state.balls.find(ball => ball.id === 1)!.position = { x: 0, y: 0.46 };
      const result = sim.strike(Math.PI / 2, 0.11);
      sim.runUntilStopped();
      expect(result.pocketed.map(ball => ball.ballId)).toEqual([1]);
      expect(result.cueScratch).toBe(false);
      expect(result.firstContact).toBe(1);
    }
  });
  function resolve(ids: number[], isBreak: boolean, scratch = false) {
    const simulation = createRackedSimulation(1);
    const state = createInitialRuleState();
    state.isBreak = isBreak;
    const before = prepareShot({ state, simulation: simulation.state });
    const pocketed = [...ids, ...(scratch ? [0] : [])];
    for (const ball of simulation.state.balls) if (pocketed.includes(ball.id)) { ball.pocketed = true; ball.onTable = false; }
    const outcome: ShotOutcome = {
      shotId: 1, shooter: 0, firstContact: ids[0] ?? 1,
      pocketed: pocketed.map((ballId, index) => ({ ballId, pocketId: 0, step: index + 1 })),
      cushionContacts: [], cushionAfterContact: false, flewOffTable: [], cueScratch: scratch,
      anyBallMoved: true, startedStep: 0, endedStep: 20,
    };
    const result = resolveChineseEight({ ...before, simulation: simulation.state }, outcome);
    return groupAssignmentText(state.groups, result.state.groups, false);
  }
  it('合法非开球单色进球产生首次分球公告', () => { expect(resolve([3], false)).toContain('甲方击打全色球'); });
  it('开球、混合进球与犯规都不会错误宣布分组', () => {
    expect(resolve([3], true)).toBeNull();
    expect(resolve([3, 12], false)).toBeNull();
    expect(resolve([3], false, true)).toBeNull();
  });
});
