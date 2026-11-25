import type { Difficulty, MatchMode, MatchSetup, PlayMode } from '../app/matchTypes';

export class MainMenu {
  private mode: MatchMode = 'creative';
  private playMode: PlayMode = 'solo';
  private difficulty: Difficulty = 'normal';
  readonly element = document.createElement('div');

  constructor(onStart: (setup: MatchSetup) => void, onFight?: () => void) {
    this.element.className = 'overlay menu-overlay';
    this.element.innerHTML = `
      <section class="menu-card" aria-label="游戏主菜单">
        <div class="menu-intro">
          <div class="menu-kicker">A BILLIARDS EXPERIMENT</div>
          <h1>库边秘技</h1><div class="english-title">CREATIVE CHINESE EIGHT</div>
          <p>在中八规则之外，给每一次击球留一点悬念。移动库边球、借一阵风减速，或送给对手一颗不能轻易相信的自由球。</p>
          <div class="feature-row"><div class="feature"><b>02</b>经典 / 创意模式</div><div class="feature"><b>03</b>单次创意技能</div><div class="feature"><b>03</b>人机难度</div></div>
        </div>
        <div class="menu-form">
          <label class="form-label">对局规则</label>
          <div class="segmented" data-field="mode">
            <button class="segment" data-value="classic">经典中八<small>纯粹球技与走位</small></button>
            <button class="segment selected" data-value="creative">创意中八<small>技能改变击球节奏</small></button>
          </div>
          <label class="form-label">对局方式</label>
          <div class="segmented" data-field="playMode">
            <button class="segment selected" data-value="solo">单人对人机<small>与电脑选手交锋</small></button>
            <button class="segment" data-value="practice">练习模式<small>自己轮流操作双方</small></button>
          </div>
          <div data-difficulty>
            <label class="form-label">人机难度</label>
            <div class="difficulty">
              <button class="segment" data-level="easy">轻松</button><button class="segment selected" data-level="normal">标准</button><button class="segment" data-level="hard">挑战</button>
            </div>
          </div>
          <button class="start-button">开 局</button>
          <button class="fight-entry" data-fight-entry>球杆格斗 <span>动作试玩 · 单人对电脑</span></button>
          <p class="menu-note">本地 3D Demo · 鼠标瞄准 / 左键后拖蓄力，松开击球 / 摆位 Space 或 Enter 确认 / C 切换镜头<br>创意模式当前技能池为 4 个，开局从全部候选中选 3 个，各限用一次</p>
        </div>
      </section>`;
    this.element.querySelectorAll<HTMLElement>('[data-field]').forEach(group => {
      group.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.segment');
        if (!button) return;
        group.querySelectorAll('.segment').forEach(item => item.classList.remove('selected'));
        button.classList.add('selected');
        if (group.dataset.field === 'mode') this.mode = button.dataset.value as MatchMode;
        else this.playMode = button.dataset.value as PlayMode;
        const difficulty = this.element.querySelector<HTMLElement>('[data-difficulty]')!;
        difficulty.style.display = this.playMode === 'solo' ? '' : 'none';
      });
    });
    this.element.querySelectorAll<HTMLButtonElement>('[data-level]').forEach(button => button.addEventListener('click', () => {
      this.element.querySelectorAll('[data-level]').forEach(item => item.classList.remove('selected'));
      button.classList.add('selected');
      this.difficulty = button.dataset.level as Difficulty;
    }));
    const fightButton = this.element.querySelector<HTMLButtonElement>('[data-fight-entry]')!;
    fightButton.hidden = !onFight;
    fightButton.addEventListener('click', () => onFight?.());
    this.element.querySelector('.start-button')!.addEventListener('click', () => {
      onStart({ mode: this.mode, playMode: this.playMode, difficulty: this.difficulty, seed: Date.now() });
    });
  }
}