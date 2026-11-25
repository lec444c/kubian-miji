/**
 * Sample-based sound effects (user-provided strike/collision clips, plus
 * Kenney/freesound CC0 cushion/pocket/hairdryer) and a randomized local BGM playlist. The original four tracks are normalized to
 * -16 LUFS; three user-supplied additions retain their original audio bytes.
 * See NOTICE for provenance. Everything is local; no remote audio.
 * Synth tones remain only as a fallback when a sample fails to decode and for
 * the two UI cues (skill / foul) that have no recorded sample.
 */

import { MUSIC_TRACKS, nextPlaylistTrack, selectPlaylistTrack, type PlaylistState } from './musicPlaylist';
import { createImpactRoomImpulse, IMPACT_ROOM } from './impactRoom';

export { MUSIC_TRACKS } from './musicPlaylist';

export interface MusicState {
  trackIndex: number;
  /** User intent only: buffering, autoplay denial and failures are not pauses. */
  paused: boolean;
  playing: boolean;
  error: string | null;
}

export interface AudioSettings {
  muted: boolean;
  music: number;
  sfx: number;
}

const SETTINGS_KEY = 'creative8.audio.v1';
const SFX_PATHS = {
  strike: '/assets/audio/sfx/cue-strike-user.wav',
  collision: '/assets/audio/sfx/ball-hit-user.wav',
  cushion: '/assets/audio/sfx/cushion.ogg',
  pocket: '/assets/audio/sfx/pocket.mp3',
  hairdryer: '/assets/audio/sfx/hairdryer-loop.mp3',
  punchA: '/assets/fight/audio/punch-a.mp3',
  punchB: '/assets/fight/audio/punch-b.mp3',
  laowuCat: '/assets/fight/audio/laowu-cat.mp3',
  dagouChant: '/assets/fight/audio/dagou-chant.mp3',
  dagouBark: '/assets/fight/audio/dagou-bark.mp3',
} as const;

const FIGHT_BGM_PATH = '/assets/fight/audio/fight-bgm.mp3';

type SampleName = keyof typeof SFX_PATHS;

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AudioSettings>;
      return {
        muted: parsed.muted === true,
        music: clampVolume(parsed.music ?? 0.55),
        sfx: clampVolume(parsed.sfx ?? 0.9),
      };
    }
  } catch { /* Private mode or corrupt JSON: use defaults. */ }
  return { muted: false, music: 0.55, sfx: 0.9 };
}

function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

export class AudioEffects {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private buffers = new Map<SampleName, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private settings: AudioSettings = loadSettings();
  private bgm: HTMLAudioElement | null = null;
  private bgmSource: MediaElementAudioSourceNode | null = null;
  private playlist: PlaylistState = { trackIndex: -1, remaining: [] };
  private musicState: MusicState = { trackIndex: -1, paused: false, playing: false, error: null };
  private musicListeners = new Set<(state: MusicState) => void>();
  private bgmCleanup: (() => void) | null = null;
  private fightBgm: HTMLAudioElement | null = null;
  private fightBgmSource: MediaElementAudioSourceNode | null = null;
  private fightMusicActive = false;
  private punchToggle = false;
  private playRequest = 0;
  private playPending = false;
  // Reset only on an explicit music command or a completed track, not play().
  // Even files that briefly start and then fail cannot cause an endless loop.
  private failedTracks = new Set<number>();
  private hairdryerSource: AudioBufferSourceNode | null = null;
  private hairdryerGain: GainNode | null = null;
  // Includes fading hairdryers after hairdryer(false) has released its handles.
  private activeSfx = new Map<AudioScheduledSourceNode, GainNode>();
  private impactImpulse: AudioBuffer | null = null;
  private impactRoom: { input: GainNode; convolver: ConvolverNode; nodes: AudioNode[] } | null = null;
  private lastPlayed = new Map<string, number>();
  private disposed = false;

