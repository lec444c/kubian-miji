import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEffects, MUSIC_TRACKS, type MusicState } from '../../src/view/AudioEffects';
import { MUSIC_TRACKS as playlistTracks } from '../../src/view/musicPlaylist';
import { createImpactRoomImpulse, IMPACT_ROOM } from '../../src/view/impactRoom';

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  static playImpl: (element: FakeAudio) => Promise<void>;
  dataset: Record<string, string> = {};
  preload = '';
  crossOrigin = '';
  loop = false;
  volume = 1;
  paused = true;
  ended = false;
  currentTime = 0;
  src = '';

  constructor() { super(); FakeAudio.instances.push(this); }
  play = vi.fn(() => FakeAudio.playImpl(this));
  pause = vi.fn(() => {
    const wasPaused = this.paused;
    this.paused = true;
    if (!wasPaused) this.dispatchEvent(new Event('pause'));
  });
  removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = ''; });
  load = vi.fn();

  emit(name: string): void {
    if (name === 'playing') { this.paused = false; this.ended = false; }
    if (name === 'ended') { this.paused = true; this.ended = true; }
    if (name === 'error') this.paused = true;
    this.dispatchEvent(new Event(name));
  }
}

class FakeNode {
  connections = new Set<FakeNode>();
  connect = vi.fn((target: FakeNode) => { this.connections.add(target); return target; });
  disconnect = vi.fn(() => this.connections.clear());
}

