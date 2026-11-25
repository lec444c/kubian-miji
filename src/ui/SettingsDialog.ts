import { MUSIC_TRACKS, type MusicState } from '../view/AudioEffects';

export interface SettingsState {
  musicState: MusicState;
  muted: boolean;
  music: number;
  sfx: number;
  reducedMotion: boolean;
  lowQuality: boolean;
}

/** shadcn-style light dialog: audio volumes, mute, motion and quality. */
export class SettingsDialog {
  readonly element = document.createElement('div');
  private returnFocus: HTMLElement | null = null;
  private muted = false;
  private musicVolume = 0.55;

  constructor(callbacks: {
    onMusicVolume: (volume: number) => void;
    onSfxVolume: (volume: number) => void;
    onMute: (muted: boolean) => void;
    onMotion: () => void;
    onQuality: () => void;
    onSelectTrack: (index: number) => void;
    onNextTrack: () => void;
    onToggleMusic: () => void;
  }) {
    this.element.className = 'overlay hidden';
    this.element.innerHTML = `
      <section class="dialog settings" role="dialog" aria-label="对局设置" aria-modal="true">
        <div class="dialog-header">
          <div class="eyebrow">SETTINGS</div>
          <h2>对局设置</h2>
          <p>音频与显示选项即时生效，设置会保存在本机浏览器中。</p>
          <button class="dialog-close" data-close aria-label="关闭设置">×</button>
        </div>
        <div class="settings-body">
          <div class="setting-row">
            <div class="setting-label"><strong>背景音乐</strong><small>七首本地曲目，默认随机播放</small></div>
            <div class="setting-control"><input type="range" min="0" max="100" value="55" data-music aria-label="音乐音量"><span class="setting-value" data-music-value>55</span></div>
          </div>
          <details class="music-playlist" data-playlist>
            <summary>音乐歌单 <span>7 首 · 随机播放</span></summary>
            <p class="playlist-hint">点击曲目立即播放，播完后继续随机切歌。</p>
            <div class="music-transport"><p data-now-playing role="status" aria-live="polite">等待播放</p><button class="icon-button" data-music-toggle>暂停音乐</button><button class="icon-button" data-music-next>下一首</button></div>
            <ol class="track-list">${MUSIC_TRACKS.map((track, index) => `<li><button class="track-button" data-track="${index}" aria-pressed="false"><span class="track-number">${String(index + 1).padStart(2, '0')}</span><span class="track-info"><strong>${track.title}</strong><small>${track.artist}</small></span><span class="track-state">播放</span></button></li>`).join('')}</ol>
          </details>
          <div class="setting-row">
            <div class="setting-label"><strong>游戏音效</strong><small>击球、碰撞、撞库、入袋与吹风机</small></div>
            <div class="setting-control"><input type="range" min="0" max="100" value="90" data-sfx aria-label="音效音量"><span class="setting-value" data-sfx-value>90</span></div>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong>全部静音</strong><small>一键关闭音乐与音效</small></div>
            <div class="setting-control"><button class="toggle" data-mute aria-pressed="false">静音</button></div>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong>减少动效</strong><small>缩短技能动画与镜头过渡</small></div>
            <div class="setting-control"><button class="toggle" data-motion aria-pressed="false">减少动效</button></div>
          </div>
          <div class="setting-row">
            <div class="setting-label"><strong>流畅画质</strong><small>降低分辨率并关闭实时阴影</small></div>
            <div class="setting-control"><button class="toggle" data-quality aria-pressed="false">流畅画质</button></div>
          </div>
        </div>
        <div class="dialog-footer"><small>本地音乐与音效 · 素材来源和许可见随包声明</small><button class="primary" data-done>完成</button></div>
      </section>`;
    const music = this.element.querySelector<HTMLInputElement>('[data-music]')!;
    const sfx = this.element.querySelector<HTMLInputElement>('[data-sfx]')!;
    music.addEventListener('input', () => {
      this.element.querySelector('[data-music-value]')!.textContent = music.value;
      callbacks.onMusicVolume(Number(music.value) / 100);
    });
    sfx.addEventListener('input', () => {
      this.element.querySelector('[data-sfx-value]')!.textContent = sfx.value;
      callbacks.onSfxVolume(Number(sfx.value) / 100);
    });
    this.element.querySelector('[data-mute]')!.addEventListener('click', () => {
      const button = this.element.querySelector<HTMLButtonElement>('[data-mute]')!;
      callbacks.onMute(button.getAttribute('aria-pressed') !== 'true');
    });
    this.element.querySelector('[data-motion]')!.addEventListener('click', callbacks.onMotion);
    this.element.querySelector('[data-quality]')!.addEventListener('click', callbacks.onQuality);
    this.element.querySelectorAll<HTMLButtonElement>('[data-track]').forEach(button => {
      button.addEventListener('click', () => callbacks.onSelectTrack(Number(button.dataset.track)));
    });
    this.element.querySelector('[data-music-toggle]')!.addEventListener('click', callbacks.onToggleMusic);
    this.element.querySelector('[data-music-next]')!.addEventListener('click', callbacks.onNextTrack);
    const close = (): void => this.close();
    this.element.addEventListener('keydown', event => {
      event.stopPropagation(); // Space/arrow keys in the playlist must not strike or aim.
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const controls = Array.from(this.element.querySelectorAll<HTMLElement>('button, input, summary')).filter(control => control.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    this.element.addEventListener('keyup', event => event.stopPropagation());
    this.element.querySelector('[data-close]')!.addEventListener('click', close);
    this.element.querySelector('[data-done]')!.addEventListener('click', close);
    this.element.addEventListener('click', event => { if (event.target === this.element) close(); });
  }

  close(restoreFocus = true): void {
    this.element.classList.add('hidden');
    if (restoreFocus) this.returnFocus?.focus();
    this.returnFocus = null;
  }

  open(state: SettingsState, showPlaylist = false): void {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.sync(state);
    this.element.classList.remove('hidden');
    const playlist = this.element.querySelector<HTMLDetailsElement>('[data-playlist]')!;
    playlist.open = showPlaylist;
    if (showPlaylist) playlist.querySelector<HTMLElement>('summary')!.focus();
    else this.element.querySelector<HTMLElement>('[data-close]')!.focus();
  }

  syncMusic(state: MusicState): void {
    const track = MUSIC_TRACKS[state.trackIndex];
    const status = state.error ? state.error : state.paused ? '已暂停' : state.playing ? '正在播放' : '等待播放';
    const hint = this.muted ? ' · 全部静音中' : this.musicVolume === 0 ? ' · 音乐音量为零' : '';
    this.element.querySelector('[data-now-playing]')!.textContent = `${status}${track ? `：${track.title}` : ''}${hint}`;
    this.element.querySelector('[data-music-toggle]')!.textContent = state.error ? '重试播放' : state.paused ? '继续音乐' : '暂停音乐';
    this.element.querySelectorAll<HTMLButtonElement>('[data-track]').forEach(button => {
      const selected = Number(button.dataset.track) === state.trackIndex;
      button.setAttribute('aria-pressed', String(selected));
      button.querySelector('.track-state')!.textContent = selected ? (state.error ? '失败' : state.paused ? '已暂停' : state.playing ? '播放中' : '已选择') : '播放';
    });
  }

  sync(state: SettingsState): void {
    this.muted = state.muted;
    this.musicVolume = state.music;
    this.syncMusic(state.musicState);
    const music = this.element.querySelector<HTMLInputElement>('[data-music]')!;
    const sfx = this.element.querySelector<HTMLInputElement>('[data-sfx]')!;
    music.value = String(Math.round(state.music * 100));
    sfx.value = String(Math.round(state.sfx * 100));
    this.element.querySelector('[data-music-value]')!.textContent = music.value;
    this.element.querySelector('[data-sfx-value]')!.textContent = sfx.value;
    this.setToggle('[data-mute]', state.muted, '已静音', '静音');
    this.setToggle('[data-motion]', state.reducedMotion, '恢复动效', '减少动效');
    this.setToggle('[data-quality]', state.lowQuality, '精细画质', '流畅画质');
  }

  private setToggle(selector: string, pressed: boolean, onLabel: string, offLabel: string): void {
    const button = this.element.querySelector<HTMLButtonElement>(selector)!;
    button.setAttribute('aria-pressed', String(pressed));
    button.textContent = pressed ? onLabel : offLabel;
    button.classList.toggle('on', pressed);
  }
}