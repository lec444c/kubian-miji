import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): Buffer => readFileSync(new URL(`../../${path}`, import.meta.url));
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
interface Clip {
  role: string; path: string; frames: number; sha256: string;
  durationSeconds: number; targetPeakDbFS: number;
  sourceStartSeconds: number; sourceEndSeconds: number;
}
const report = JSON.parse(read('assets/source/user-hit/processing-report.json').toString()) as {
  source: string; sourceSha256: string; clips: Clip[];
};

describe('用户录音裁剪资产', () => {
  it('保留原始附件，两次不同撞击分别裁剪且没有重叠', () => {
    expect(hash(read(report.source))).toBe('d8c1f7b5866d3ab83ff5fc9f2393b197f76cd915fa7f724ff9a317251309fd85');
    expect(report.clips.map(clip => clip.role)).toEqual(['strike', 'collision']);
    expect(report.clips[0]!.sourceEndSeconds).toBeLessThan(report.clips[1]!.sourceStartSeconds);
    expect(report.clips[0]!.sha256).not.toBe(report.clips[1]!.sha256);
  });

  for (const clip of report.clips) {
    it(`${clip.role} 为短单声道 PCM，起音及时、首尾归零且无削波`, () => {
      const wav = read(clip.path);
      expect(hash(wav)).toBe(clip.sha256);
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
      expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
      expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
      expect(wav.readUInt16LE(20)).toBe(1); // PCM
      expect(wav.readUInt16LE(22)).toBe(1); // mono
      expect(wav.readUInt32LE(24)).toBe(48000);
      expect(wav.readUInt16LE(34)).toBe(16);
      expect(wav.toString('ascii', 36, 40)).toBe('data');
      expect(wav.readUInt32LE(40)).toBe(clip.frames * 2);
      expect(wav.length).toBe(44 + clip.frames * 2);
      const samples = Array.from({ length: clip.frames }, (_, i) => wav.readInt16LE(44 + i * 2) / 32768);
      expect(samples[0]).toBe(0);
      expect(samples.at(-1)).toBe(0);
      const peak = Math.max(...samples.map(Math.abs));
      expect(20 * Math.log10(peak)).toBeCloseTo(clip.targetPeakDbFS, 2);
      expect(peak).toBeLessThan(0.99);
      const onset = samples.findIndex(sample => Math.abs(sample) > .02);
      expect(onset).toBeGreaterThanOrEqual(0);
      expect(onset / 48000).toBeLessThan(.015);
      expect(clip.durationSeconds).toBeGreaterThan(.1);
      expect(clip.durationSeconds).toBeLessThan(.25);
      expect(clip.frames / 48000).toBe(clip.durationSeconds);
    });
  }
});
