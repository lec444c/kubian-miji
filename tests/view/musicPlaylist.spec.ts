import { describe, expect, it, vi } from 'vitest';
import {
  MUSIC_TRACKS, nextPlaylistTrack, selectPlaylistTrack, shuffledIndices, type PlaylistState,
} from '../../src/view/musicPlaylist';

const empty: PlaylistState = { trackIndex: -1, remaining: [] };
const count = MUSIC_TRACKS.length;

function seededRandom(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

describe('musicPlaylist', () => {
  it('固定七首歌曲、艺人与本地路径，保持原四首顺序', () => {
    expect(MUSIC_TRACKS.map(({ title, artist }) => [title, artist])).toEqual([
      ['Background Jazz Music', 'pulsebox'],
      ['Jazz Background Music', 'pulsebox'],
      ['Free Lounge Music', 'happinessinmusic'],
      ['Background Music Instrumental', 'faespencer'],
      ['Relaxed Elevator Lounge Cafe Music', 'Tunetank'],
      ['Cafe Music · 349477', 'Tunetank'],
      ['Cafe Music · 348881', 'Tunetank'],
    ]);
    expect(MUSIC_TRACKS.map(track => track.path)).toEqual(
      Array.from({ length: 7 }, (_, i) => `/assets/audio/bgm/track-${i + 1}.mp3`),
    );
    expect(new Set(MUSIC_TRACKS.map(track => track.id)).size).toBe(7);
  });

  it('随机源可注入，Fisher–Yates 输出可确定', () => {
    expect(shuffledIndices(7, () => 0)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(shuffledIndices(7, () => 0.999999)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(shuffledIndices(7, () => 0, 1)).toEqual([2, 1, 3, 4, 5, 6, 0]);
    expect(shuffledIndices(7, seededRandom(12))).toEqual(shuffledIndices(7, seededRandom(12)));
  });

  it('空列表与单曲边界有界，不为单曲等待一个不可能的不同曲目', () => {
    const random = vi.fn(() => 0);
    for (const invalidCount of [0, -1, 1.5, NaN, Infinity]) {
      expect(shuffledIndices(invalidCount, random)).toEqual([]);
      expect(nextPlaylistTrack(empty, invalidCount, random)).toEqual(empty);
    }
    expect(shuffledIndices(1, random, 0)).toEqual([0]);
    expect(nextPlaylistTrack({ trackIndex: 0, remaining: [] }, 1, random))
      .toEqual({ trackIndex: 0, remaining: [] });
    expect(random).not.toHaveBeenCalled();
  });

  it('连续多轮每轮恰好七首无重复，跨轮首尾不会重复', () => {
    for (const random of [() => 0, () => 0.999999, seededRandom(731)]) {
      let state = empty;
      let previous = -1;
      for (let round = 0; round < 100; round++) {
        const tracks: number[] = [];
        for (let i = 0; i < count; i++) {
          state = nextPlaylistTrack(state, count, random);
          expect(state.trackIndex).not.toBe(previous);
          tracks.push(state.trackIndex);
          previous = state.trackIndex;
        }
        expect([...tracks].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(state.remaining).toEqual([]);
      }
    }
  });

  it('换轮恰好随机到上一首时交换首项，而非无限重抽', () => {
    const random = vi.fn(() => 0.999999);
    const state = nextPlaylistTrack({ trackIndex: 0, remaining: [] }, count, random);
    expect(state).toEqual({ trackIndex: 6, remaining: [1, 2, 3, 4, 5, 0] });
    expect(random).toHaveBeenCalledTimes(7);
  });

  it('未到换轮时消费既有顺序，不修改输入、不调用随机源', () => {
    const remaining = Object.freeze([4, 6, 1]);
    const state = Object.freeze({ trackIndex: 0, remaining });
    const random = vi.fn(() => 0);
    expect(nextPlaylistTrack(state, count, random)).toEqual({ trackIndex: 4, remaining: [6, 1] });
    expect(state.remaining).toEqual([4, 6, 1]);
    expect(random).not.toHaveBeenCalled();
  });

  it('手选作为新一轮第一首，其后六首仍随机且无重复', () => {
    const original = Object.freeze({ trackIndex: 3, remaining: Object.freeze([1, 2]) });
    let state = selectPlaylistTrack(original, 5, count, () => 0);
    expect(state).toEqual({ trackIndex: 5, remaining: [1, 2, 3, 4, 6, 0] });
    expect(original).toEqual({ trackIndex: 3, remaining: [1, 2] });
    const round = [state.trackIndex];
    for (let i = 1; i < count; i++) {
      state = nextPlaylistTrack(state, count, () => 0);
      round.push(state.trackIndex);
    }
    expect(new Set(round).size).toBe(count);
    const next = nextPlaylistTrack(state, count, () => 0.999999);
    expect(next.trackIndex).not.toBe(state.trackIndex);
    expect(selectPlaylistTrack(original, 5, count, () => 0.999999).remaining)
      .not.toEqual(selectPlaylistTrack(original, 5, count, () => 0).remaining);
  });

  it('非法手选是无副作用的 no-op', () => {
    const random = vi.fn(() => 0);
    for (const index of [-1, 7, 1.2, NaN, Infinity]) {
      expect(selectPlaylistTrack(empty, index, count, random)).toBe(empty);
    }
    expect(selectPlaylistTrack(empty, 0, 0, random)).toBe(empty);
    expect(random).not.toHaveBeenCalled();
  });
});
