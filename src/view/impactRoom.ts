/** Impact-only voicing and a small, finite room; no assets or global RNG needed. */
export const IMPACT_ROOM = Object.freeze({
  duration: 0.30,
  preDelay: 0.018,
  dry: 0.88,
  wet: 0.12,
  // Static headroom for the presence boost and summed reflections, not compression.
  headroom: 0.65,
  lowShelf: Object.freeze({ frequency: 250, gain: -4 }),
  presence: Object.freeze({ frequency: 2400, gain: 3, Q: 0.8 }),
});

/**
 * Sparse stereo reflections with a decaying/tapered envelope. Each channel has
 * absolute tap sum <= 1, so convolution cannot increase its input peak. Disable
 * ConvolverNode.normalize to retain that bound (and the intended wet level).
 * The first 18 ms are silent; the direct transient lives only in the dry path.
 */
export function createImpactRoomImpulse(sampleRate: number): [Float32Array, Float32Array] {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError('Impact room sample rate must be between 8000 and 192000 Hz');
  }
  const length = Math.ceil(sampleRate * IMPACT_ROOM.duration);
  const channels: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  const reflections = 24;
  const span = IMPACT_ROOM.duration - IMPACT_ROOM.preDelay;
  const step = (span - 0.002) / reflections;
  channels.forEach((data, channel) => {
    let seed = 0x83a7 + channel * 0x1923;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let tap = 0; tap < reflections; tap++) {
      const offset = tap === 0 ? channel * 0.0011 : tap * step + (random() - 0.5) * step * 0.55;
      const progress = offset / span;
      const envelope = Math.exp(-5 * progress) * (1 - progress) ** 2;
      const amplitude = envelope * (0.85 + random() * 0.15);
      const sign = tap < 6 || random() > 0.5 ? 1 : -1;
      const frame = Math.ceil((IMPACT_ROOM.preDelay + offset) * sampleRate);
      data[frame] = amplitude * sign;
    }
    const absoluteSum = data.reduce((sum, value) => sum + Math.abs(value), 0);
    // A small Float32 rounding margin keeps the peak bound conservative.
    for (let i = 0; i < length; i++) data[i] = data[i]! * (0.999999 / absoluteSum);
  });
  return channels;
}
