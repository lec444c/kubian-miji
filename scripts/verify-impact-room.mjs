import { chromium } from '@playwright/test';
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compile = name => ts.transpileModule(fs.readFileSync(path.join(root, 'src/view', name + '.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const moduleUrl = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const source = compile('AudioEffects')
  .replaceAll("'./musicPlaylist'", JSON.stringify(moduleUrl(compile('musicPlaylist'))))
  .replaceAll("'./impactRoom'", JSON.stringify(moduleUrl(compile('impactRoom'))));
const samples = ['cue-strike-user.wav', 'ball-hit-user.wav'].map(name => ({
  name, bytes: [...fs.readFileSync(path.join(root, 'public/assets/audio/sfx', name))],
}));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const report = await page.evaluate(async ({ module, samples }) => {
    const { AudioEffects } = await import(module);
    const sampleRate = 48000;
    const energy = (data, start = 0, end = data.length) => {
      let sum = 0;
      for (let i = start; i < end; i++) sum += data[i] ** 2;
      return sum;
    };
    const band = (data, low, high) => {
      let total = 0;
      for (let hz = low; hz <= high; hz += 100) {
        const coefficient = 2 * Math.cos(2 * Math.PI * hz / sampleRate);
        let q1 = 0, q2 = 0;
        for (const value of data) { const q0 = value + coefficient * q1 - q2; q2 = q1; q1 = q0; }
        total += q1 * q1 + q2 * q2 - coefficient * q1 * q2;
      }
      return total;
    };
    const results = [];
    for (const sample of samples) {
      const render = async (mode) => {
        const context = new OfflineAudioContext(2, 28800, sampleRate);
        const originalResume = context.resume.bind(context);
        // ensureContext's realtime resume is irrelevant before offline rendering.
        context.resume = async () => {};
        window.AudioContext = function () { return context; };
        const buffer = await context.decodeAudioData(new Uint8Array(sample.bytes).buffer);
        let effects;
        if (mode === 'raw') {
          const source = context.createBufferSource(); source.buffer = buffer;
          source.connect(context.destination); source.start();
        } else {
          effects = new AudioEffects();
          effects.setSfxVolume(1);
          effects.setMuted(false);
          effects.buffers.set('strike', buffer);
          // Exercise the shipped private sample path at unity rate/volume.
          effects.playSample('strike', 1, 1);
          if (mode === 'muted') effects.master.gain.setValueAtTime(0, 0);
        }
        const suspended = mode === 'stopped' ? context.suspend(0.08) : null;
        const rendered = context.startRendering();
        if (suspended) {
          await suspended;
          effects.stopSfx();
          await originalResume();
        }
        return { data: (await rendered).getChannelData(0), duration: buffer.duration };
      };
      const raw = await render('raw');
      const wet = await render('room');
      const stopped = await render('stopped');
      const muted = await render('muted');
      const tailStart = Math.ceil((raw.duration + 0.008) * sampleRate);
      const peak = wet.data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
      const ratio = data => band(data, 1500, 3500) / band(data, 100, 300);
      results.push({
        sample: sample.name,
        rawDuration: raw.duration,
        peak,
        clarityRatioGain: ratio(wet.data) / ratio(raw.data),
        tailEnergy: energy(wet.data, tailStart),
        rawTailEnergy: energy(raw.data, tailStart),
        stoppedTailEnergy: energy(stopped.data, Math.ceil(0.09 * sampleRate)),
        mutedEnergy: energy(muted.data),
        finalSilenceEnergy: energy(wet.data, Math.ceil(0.5 * sampleRate)),
      });
    }
    return results;
  }, { module: moduleUrl(source), samples });
  for (const sample of report) {
    assert(sample.peak > 0 && sample.peak < 1, 'single impact must have headroom');
    assert(sample.clarityRatioGain > 1.3, 'presence-to-bass energy ratio must improve');
    assert(sample.tailEnergy > 1e-10, 'real convolved room must extend beyond the sample');
    assert.equal(sample.rawTailEnergy, 0);
    assert.equal(sample.stoppedTailEnergy, 0, 'stopSfx must remove ongoing sample and room history');
    assert.equal(sample.mutedEnergy, 0);
    assert.equal(sample.finalSilenceEnergy, 0, 'room must have bounded decay');
  }
  console.log(JSON.stringify({ renderer: 'Chromium OfflineAudioContext', sampleRate: 48000, report }, null, 2));
} finally {
  await browser.close();
}