class FakeParam {
  value = 1;
  setTargetAtTime = vi.fn((value: number) => { this.value = value; });
  setValueAtTime = vi.fn((value: number) => { this.value = value; });
  exponentialRampToValueAtTime = vi.fn((value: number) => { this.value = value; });
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeScheduledSource extends FakeNode {
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  end(): void { this.onended?.(); }
}

class FakeBufferSource extends FakeScheduledSource {
  buffer: unknown = null;
  loop = false;
  playbackRate = { value: 1 };
}

class FakeOscillator extends FakeScheduledSource {
  type = 'sine';
  frequency = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  gain = new FakeParam();
  Q = new FakeParam();
}

class FakeBuffer {
  private channels: Float32Array[];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(index: number): Float32Array { return this.channels[index]!; }
}

class FakeConvolver extends FakeNode {
  normalize = true;
  buffer: FakeBuffer | null = null;
}

class FakeContext {
  static instances: FakeContext[] = [];
  static mediaUnavailable = false;
  state = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  gains: FakeGain[] = [];
  mediaSources: FakeNode[] = [];
  bufferSources: FakeBufferSource[] = [];
  oscillators: FakeOscillator[] = [];
  filters: FakeFilter[] = [];
  convolvers: FakeConvolver[] = [];
  constructor() { FakeContext.instances.push(this); }
  createGain(): FakeGain { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createMediaElementSource(): FakeNode {
    if (FakeContext.mediaUnavailable) throw new Error('No media source support');
    const source = new FakeNode(); this.mediaSources.push(source); return source;
  }
  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource(); this.bufferSources.push(source); return source;
  }
  createOscillator(): FakeOscillator {
    const source = new FakeOscillator(); this.oscillators.push(source); return source;
  }
  createBiquadFilter(): FakeFilter {
    const filter = new FakeFilter(); this.filters.push(filter); return filter;
  }
  createConvolver(): FakeConvolver {
    const convolver = new FakeConvolver(); this.convolvers.push(convolver); return convolver;
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }
  decodeAudioData = vi.fn(async () => ({}));
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
}

const succeed = (element: FakeAudio): Promise<void> => { element.emit('playing'); return Promise.resolve(); };
const latest = (): FakeAudio => FakeAudio.instances.at(-1)!;
const allTrackIds = (): string[] => FakeAudio.instances.map(element => element.dataset.trackId!);
const totalPlays = (): number => FakeAudio.instances.reduce((sum, element) => sum + element.play.mock.calls.length, 0);
const output = (node: FakeNode): FakeNode => node.connect.mock.calls[0]![0];
const sourceGain = (node: FakeScheduledSource): FakeGain => output(node) as FakeGain;
const instances: AudioEffects[] = [];
let storage: Map<string, string>;
function createAudio(): AudioEffects { const audio = new AudioEffects(); instances.push(audio); return audio; }
async function settle(): Promise<void> {
  // Drain sample decoding and the bounded seven-track promise recovery chain.
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (reason: unknown) => void } {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  FakeAudio.instances = [];
  FakeAudio.playImpl = succeed;
  FakeContext.instances = [];
  FakeContext.mediaUnavailable = false;
  storage = new Map();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  for (const audio of instances.splice(0)) audio.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('用户击球采样接线', () => {
  it('加载两个新 WAV，并将击杆和碰撞分发到各自解码缓冲区', async () => {
    const audio = createAudio();
    audio.unlock();
    await settle();
    expect(fetch).toHaveBeenCalledWith('/assets/audio/sfx/cue-strike-user.wav');
    expect(fetch).toHaveBeenCalledWith('/assets/audio/sfx/ball-hit-user.wav');
    expect(fetch).not.toHaveBeenCalledWith('/assets/audio/sfx/cue-strike.ogg');
    expect(fetch).not.toHaveBeenCalledWith('/assets/audio/sfx/ball-hit.ogg');
    const context = FakeContext.instances[0]!;
    const decoded = await Promise.all(context.decodeAudioData.mock.results.map(result => result.value));
    audio.strike(0.5);
    audio.collision(0.8);
    expect(context.bufferSources).toHaveLength(2);
    expect(context.bufferSources[0]!.buffer).toBe(decoded[0]);
    expect(context.bufferSources[1]!.buffer).toBe(decoded[1]);
    expect(decoded[0]).not.toBe(decoded[1]);
    for (const source of context.bufferSources) expect(source.start).toHaveBeenCalledOnce();
  });
});

describe('格斗独立音乐与受击采样', () => {
  it('格斗音乐独立循环、暂停歌单，退出后恢复歌单', async () => {
    const audio = createAudio();
    audio.unlock();
    await settle();
    const lounge = latest();
    expect(lounge.dataset.bgm).toBe('true');
    expect(audio.getDebugState().bgmPlaying).toBe(true);

    audio.startFightMusic();
    await settle();
    const fight = latest();
    expect(fight).not.toBe(lounge);
    expect(fight.dataset.fightBgm).toBe('true');
    expect(fight.loop).toBe(true);
    expect(fight.src).toBe('/assets/fight/audio/fight-bgm.mp3');
    expect(lounge.pause).toHaveBeenCalled();
    expect(audio.getDebugState().fightMusicPlaying).toBe(true);

    const context = FakeContext.instances[0]!;
    const musicBus = context.gains[2]!;
    expect(context.mediaSources.at(-1)!.connections).toEqual(new Set([musicBus]));

    // While the battle loop owns the music bus, ordinary unlocks keep the playlist suspended.
    audio.unlock();
    await settle();
    expect(lounge.paused).toBe(true);
    expect(audio.getDebugState().fightMusicPlaying).toBe(true);

    audio.stopFightMusic();
    await settle();
    expect(fight.pause).toHaveBeenCalled();
    expect(audio.getDebugState().fightMusicPlaying).toBe(false);
    expect(audio.getDebugState().bgmPlaying).toBe(true);
  });

  it('近战受击交替播放 punchA/punchB 两段录音并走冲击房间', async () => {
    const audio = createAudio();
    audio.unlock();
    await settle();
    const context = FakeContext.instances[0]!;
    const decoded = await Promise.all(context.decodeAudioData.mock.results.map(result => result.value));
    audio.punch(0.8);
    audio.punch(0.8);
    expect(context.bufferSources).toHaveLength(2);
    expect(context.bufferSources[0]!.buffer).toBe(decoded[5]);
    expect(context.bufferSources[1]!.buffer).toBe(decoded[6]);
    expect(decoded[5]).not.toBe(decoded[6]);
    const input = output(sourceGain(context.bufferSources[0]!));
    expect(output(sourceGain(context.bufferSources[1]!))).toBe(input);
  });

  it('猫技能播放完整老吴采样，直通 SFX 总线', async () => {
    const audio = createAudio();
    audio.unlock();
    await settle();
    const context = FakeContext.instances[0]!;
    const decoded = await Promise.all(context.decodeAudioData.mock.results.map(result => result.value));
    audio.catScream();
    const source = context.bufferSources.at(-1)!;
    expect(source.buffer).toBe(decoded[7]);
    expect(source.playbackRate.value).toBe(1);
    expect(output(sourceGain(source))).toBe(context.gains[1]!);
  });

  it('大招播报播放一次“大狗大狗叫叫叫”短语：喊话接犬吠、不循环，命中 bark 单次', async () => {
    const audio = createAudio();
    audio.unlock();
    await settle();
    const context = FakeContext.instances[0]!;
    const decoded = await Promise.all(context.decodeAudioData.mock.results.map(result => result.value));
    audio.dagouPhrase();
    const phrase = context.bufferSources.filter(item => item.buffer === decoded[8] || item.buffer === decoded[9]);
    expect(phrase).toHaveLength(2);
    expect(phrase[0]!.buffer).toBe(decoded[8]);
    expect(phrase[0]!.loop).toBe(false);
    expect(phrase[1]!.buffer).toBe(decoded[9]);
    expect(phrase[1]!.loop).toBe(false);
    expect(phrase[0]!.start).toHaveBeenCalled();
    expect(phrase[1]!.start).toHaveBeenCalledWith(expect.any(Number));
    phrase.forEach(item => expect(output(sourceGain(item))).toBe(context.gains[1]!));
    audio.stopSfx();
    phrase.forEach(item => expect(item.stop).toHaveBeenCalled());
    audio.dagouBark();
    const bark = context.bufferSources.at(-1)!;
    expect(bark.buffer).toBe(decoded[9]);
    expect(bark.loop).toBe(false);
  });
});

describe('impact EQ and room routing', () => {
  it('两个 impact 共享 EQ、无延迟干声与立体声短房间，全部通过 SFX/master', async () => {
    const audio = createAudio();
    audio.unlock();
    await settle();
    const context = FakeContext.instances[0]!;
    expect(context.filters).toHaveLength(0);
    expect(context.convolvers).toHaveLength(0); // Music alone does not allocate a room.
    audio.strike(1);
    audio.collision(1);
    const [master, sfxBus, musicBus] = context.gains as [FakeGain, FakeGain, FakeGain];
    const input = output(sourceGain(context.bufferSources[0]!)) as FakeGain;
    expect(output(sourceGain(context.bufferSources[1]!))).toBe(input);
    expect(input.gain.value).toBe(0.65);
    expect(context.filters).toHaveLength(2);
    const [lowShelf, presence] = context.filters as [FakeFilter, FakeFilter];
    expect(lowShelf.type).toBe('lowshelf');
    expect(lowShelf.frequency.value).toBe(250);
    expect(lowShelf.gain.value).toBe(-4);
    expect(presence.type).toBe('peaking');
    expect(presence.frequency.value).toBe(2400);
    expect(presence.gain.value).toBe(3);
    expect(presence.Q.value).toBe(0.8);
    expect(input.connections).toEqual(new Set([lowShelf]));
    expect(lowShelf.connections).toEqual(new Set([presence]));
    expect(context.convolvers).toHaveLength(1);
    const convolver = context.convolvers[0]!;
    const dry = output(presence) as FakeGain;
    const wet = output(convolver) as FakeGain;
    expect(presence.connections).toEqual(new Set([dry, convolver]));
    expect(dry.gain.value).toBe(0.88);
    expect(wet.gain.value).toBe(0.12);
    expect(dry.connections).toEqual(new Set([sfxBus]));
    expect(convolver.connections).toEqual(new Set([wet]));
    expect(wet.connections).toEqual(new Set([sfxBus]));
    expect(sfxBus.connections).toEqual(new Set([master]));
    expect(musicBus.connections).toEqual(new Set([master]));
    expect(master.connections).toEqual(new Set([context.destination]));
    expect(context.mediaSources[0]!.connections).toEqual(new Set([musicBus]));
    expect(convolver.normalize).toBe(false);
    expect(convolver.buffer).toMatchObject({ numberOfChannels: 2, length: 14400, sampleRate: 48000 });
    const impulse = createImpactRoomImpulse(context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      expect(convolver.buffer!.getChannelData(channel)).toEqual(impulse[channel]);
    }
    audio.setSfxVolume(0.4);
    audio.setMusicVolume(0.7);
    audio.setMuted(true);
    expect([master.gain.value, sfxBus.gain.value, musicBus.gain.value]).toEqual([0, 0.4, 0.7]);
    expect([dry.gain.value, wet.gain.value]).toEqual([IMPACT_ROOM.dry, IMPACT_ROOM.wet]);
    audio.setMuted(false);
    audio.setSfxVolume(0);
    expect([master.gain.value, sfxBus.gain.value, musicBus.gain.value]).toEqual([1, 0, 0.7]);
    expect(audio.getMusicState().playing).toBe(true);
  });

  it('碰库、落袋、吹风机和 UI tone 保留直接 SFX 路由与原增益', async () => {
    const audio = createAudio();
    audio.unlock();
    await settle();
    audio.strike(0.5);
    audio.cushion(0.5);
    audio.pocket();
    audio.hairdryer(true);
    audio.skill();
    audio.foul();
    const context = FakeContext.instances[0]!;
    const sfxBus = context.gains[1]!;
    const unaffected = [...context.bufferSources.slice(1), ...context.oscillators];
    expect(unaffected.map(source => sourceGain(source).gain.setValueAtTime.mock.calls[0]?.[0]
      ?? sourceGain(source).gain.value)).toEqual([0.5, 0.85, 0, 0.07, 0.09]);
    for (const source of unaffected) expect(sourceGain(source).connections).toEqual(new Set([sfxBus]));
    const hairdryer = context.bufferSources[3]!;
    expect(hairdryer.loop).toBe(true);
    expect(sourceGain(hairdryer).gain.value).toBe(0.5);
    expect(context.filters).toHaveLength(2);
    expect(context.convolvers).toHaveLength(1);
  });

  it('解码失败时仅 impact 的合成回退进入房间，其他回退不改音色', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Decode unavailable'));
    const audio = createAudio();
    audio.unlock();
    await settle();
    audio.strike(NaN);
    audio.collision(Infinity);
    audio.cushion();
    audio.pocket();
    audio.skill();
    audio.foul();
    const context = FakeContext.instances[0]!;
    expect(context.bufferSources).toHaveLength(0);
    expect(context.oscillators).toHaveLength(6);
    const input = output(sourceGain(context.oscillators[0]!));
    expect(input).not.toBe(context.gains[1]);
    expect(output(sourceGain(context.oscillators[1]!))).toBe(input);
    for (const source of context.oscillators.slice(2)) expect(output(sourceGain(source))).toBe(context.gains[1]);
    expect(context.oscillators[0]!.frequency.setValueAtTime).toHaveBeenCalledWith(235, 0);
    expect(context.oscillators[1]!.frequency.setValueAtTime).toHaveBeenCalledWith(570, 0);
  });

  it.each([[-1, 0], [0, 0], [0.4, 0.4], [1, 1], [2, 1], [NaN, 0.5], [Infinity, 0.5], [-Infinity, 0.5]])(
    'impact 强度 %s 限制为 %s，音量和速率均有限', async (input, bounded) => {
      const audio = createAudio();
      audio.unlock();
      await settle();
      audio.strike(input);
      audio.collision(input);
      const [strike, collision] = FakeContext.instances[0]!.bufferSources as [FakeBufferSource, FakeBufferSource];
      expect(sourceGain(strike).gain.value).toBeCloseTo(0.5 + bounded * 0.5);
      expect(sourceGain(collision).gain.value).toBeCloseTo(0.25 + bounded * 0.75);
      expect(strike.playbackRate.value).toBeCloseTo(0.9 + bounded * 0.25);
      expect(collision.playbackRate.value).toBeCloseTo(0.95 + bounded * 0.2);
    },
  );
});

describe('AudioEffects SFX lifecycle', () => {
  it('未初始化时 stopSfx 幂等且不会解锁 context 或改变音乐意图', () => {
    const audio = createAudio();
    audio.toggleMusic();
    const state = audio.getMusicState();
    audio.stopSfx(); audio.stopSfx();
    expect(FakeContext.instances).toHaveLength(0);
    expect(FakeAudio.instances).toHaveLength(0);
    expect(audio.getMusicState()).toEqual(state);
  });

  it.each([false, true])('stopSfx 清理所有活动/渐隐音效和尾音，可重播；保留音乐 paused=%s', async paused => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const audio = createAudio();
    audio.unlock();
    await settle();
    if (paused) audio.toggleMusic();
    const state = audio.getMusicState();
    const settings = audio.getSettings();
    const element = latest();
    element.currentTime = 12;
    const pauses = element.pause.mock.calls.length;
    const plays = element.play.mock.calls.length;
    audio.strike(0.5); audio.collision(); audio.collision();
    audio.cushion(); audio.pocket(); audio.skill(); audio.foul();
    audio.hairdryer(true);
    audio.hairdryer(false); // A fading source must still be tracked.
    audio.hairdryer(true);
    const context = FakeContext.instances[0]!;
    expect(context.bufferSources).toHaveLength(6); // Second collision was throttled.
    const sources = [...context.bufferSources, ...context.oscillators];
    const gains = context.gains.slice(3);
    const filters = [...context.filters];
    const oldConvolver = context.convolvers[0]!;
    const impulse = oldConvolver.buffer;
    const lateEnded = sources.map(source => source.onended!);
    const oldStops = sources.map(source => source.stop.mock.calls.length);
    // Cleanup must continue even if a source has already stopped itself.
    sources[0]!.stop.mockImplementationOnce(() => { throw new Error('Already stopped'); });
    context.state = 'suspended';
    audio.stopSfx();
    audio.stopSfx();
    sources.forEach((source, i) => {
      expect(source.stop).toHaveBeenCalledTimes(oldStops[i]! + 1);
      expect(source.disconnect).toHaveBeenCalledOnce();
      expect(source.connections.size).toBe(0);
      expect(source.onended).toBeNull();
    });
    for (const node of [...gains, ...filters, oldConvolver]) {
      expect(node.disconnect).toHaveBeenCalledOnce();
      expect(node.connections.size).toBe(0);
    }
    expect(oldConvolver.buffer).toBeNull();
    expect(audio.getMusicState()).toEqual(state);
    expect(audio.getSettings()).toEqual(settings);
    expect(latest()).toBe(element);
    expect(element.currentTime).toBe(12);
    expect(element.pause).toHaveBeenCalledTimes(pauses);
    expect(element.play).toHaveBeenCalledTimes(plays);
    expect(context.mediaSources[0]!.disconnect).not.toHaveBeenCalled();
    for (const bus of context.gains.slice(0, 3)) expect(bus.disconnect).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
    expect(context.resume).not.toHaveBeenCalled();
    expect(context.state).toBe('suspended');
    audio.collision(); audio.cushion(); audio.pocket(); // Same clock; throttles must be reset.
    audio.hairdryer(true); audio.skill(); audio.strike(0.5);
    expect(context.bufferSources).toHaveLength(11);
    expect(context.oscillators).toHaveLength(3);
    expect(context.convolvers).toHaveLength(2);
    expect(context.convolvers[1]!.buffer).toBe(impulse); // Data cached, DSP history not reused.
    expect(context.convolvers[1]!.disconnect).not.toHaveBeenCalled();
    expect(FakeContext.instances).toHaveLength(1);
    for (const ended of lateEnded) ended(); // Stale events cannot tear down the new game.
    for (const source of context.bufferSources.slice(6)) {
      expect(source.start).toHaveBeenCalledOnce();
      expect(source.disconnect).not.toHaveBeenCalled();
    }
    audio.hairdryer(true);
    expect(context.bufferSources).toHaveLength(11);
  });

  it('自然结束释放 source/gain，但保留尾音；旧吹风机结束不影响新循环', async () => {
    const audio = createAudio();
    audio.unlock();
    await settle();
    audio.strike(0.5); audio.skill();
    audio.hairdryer(true); audio.hairdryer(false); audio.hairdryer(true);
    const context = FakeContext.instances[0]!;
    const ended = [context.bufferSources[0]!, context.oscillators[0]!, context.bufferSources[1]!];
    const oldStops = ended.map(source => source.stop.mock.calls.length);
    for (const source of ended) {
      source.end(); source.end();
      expect(source.disconnect).toHaveBeenCalledOnce();
      expect(sourceGain(source).disconnect).toHaveBeenCalledOnce();
      expect(source.onended).toBeNull();
    }
    expect(context.convolvers[0]!.disconnect).not.toHaveBeenCalled();
    audio.hairdryer(true);
    expect(context.bufferSources).toHaveLength(3);
    audio.stopSfx();
    ended.forEach((source, i) => expect(source.stop).toHaveBeenCalledTimes(oldStops[i]!));
    expect(context.bufferSources[2]!.stop).toHaveBeenCalledOnce();
    expect(context.convolvers[0]!.buffer).toBeNull();
  });

  it('所有 source 已结束后 stopSfx 仍清除独立房间尾音', async () => {
    const audio = createAudio();
    audio.unlock();
    await settle();
    audio.strike(0.5);
    const context = FakeContext.instances[0]!;
    const source = context.bufferSources[0]!;
    source.end();
    expect(context.convolvers[0]!.buffer).not.toBeNull();
    audio.stopSfx(); audio.stopSfx();
    expect(source.stop).not.toHaveBeenCalled();
    expect(context.convolvers[0]!.buffer).toBeNull();
    expect(context.convolvers[0]!.disconnect).toHaveBeenCalledOnce();
    for (const filter of context.filters) expect(filter.disconnect).toHaveBeenCalledOnce();
  });

  it('stopSfx 不取消待完成的音乐播放或恢复手动暂停', async () => {
    const pending = deferred();
    FakeAudio.playImpl = () => pending.promise;
    const audio = createAudio();
    audio.unlock();
    audio.stopSfx();
    latest().emit('playing');
    pending.resolve();
    await settle();
    expect(audio.getMusicState()).toMatchObject({ playing: true, paused: false });
    audio.toggleMusic();
    audio.stopSfx(); audio.unlock();
    expect(latest().play).toHaveBeenCalledOnce();
    expect(audio.getMusicState()).toMatchObject({ playing: false, paused: true });
  });

  it('dispose 复用 stopSfx，释放总线、尾音和 context，之后不可重建', async () => {
    const audio = createAudio();
    audio.unlock();
    await settle();
    audio.strike(1); audio.collision(); audio.skill(); audio.hairdryer(true);
    const stop = vi.spyOn(audio, 'stopSfx');
    const context = FakeContext.instances[0]!;
    audio.dispose(); audio.dispose();
    expect(stop).toHaveBeenCalledOnce();
    for (const source of [...context.bufferSources, ...context.oscillators]) {
      expect(source.stop).toHaveBeenLastCalledWith();
      expect(source.disconnect).toHaveBeenCalledOnce();
    }
    for (const node of [...context.gains, ...context.filters, ...context.convolvers, ...context.mediaSources]) {
      expect(node.disconnect).toHaveBeenCalledOnce();
    }
    expect(context.convolvers[0]!.buffer).toBeNull();
    expect(context.close).toHaveBeenCalledOnce();
    expect(audio.getDebugState().loadedSamples).toEqual([]);
    const count = context.bufferSources.length;
    audio.stopSfx(); audio.strike(1); audio.collision(); audio.skill(); audio.hairdryer(true); audio.unlock();
    expect(context.bufferSources).toHaveLength(count);
    expect(context.oscillators).toHaveLength(1);
    expect(context.convolvers).toHaveLength(1);
    expect(FakeContext.instances).toHaveLength(1);
  });
});

