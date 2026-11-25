export interface MusicTrack {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly path: string;
}

/** Trusted local assets only; never read playlist metadata or URLs from HTML. */
export const MUSIC_TRACKS = [
  { id: 'track-1', title: 'Background Jazz Music', artist: 'pulsebox', path: '/assets/audio/bgm/track-1.mp3' },
  { id: 'track-2', title: 'Jazz Background Music', artist: 'pulsebox', path: '/assets/audio/bgm/track-2.mp3' },
  { id: 'track-3', title: 'Free Lounge Music', artist: 'happinessinmusic', path: '/assets/audio/bgm/track-3.mp3' },
  { id: 'track-4', title: 'Background Music Instrumental', artist: 'faespencer', path: '/assets/audio/bgm/track-4.mp3' },
  { id: 'track-5', title: 'Relaxed Elevator Lounge Cafe Music', artist: 'Tunetank', path: '/assets/audio/bgm/track-5.mp3' },
  { id: 'track-6', title: 'Cafe Music · 349477', artist: 'Tunetank', path: '/assets/audio/bgm/track-6.mp3' },
  { id: 'track-7', title: 'Cafe Music · 348881', artist: 'Tunetank', path: '/assets/audio/bgm/track-7.mp3' },
] as const satisfies readonly MusicTrack[];

/** Random sources follow Math.random's [0, 1) contract. */
export type RandomSource = () => number;

export interface PlaylistState {
  readonly trackIndex: number;
  readonly remaining: readonly number[];
}

/** Fisher–Yates, with a non-repeating boundary between complete rounds. */
export function shuffledIndices(count: number, random: RandomSource = Math.random, previous = -1): number[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  const indices = Array.from({ length: count }, (_, index) => index);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  if (indices.length > 1 && indices[0] === previous) {
    const j = 1 + Math.floor(random() * (indices.length - 1));
    [indices[0], indices[j]] = [indices[j]!, indices[0]!];
  }
  return indices;
}

/** Pure transition: consumes a shuffle bag without mutating the input state. */
export function nextPlaylistTrack(
  state: PlaylistState, count: number, random: RandomSource = Math.random,
): PlaylistState {
  if (!Number.isInteger(count) || count <= 0) return { trackIndex: -1, remaining: [] };
  const bag = state.remaining.length ? state.remaining : shuffledIndices(count, random, state.trackIndex);
  return { trackIndex: bag[0]!, remaining: bag.slice(1) };
}

/** A manual choice starts a new round; its other tracks remain shuffled. */
export function selectPlaylistTrack(
  state: PlaylistState, index: number, count: number, random: RandomSource = Math.random,
): PlaylistState {
  if (!Number.isInteger(count) || !Number.isInteger(index) || index < 0 || index >= count) return state;
  return { trackIndex: index, remaining: shuffledIndices(count, random).filter(track => track !== index) };
}
