import type { Seat } from './matchTypes';

export interface BaseCommand { seat: Seat; revision: number }
export interface StrikeCommand extends BaseCommand {
  type: 'strike';
  angle: number;
  power: number;
  spin: { x: number; y: number };
}
export interface PlaceCueBallCommand extends BaseCommand { type: 'placeCueBall'; position: { x: number; y: number } }
export interface UseSkillCommand extends BaseCommand { type: 'useSkill'; instanceId: string; targetBallId?: number }
export type GameCommand = StrikeCommand | PlaceCueBallCommand | UseSkillCommand;