describe('AudioEffects music controls', () => {
  it('重导出同一静态歌单，保留调试字段与初始用户意图', () => {
    const audio = createAudio();
    expect(MUSIC_TRACKS).toBe(playlistTracks);
    expect(audio.getMusicState()).toEqual({ trackIndex: -1, paused: false, playing: false, error: null });
    expect(audio.getDebugState()).toEqual({
      muted: false, music: 0.55, sfx: 0.9, contextState: 'none', bgmPlaying: false,
      trackIndex: -1, loadedSamples: [], paused: false, error: null, fightMusicPlaying: false,
    });
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it('默认洗牌，ended 自动循环三轮均无重复，音频保持 DOM 外', async () => {
    const audio = createAudio();
    audio.unlock();
    const played: number[] = [];
    for (let i = 0; i < 21; i++) {
      await settle();
      const state = audio.getMusicState();
      played.push(state.trackIndex);
      expect(state).toMatchObject({ paused: false, playing: true, error: null });
      expect(latest().src).toBe(MUSIC_TRACKS[state.trackIndex]!.path);
      expect(latest().dataset.bgm).toBe('true');
      expect(latest().loop).toBe(false);
      if (i < 20) latest().emit('ended');
    }
    expect(played.slice(0, 7)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    for (let i = 0; i < 21; i += 7) expect(new Set(played.slice(i, i + 7)).size).toBe(7);
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1]);
    expect(audio.getDebugState().loadedSamples).toHaveLength(10);
    expect(audio.getDebugState().bgmPlaying).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('首次 unlock 前可立即手选；所选曲之后六首仍随机且不重复', async () => {
    const audio = createAudio();
    audio.selectTrack(5);
    expect(latest().src).toBe('/assets/audio/bgm/track-6.mp3');
    expect(latest().play).toHaveBeenCalledTimes(1);
    const round = [audio.getMusicState().trackIndex];
    for (let i = 0; i < 6; i++) {
      latest().emit('ended');
      await settle();
      round.push(audio.getMusicState().trackIndex);
    }
    expect(round).toEqual([5, 1, 2, 3, 4, 6, 0]);
    const old = latest();
    audio.selectTrack(0); // Selecting the current track explicitly restarts it.
    expect(latest()).not.toBe(old);
    expect(old.pause).toHaveBeenCalled();
    expect(old.load).toHaveBeenCalled();
    expect(audio.getMusicState()).toMatchObject({ trackIndex: 0, playing: true });
  });

  it('手动暂停不会被普通 pointer/key unlock 打断，继续保留播放位置且不影响音效', async () => {
    const audio = createAudio();
    audio.unlock();
    await settle();
    const element = latest();
    element.currentTime = 32;
    audio.toggleMusic();
    const settings = audio.getSettings();
    const context = FakeContext.instances[0]!;
    context.state = 'suspended';
    for (let i = 0; i < 5; i++) audio.unlock();
    audio.strike(0.5);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.bufferSources.at(-1)!.start).toHaveBeenCalledTimes(1);
    expect(element.play).toHaveBeenCalledTimes(1);
    expect(audio.getMusicState()).toMatchObject({ paused: true, playing: false });
    expect(audio.getSettings()).toEqual(settings);
    audio.toggleMusic();
    await settle();
    expect(latest()).toBe(element);
    expect(element.currentTime).toBe(32);
    expect(element.play).toHaveBeenCalledTimes(2);
    expect(audio.getMusicState()).toMatchObject({ paused: false, playing: true });
  });

  it('首次播放前也能暂停；下一首保留暂停，手选则立即恢复', async () => {
    const audio = createAudio();
    audio.toggleMusic();
    audio.unlock();
    expect(FakeAudio.instances).toHaveLength(0);
    audio.nextTrack();
    expect(audio.getMusicState()).toMatchObject({ trackIndex: 1, paused: true, playing: false });
    expect(FakeAudio.instances).toHaveLength(0);
    audio.toggleMusic();
    await settle();
    const old = latest();
    audio.toggleMusic();
    audio.nextTrack();
    audio.unlock();
    expect(audio.getMusicState()).toMatchObject({ trackIndex: 2, paused: true, playing: false });
    expect(old.paused).toBe(true);
    expect(FakeAudio.instances).toHaveLength(1);
    audio.selectTrack(6);
    expect(audio.getMusicState()).toMatchObject({ trackIndex: 6, paused: false, playing: true });
  });

  it('下一首在未启动时可启动，播放中立即前进，非法手选无副作用', async () => {
    const audio = createAudio();
    for (const index of [-1, 7, 1.5, NaN, Infinity]) audio.selectTrack(index);
    expect(FakeAudio.instances).toHaveLength(0);
    audio.nextTrack();
    await settle();
    expect(audio.getMusicState().trackIndex).toBe(1);
    const first = latest();
    audio.nextTrack();
    expect(audio.getMusicState()).toMatchObject({ trackIndex: 2, playing: true });
    expect(first.paused).toBe(true);
    for (const index of [-1, 7, 1.5, NaN, Infinity]) audio.selectTrack(index);
    expect(FakeAudio.instances).toHaveLength(2);
    expect(audio.getMusicState().trackIndex).toBe(2);
  });

  it('订阅立即返回独立快照，更新涵盖 buffering/pause，并可取消', async () => {
    const audio = createAudio();
    const states: MusicState[] = [];
    const unsubscribe = audio.subscribeMusic(state => states.push(state));
    const brokenUi = audio.subscribeMusic(() => { throw new Error('UI bug'); });
    states[0]!.trackIndex = 99;
    expect(audio.getMusicState().trackIndex).toBe(-1);
    audio.unlock();
    await settle();
    expect(states.at(-1)!.playing).toBe(true);
    latest().emit('waiting');
    expect(states.at(-1)).toMatchObject({ paused: false, playing: false });
    latest().emit('playing');
    latest().pause(); // An external/system pause is not a manual pause.
    expect(states.at(-1)).toMatchObject({ paused: false, playing: false });
    audio.unlock();
    await settle();
    expect(states.at(-1)!.playing).toBe(true);
    audio.toggleMusic();
    expect(states.at(-1)).toMatchObject({ paused: true, playing: false });
    unsubscribe(); unsubscribe(); brokenUi();
    const length = states.length;
    audio.toggleMusic();
    await settle();
    expect(states).toHaveLength(length);
  });

  it('加载中的重复 unlock 不重入；快速手选忽略旧 promise 和旧元素事件', async () => {
    const pending = deferred();
    FakeAudio.playImpl = () => pending.promise;
    const audio = createAudio();
    audio.unlock();
    const old = latest();
    for (let i = 0; i < 5; i++) audio.unlock();
    expect(old.play).toHaveBeenCalledTimes(1);
    expect(audio.getMusicState()).toMatchObject({ paused: false, playing: false });
    FakeAudio.playImpl = succeed;
    audio.selectTrack(4);
    pending.reject(new Error('Old track decode failed'));
    for (const name of ['error', 'ended', 'playing', 'pause']) old.emit(name);
    await settle();
    expect(audio.getMusicState()).toEqual({ trackIndex: 4, paused: false, playing: true, error: null });
    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeContext.instances[0]!.mediaSources[0]!.disconnect).toHaveBeenCalledTimes(1);
  });

  it('加载时主动暂停，迟到的 play 成功与 playing 事件也不能恢复音乐', async () => {
    const pending = deferred();
    FakeAudio.playImpl = () => pending.promise;
    const audio = createAudio();
    audio.unlock();
    const element = latest();
    audio.toggleMusic();
    pending.resolve();
    element.emit('playing');
    await settle();
    audio.unlock();
    expect(element.paused).toBe(true);
    expect(element.play).toHaveBeenCalledTimes(1);
    expect(audio.getMusicState()).toMatchObject({ paused: true, playing: false, error: null });
    FakeAudio.playImpl = succeed;
    audio.toggleMusic();
    await settle();
    expect(audio.getMusicState().playing).toBe(true);
  });

  it('暂停后继续同一元素时，旧 promise 失败不会清除新请求或跳曲', async () => {
    const first = deferred();
    const second = deferred();
    FakeAudio.playImpl = () => first.promise;
    const audio = createAudio();
    audio.unlock();
    audio.toggleMusic();
    FakeAudio.playImpl = () => second.promise;
    audio.toggleMusic();
    first.reject(new DOMException('Interrupted', 'AbortError'));
    await settle();
    audio.unlock();
    expect(latest().play).toHaveBeenCalledTimes(2);
    expect(audio.getMusicState().error).toBeNull();
    latest().emit('playing');
    second.resolve();
    await settle();
    expect(audio.getMusicState().playing).toBe(true);
  });
});

describe('AudioEffects recovery and settings', () => {
  it.each(['NotAllowedError', 'AbortError'])('%s 不跳曲、不冒充手动暂停，下一次手势重试', async name => {
    FakeAudio.playImpl = () => Promise.reject(new DOMException('Blocked', name));
    const audio = createAudio();
    audio.unlock();
    await settle();
    const element = latest();
    const state = audio.getMusicState();
    expect(state).toMatchObject({ paused: false, playing: false });
    expect(state.error).toBeTruthy();
    expect(FakeAudio.instances).toHaveLength(1);
    FakeAudio.playImpl = succeed;
    audio.unlock();
    await settle();
    expect(latest()).toBe(element);
    expect(audio.getMusicState()).toEqual({ ...state, playing: true, error: null });
  });

  it('play 全部拒绝时仅尝试七首各一次，普通 unlock 不重新进入失败循环', async () => {
    FakeAudio.playImpl = () => Promise.reject(new DOMException('Bad file', 'NotSupportedError'));
    const audio = createAudio();
    const states: MusicState[] = [];
    audio.subscribeMusic(state => states.push(state));
    audio.unlock();
    await settle();
    expect(FakeAudio.instances).toHaveLength(7);
    expect(new Set(allTrackIds()).size).toBe(7);
    expect(totalPlays()).toBe(7);
    expect(audio.getMusicState()).toMatchObject({ paused: false, playing: false });
    expect(audio.getMusicState().error).toContain('停止自动跳过');
    expect(states.some(state => state.error?.includes('无法播放'))).toBe(true);
    for (let i = 0; i < 10; i++) audio.unlock();
    await settle();
    expect(totalPlays()).toBe(7);
    FakeAudio.playImpl = succeed;
    audio.nextTrack();
    await settle();
    expect(totalPlays()).toBe(8);
    expect(audio.getMusicState()).toMatchObject({ playing: true, error: null });
  });

  it('全部失败后的重试按钮一次点击即可恢复，不会变成手动暂停', async () => {
    FakeAudio.playImpl = () => Promise.reject(new DOMException('Bad file', 'NotSupportedError'));
    const audio = createAudio();
    audio.unlock();
    await settle();
    expect(totalPlays()).toBe(7);
    expect(audio.getMusicState().error).not.toBeNull();
    FakeAudio.playImpl = succeed;
    audio.toggleMusic();
    await settle();
    expect(totalPlays()).toBe(8);
    expect(audio.getMusicState()).toMatchObject({ paused: false, playing: true, error: null });
  });

  it('一个失败的 error 事件和 play rejection 只算一次，可跳到正常歌曲', async () => {
    const pending = deferred();
    FakeAudio.playImpl = () => pending.promise;
    const audio = createAudio();
    const states: MusicState[] = [];
    audio.subscribeMusic(state => states.push(state));
    audio.selectTrack(6);
    const bad = latest();
    FakeAudio.playImpl = succeed;
    bad.emit('error');
    pending.reject(new Error('Same failure'));
    bad.emit('error');
    await settle();
    expect(FakeAudio.instances).toHaveLength(2);
    expect(audio.getMusicState()).toMatchObject({ trackIndex: 1, playing: true, error: null });
    expect(states.some(state => state.error?.includes(MUSIC_TRACKS[6].title))).toBe(true);
  });

  it('即使每首 play 已成功、随后再触发 error，自动失败次数仍然有界', async () => {
    const audio = createAudio();
    audio.selectTrack(3);
    for (let i = 0; i < 7; i++) {
      await settle();
      expect(audio.getMusicState().playing).toBe(true);
      latest().emit('error');
    }
    await settle();
    expect(FakeAudio.instances).toHaveLength(7);
    expect(new Set(allTrackIds()).size).toBe(7);
    expect(audio.getMusicState().error).toContain('停止自动跳过');
    audio.unlock();
    expect(FakeAudio.instances).toHaveLength(7);
    audio.selectTrack(3);
    await settle();
    expect(audio.getMusicState()).toMatchObject({ trackIndex: 3, playing: true, error: null });
  });

  it('失败恢复跨越洗牌边界时不重试已失败曲目；同步 play 抛错也有界', async () => {
    const audio = createAudio();
    audio.unlock();
    for (let i = 0; i < 3; i++) { await settle(); audio.nextTrack(); }
    await settle();
    const before = FakeAudio.instances.length;
    FakeAudio.playImpl = () => { throw new Error('Synchronous media failure'); };
    audio.nextTrack();
    await settle();
    const failed = FakeAudio.instances.slice(before);
    expect(failed).toHaveLength(7);
    expect(new Set(failed.map(element => element.dataset.trackId)).size).toBe(7);
    expect(audio.getMusicState().error).toContain('停止自动跳过');
  });

  it('暂停时收到资源错误仅报告失败，不自动换曲或恢复；继续可重试', async () => {
    const audio = createAudio();
    audio.selectTrack(2);
    await settle();
    audio.toggleMusic();
    latest().emit('error');
    audio.unlock();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(audio.getMusicState()).toMatchObject({ trackIndex: 2, paused: true, playing: false });
    expect(audio.getMusicState().error).toBeTruthy();
    audio.toggleMusic();
    await settle();
    expect(audio.getMusicState()).toEqual({ trackIndex: 2, paused: false, playing: true, error: null });
  });

  it('AudioContext 不可用时 UI 可报告，后续手势可以恢复', async () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('Unavailable'); } });
    const audio = createAudio();
    audio.unlock();
    expect(audio.getMusicState()).toMatchObject({ paused: false, playing: false });
    expect(audio.getMusicState().error).toContain('无法初始化音频');
    vi.stubGlobal('AudioContext', FakeContext);
    audio.unlock();
    await settle();
    expect(audio.getMusicState()).toMatchObject({ playing: true, error: null });
  });

  it('已有静音、音乐/SFX 音量与持久化保持，不与独立音乐暂停混淆', async () => {
    const audio = createAudio();
    audio.unlock();
    await settle();
    audio.setMuted(true);
    audio.setMusicVolume(0.23);
    audio.setSfxVolume(0.71);
    const context = FakeContext.instances[0]!;
    expect(context.gains.map(gain => gain.gain.value)).toEqual([0, 0.71, 0.23]);
    expect(audio.getMusicState()).toMatchObject({ paused: false, playing: true });
    audio.toggleMusic();
    audio.setMuted(false);
    audio.unlock();
    expect(audio.getMusicState()).toMatchObject({ paused: true, playing: false });
    expect(context.gains.map(gain => gain.gain.value)).toEqual([1, 0.71, 0.23]);
    expect(JSON.parse(storage.get('creative8.audio.v1')!)).toEqual({ muted: false, music: 0.23, sfx: 0.71 });
    expect(createAudio().getSettings()).toEqual(audio.getSettings());
    audio.setMusicVolume(2);
    audio.setSfxVolume(-1);
    expect(audio.getSettings()).toEqual({ muted: false, music: 1, sfx: 0 });
    audio.setMusicVolume(NaN);
    expect(audio.getSettings().music).toBe(0.5);
  });

  it('MediaElementSource 回退在首次播放和每次切歌都应用已保存的静音/音量', async () => {
    FakeContext.mediaUnavailable = true;
    storage.set('creative8.audio.v1', JSON.stringify({ muted: true, music: 0.25, sfx: 0.4 }));
    const audio = createAudio();
    audio.unlock();
    await settle();
    expect(latest().volume).toBe(0);
    audio.setMuted(false);
    expect(latest().volume).toBe(0.25);
    audio.setMusicVolume(0.7);
    expect(latest().volume).toBe(0.7);
    audio.nextTrack();
    expect(latest().volume).toBe(0.7);
    audio.setMuted(true);
    audio.selectTrack(0);
    expect(latest().volume).toBe(0);
    expect(audio.getSettings()).toEqual({ muted: true, music: 0.7, sfx: 0.4 });
  });

  it('dispose 清理订阅、音频源与旧异步任务，之后所有音乐命令为 no-op', async () => {
    const pending = deferred();
    FakeAudio.playImpl = () => pending.promise;
    const audio = createAudio();
    const listener = vi.fn();
    audio.subscribeMusic(listener);
    audio.unlock();
    const element = latest();
    const context = FakeContext.instances[0]!;
    audio.dispose();
    const calls = listener.mock.calls.length;
    pending.reject(new Error('Too late'));
    element.emit('error'); element.emit('ended'); element.emit('playing');
    audio.unlock(); audio.selectTrack(1); audio.nextTrack(); audio.toggleMusic(); audio.dispose();
    await settle();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(audio.getMusicState().playing).toBe(false);
    expect(element.src).toBe('');
    expect(element.pause).toHaveBeenCalled();
    expect(context.mediaSources[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(calls);
    const afterDispose = vi.fn();
    audio.subscribeMusic(afterDispose)();
    expect(afterDispose).not.toHaveBeenCalled();
  });

  it('未启动即 dispose 不会创建任何音频资源', () => {
    const audio = createAudio();
    audio.dispose();
    audio.unlock();
    expect(FakeAudio.instances).toHaveLength(0);
    expect(FakeContext.instances).toHaveLength(0);
  });
});
