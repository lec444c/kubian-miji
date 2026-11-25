import './style.css';
import { GameController } from './app/GameController';
import type { DebugApi } from './app/debugTypes';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('缺少游戏挂载节点');

const game = new GameController(root);

declare global {
  interface Window { __creativeEight?: DebugApi }
}

// Deterministic hooks are available only on the local development/preview demo.
// They let browser tests advance ten minutes and arrange skill scenarios without real waiting.
window.__creativeEight = game.getDebugApi();