  /** Must be called from a user gesture; safe to call repeatedly. */
  unlock(): void {
    if (this.disposed) return;
    const context = this.ensureContext();
    if (context) void this.loadSamples();
    this.startBgm();
    if (this.fightMusicActive && this.fightBgm) void this.fightBgm.play().catch(() => { /* retried on next gesture */ });
  }

  getSettings(): AudioSettings { return { ...this.settings }; }

  getMusicState(): MusicState { return { ...this.musicState }; }

  /** Immediately delivers a snapshot, then changes; unsubscribe is idempotent. */
  subscribeMusic(listener: (state: MusicState) => void): () => void {
    if (this.disposed) return () => {};
    this.musicListeners.add(listener);
    this.notifyMusicListener(listener);
    return () => { this.musicListeners.delete(listener); };
  }

  /** An explicit choice resumes music and starts a fresh shuffled round. */
  selectTrack(index: number): void {
    if (this.disposed || !Number.isInteger(index) || index < 0 || index >= MUSIC_TRACKS.length) return;
    this.releaseBgm();
    this.failedTracks.clear();
    this.playlist = selectPlaylistTrack(this.playlist, index, MUSIC_TRACKS.length);
    this.updateMusicState({ trackIndex: index, paused: false, playing: false, error: null });
    this.startBgm();
  }

  /** Advances the shuffle bag; unlike selectTrack, preserves a manual pause. */
  nextTrack(): void {
    if (this.disposed) return;
    this.failedTracks.clear();
    this.updateMusicState({ error: null });
    this.advanceTrack();
  }

  toggleMusic(): void {
    if (this.disposed) return;
    if (this.musicState.paused || this.musicState.error) {
      this.failedTracks.clear();
      this.updateMusicState({ paused: false, error: null });
      this.startBgm();
    } else {
      ++this.playRequest;
      this.playPending = false;
      this.updateMusicState({ paused: true, playing: false });
      this.bgm?.pause();
    }
  }

  /** Test-only runtime snapshot: proves BGM actually plays and samples decoded. */
  getDebugState(): {
    muted: boolean; music: number; sfx: number; contextState: string;
    bgmPlaying: boolean; trackIndex: number; loadedSamples: string[];
    paused: boolean; error: string | null; fightMusicPlaying: boolean;
  } {
    return {
      muted: this.settings.muted,
      music: this.settings.music,
      sfx: this.settings.sfx,
      contextState: this.context?.state ?? 'none',
      bgmPlaying: this.musicState.playing,
      trackIndex: this.musicState.trackIndex,
      loadedSamples: [...this.buffers.keys()],
      paused: this.musicState.paused,
      error: this.musicState.error,
      fightMusicPlaying: this.fightMusicActive && !!this.fightBgm && !this.fightBgm.paused,
    };
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.applyGains();
    this.persist();
  }

  setMusicVolume(volume: number): void {
    this.settings.music = clampVolume(volume);
    this.applyGains();
    this.persist();
  }

  setSfxVolume(volume: number): void {
    this.settings.sfx = clampVolume(volume);
    this.applyGains();
    this.persist();
  }

  strike(power: number): void {
    power = clampVolume(power);
    if (!this.playSample('strike', 0.5 + power * 0.5, 0.9 + power * 0.25)) {
      this.tone(190 + power * 90, 0.09, 0.13, 'triangle', true);
    }
  }

  collision(strength = 0.5): void {
    strength = clampVolume(strength);
    if (!this.playSample('collision', 0.25 + strength * 0.75, 0.95 + strength * 0.2, 35)) {
      this.tone(420 + strength * 300, 0.045, 0.04 + strength * 0.04, 'sine', true);
    }
  }

  /** Alternating recorded punch impacts for melee hits, through the impact room. */
  punch(strength = 0.6): void {
    strength = clampVolume(strength);
    this.punchToggle = !this.punchToggle;
    const name = this.punchToggle ? 'punchA' : 'punchB';
    if (!this.playSample(name, 0.55 + strength * 0.45, 0.95 + strength * 0.15, 45)) {
      this.tone(200 + strength * 120, 0.08, 0.12, 'triangle', true);
    }
  }

  /** The supplied "老吴" cat scream, played in full when the cat skill fires. */
  catScream(): void {
    if (!this.playSample('laowuCat', 1, 1)) this.tone(660, 0.5, 0.08, 'sawtooth');
  }

  /** One-shot "大狗大狗叫叫叫" phrase for the ultimate broadcast: chant then bark, no loop. */
  dagouPhrase(): void {
    const context = this.ensureContext();
    const chant = this.buffers.get('dagouChant');
    const bark = this.buffers.get('dagouBark');
    const bus = this.sfxBus;
    if (!context || !bus || !chant || !bark) { this.tone(320, 0.4, 0.1, 'sawtooth'); return; }
    const play = (buffer: AudioBuffer, volume: number, delay: number): void => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(bus);
      this.trackSfx(source, gain);
      source.start(context.currentTime + delay);
    };
    play(chant, 0.9, 0);
    const chantSeconds = Number.isFinite(chant.duration) && chant.duration > 0 ? chant.duration : 0.87;
    play(bark, 1, chantSeconds + 0.02);
  }

  /** The "叫叫叫" bark segment, played once when the dog lands its hit. */
  dagouBark(): void {
    if (!this.playSample('dagouBark', 1, 1)) this.tone(320, 0.4, 0.1, 'sawtooth');
  }

  /** Independent looping battle music; suspends the lounge playlist while active. */
  startFightMusic(): void {
    if (this.disposed) return;
    const context = this.ensureContext();
    if (!context || !this.musicBus) return;
    this.fightMusicActive = true;
    this.bgm?.pause();
    if (!this.fightBgm) {
      const element = new Audio();
      element.preload = 'auto';
      element.loop = true;
      element.dataset.fightBgm = 'true';
      try {
        this.fightBgmSource = context.createMediaElementSource(element);
        this.fightBgmSource.connect(this.musicBus);
      } catch {
        this.fightBgmSource?.disconnect();
        this.fightBgmSource = null;
      }
      element.src = FIGHT_BGM_PATH;
      this.fightBgm = element;
    }
    this.applyGains();
    void this.fightBgm.play().catch(() => { /* Autoplay policy: retried on the next gesture. */ });
  }

  stopFightMusic(): void {
    this.fightMusicActive = false;
    this.fightBgm?.pause();
    if (!this.musicState.paused && this.bgm) this.playBgm();
  }

  cushion(strength = 0.5): void {
    if (!this.playSample('cushion', 0.2 + strength * 0.6, 0.85 + strength * 0.2, 50)) {
      this.tone(240 + strength * 120, 0.07, 0.05 + strength * 0.04, 'sine');
    }
  }

  pocket(): void {
    if (!this.playSample('pocket', 0.85, 1, 80)) this.tone(120, 0.28, 0.12, 'sine');
  }

  skill(): void { this.tone(720, 0.32, 0.07, 'sine'); }
  foul(): void { this.tone(150, 0.4, 0.09, 'sawtooth'); }

  /** Looping hairdryer sample while the skill is actively braking a ball. */
  hairdryer(active: boolean): void {
    const context = this.ensureContext();
    if (!context || !this.sfxBus) return;
    if (!active) {
      if (this.hairdryerSource && this.hairdryerGain) {
        const source = this.hairdryerSource;
        const gain = this.hairdryerGain;
        gain.gain.setTargetAtTime(0, context.currentTime, 0.08);
        try { source.stop(context.currentTime + 0.4); } catch { /* already stopped */ }
      }
      this.hairdryerSource = null;
      this.hairdryerGain = null;
      return;
    }
    if (this.hairdryerSource) return;
    const buffer = this.buffers.get('hairdryer');
    if (!buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.setTargetAtTime(0.5, context.currentTime, 0.12);
    source.connect(gain).connect(this.sfxBus);
    this.trackSfx(source, gain);
    source.start();
    this.hairdryerSource = source;
    this.hairdryerGain = gain;
  }

  /** Stop gameplay audio immediately without changing music intent or context. */
  stopSfx(): void {
    for (const source of this.activeSfx.keys()) {
      try { source.stop(); } catch { /* already ended; still disconnect below */ }
      this.releaseSfx(source);
    }
    this.hairdryerSource = null;
    this.hairdryerGain = null;
    this.lastPlayed.clear();
    if (this.impactRoom) {
      // Discard filter/convolution history, not just their inputs: no old tail
      // may become audible when the next game creates a fresh room graph.
      for (const node of this.impactRoom.nodes) node.disconnect();
      this.impactRoom.convolver.buffer = null;
      this.impactRoom = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopSfx();
    this.releaseBgm();
    this.fightMusicActive = false;
    this.fightBgmSource?.disconnect();
    this.fightBgmSource = null;
    if (this.fightBgm) {
      this.fightBgm.pause();
      this.fightBgm.removeAttribute('src');
      this.fightBgm.load();
      this.fightBgm = null;
    }
    this.updateMusicState({ playing: false });
    this.musicListeners.clear();
    this.sfxBus?.disconnect();
    this.musicBus?.disconnect();
    this.master?.disconnect();
    this.sfxBus = this.musicBus = this.master = null;
    this.impactImpulse = null;
    this.buffers.clear();
    void this.context?.close().catch(() => { /* already closed */ });
    this.context = null;
  }

  private trackSfx(source: AudioScheduledSourceNode, gain: GainNode): void {
    this.activeSfx.set(source, gain);
    source.onended = () => this.releaseSfx(source);
  }

  private releaseSfx(source: AudioScheduledSourceNode): void {
    const gain = this.activeSfx.get(source);
    if (!gain) return;
    source.onended = null;
    source.disconnect();
    gain.disconnect();
    this.activeSfx.delete(source);
    if (this.hairdryerSource === source) {
      this.hairdryerSource = null;
      this.hairdryerGain = null;
    }
  }

  /** One shared impact-only EQ/room graph, lazily rebuilt after stopSfx(). */
  private impactInput(context: AudioContext): GainNode {
    if (this.impactRoom) return this.impactRoom.input;
    if (!this.impactImpulse) {
      const channels = createImpactRoomImpulse(context.sampleRate);
      this.impactImpulse = context.createBuffer(2, channels[0].length, context.sampleRate);
      channels.forEach((channel, index) => this.impactImpulse!.getChannelData(index).set(channel));
    }
    const input = context.createGain();
    input.gain.value = IMPACT_ROOM.headroom;
    const lowShelf = context.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = IMPACT_ROOM.lowShelf.frequency;
    lowShelf.gain.value = IMPACT_ROOM.lowShelf.gain;
    const presence = context.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = IMPACT_ROOM.presence.frequency;
    presence.gain.value = IMPACT_ROOM.presence.gain;
    presence.Q.value = IMPACT_ROOM.presence.Q;
    const dry = context.createGain();
    dry.gain.value = IMPACT_ROOM.dry;
    const wet = context.createGain();
    wet.gain.value = IMPACT_ROOM.wet;
    const convolver = context.createConvolver();
    convolver.normalize = false;
    convolver.buffer = this.impactImpulse;
    input.connect(lowShelf).connect(presence);
    presence.connect(dry).connect(this.sfxBus!);
    presence.connect(convolver).connect(wet).connect(this.sfxBus!);
    this.impactRoom = { input, convolver, nodes: [input, lowShelf, presence, dry, convolver, wet] };
    return input;
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.sfxBus = this.context.createGain();
        this.musicBus = this.context.createGain();
        this.sfxBus.connect(this.master);
        this.musicBus.connect(this.master);
        this.master.connect(this.context.destination);
        this.applyGains();
      }
      if (this.context.state === 'suspended') {
        void this.context.resume().catch(() => { /* Retry from the next user gesture. */ });
      }
      return this.context;
    } catch { return null; }
  }

  private applyGains(): void {
    if (!this.context || !this.master || !this.sfxBus || !this.musicBus) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 1, now, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, now, 0.03);
    this.musicBus.gain.setTargetAtTime(this.settings.music, now, 0.05);
    if (!this.bgmSource && this.bgm) this.bgm.volume = this.settings.muted ? 0 : this.settings.music;
    if (!this.fightBgmSource && this.fightBgm) this.fightBgm.volume = this.settings.muted ? 0 : this.settings.music;
  }

  private persist(): void {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  private loadSamples(): Promise<void> {
    this.loading ??= (async () => {
      const context = this.context;
      if (!context) return;
      await Promise.all((Object.keys(SFX_PATHS) as SampleName[]).map(async name => {
        try {
          const response = await fetch(SFX_PATHS[name]);
          if (!response.ok) return;
          const bytes = await response.arrayBuffer();
          const buffer = await context.decodeAudioData(bytes);
          if (!this.disposed) this.buffers.set(name, buffer);
        } catch { /* Synth fallback stays available for this sample. */ }
      }));
    })();
    return this.loading;
  }

  /** Throttled sample playback; returns false when the sample is unavailable. */
  private playSample(name: SampleName, volume: number, rate = 1, throttleMs = 0): boolean {
    const context = this.ensureContext();
    const buffer = this.buffers.get(name);
    if (!context || !buffer || !this.sfxBus) return false;
    const now = performance.now();
    if (throttleMs && now - (this.lastPlayed.get(name) ?? -Infinity) < throttleMs) return true;
    this.lastPlayed.set(name, now);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = context.createGain();
    gain.gain.value = volume;
    const destination = name === 'strike' || name === 'collision' || name === 'punchA' || name === 'punchB'
      ? this.impactInput(context) : this.sfxBus;
    source.connect(gain).connect(destination);
    this.trackSfx(source, gain);
    source.start();
    return true;
  }

  private updateMusicState(change: Partial<MusicState>): void {
    const next = { ...this.musicState, ...change };
    if (next.trackIndex === this.musicState.trackIndex && next.paused === this.musicState.paused
      && next.playing === this.musicState.playing && next.error === this.musicState.error) return;
    this.musicState = next;
    for (const listener of [...this.musicListeners]) this.notifyMusicListener(listener);
  }

  private notifyMusicListener(listener: (state: MusicState) => void): void {
    try { listener(this.getMusicState()); } catch { /* UI errors must not interrupt audio cleanup or recovery. */ }
  }

  private startBgm(): void {
    // Ordinary pointer/key unlocks must neither resume a manual pause nor reset
    // the failure budget. Explicit music commands may retry a failed playlist.
    if (this.disposed || this.fightMusicActive || this.musicState.paused || this.failedTracks.size >= MUSIC_TRACKS.length) return;
    const context = this.ensureContext();
    if (!context || !this.musicBus) {
      this.updateMusicState({ playing: false, error: '无法初始化音频，请再次点击重试。' });
      return;
    }
    if (!this.bgm) {
      if (this.playlist.trackIndex < 0 || this.failedTracks.has(this.playlist.trackIndex)) {
        this.advanceTrack();
        return;
      }
      this.createBgm(context);
    }
    this.playBgm();
  }

  private createBgm(context: AudioContext): void {
    const element = new Audio();
    this.bgm = element;
    element.preload = 'auto';
    element.crossOrigin = 'anonymous';
    element.loop = false;
    // Detached from the DOM (no layout impact); identifiable by Audio stubs.
    element.dataset.bgm = 'true';
    element.dataset.trackId = MUSIC_TRACKS[this.playlist.trackIndex]!.id;
    const current = () => !this.disposed && this.bgm === element;
    const events: [string, EventListener][] = [
      ['playing', () => {
        if (!current()) return;
        if (this.musicState.paused) { element.pause(); return; }
        this.updateMusicState({ playing: true, error: null });
      }],
      ['waiting', () => { if (current()) this.updateMusicState({ playing: false }); }],
      ['pause', () => { if (current()) this.updateMusicState({ playing: false }); }],
      ['ended', () => {
        if (!current()) return;
        this.updateMusicState({ playing: false });
        if (this.musicState.paused) return;
        this.failedTracks.clear();
        this.advanceTrack();
      }],
      ['error', () => { if (current()) this.failTrack(element); }],
    ];
    for (const [name, handler] of events) element.addEventListener(name, handler);
    this.bgmCleanup = () => {
      for (const [name, handler] of events) element.removeEventListener(name, handler);
    };
    try {
      this.bgmSource = context.createMediaElementSource(element);
      this.bgmSource.connect(this.musicBus!);
    } catch {
      this.bgmSource?.disconnect();
      this.bgmSource = null;
      // Direct element fallback still obeys the saved music volume and mute.
    }
    this.applyGains();
    element.src = MUSIC_TRACKS[this.playlist.trackIndex]!.path;
  }

  private playBgm(): void {
    const element = this.bgm;
    if (!element || this.disposed || this.fightMusicActive || this.musicState.paused || this.playPending
      || (!element.paused && !element.ended)) return;
    const request = ++this.playRequest;
    const current = () => !this.disposed && this.bgm === element && request === this.playRequest;
    this.playPending = true;
    const failed = (error: unknown) => {
      if (!current()) return;
      this.playPending = false;
      const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') {
        // Policy/interruption is not evidence of a bad file. Keep this track
        // and retry on a later gesture, without pretending the user paused.
        this.updateMusicState({ playing: false, error: name === 'NotAllowedError'
          ? '浏览器阻止了音乐播放，请点击页面重试。' : '音乐播放已中断，请点击页面重试。' });
      } else {
        this.failTrack(element);
      }
    };
    try {
      void element.play().then(() => {
        if (!current()) return;
        this.playPending = false;
        if (!element.paused && !element.ended && !this.musicState.paused) {
          this.updateMusicState({ playing: true, error: null });
        }
      }, failed);
    } catch (error) { failed(error); }
  }

  private advanceTrack(): void {
    if (this.disposed || this.failedTracks.size >= MUSIC_TRACKS.length) return;
    this.releaseBgm();
    // At most the remainder of one round plus a whole new round. Failed
    // tracks are consumed but not retried during this automatic recovery run.
    for (let i = 0; i < MUSIC_TRACKS.length * 2; i++) {
      this.playlist = nextPlaylistTrack(this.playlist, MUSIC_TRACKS.length);
      if (!this.failedTracks.has(this.playlist.trackIndex)) break;
    }
    this.updateMusicState({ trackIndex: this.playlist.trackIndex, playing: false });
    this.startBgm();
  }

  private failTrack(element: HTMLAudioElement): void {
    if (this.disposed || this.bgm !== element) return;
    const index = this.playlist.trackIndex;
    this.failedTracks.add(index);
    this.releaseBgm();
    const exhausted = this.failedTracks.size >= MUSIC_TRACKS.length;
    this.updateMusicState({ playing: false, error: exhausted
      ? '所有音乐均播放失败，已停止自动跳过。请选择歌曲或点击下一首重试。'
      : `无法播放「${MUSIC_TRACKS[index]!.title}」。` });
    if (!exhausted && !this.musicState.paused) this.advanceTrack();
  }

  private releaseBgm(): void {
    ++this.playRequest;
    this.playPending = false;
    this.bgmCleanup?.();
    this.bgmCleanup = null;
    const element = this.bgm;
    this.bgm = null;
    this.bgmSource?.disconnect();
    this.bgmSource = null;
    if (element) {
      element.pause();
      element.removeAttribute('src');
      element.load();
    }
  }

  private tone(frequency: number, duration: number, volume: number, type: OscillatorType = 'sine', impact = false): void {
    const context = this.ensureContext();
    if (!context || !this.sfxBus) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.55), context.currentTime + duration);
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(impact ? this.impactInput(context) : this.sfxBus);
    this.trackSfx(oscillator, gain);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }
}
