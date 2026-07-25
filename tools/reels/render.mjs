#!/usr/bin/env node
/**
 * Renders the break-time reels: one 9:16 mp4 per subject.
 *
 * scene.html draws every frame from a pure function of time, so we just step
 * the clock, pull each frame out as a JPEG, and pipe the sequence into ffmpeg.
 * Nothing here depends on wall-clock timing, which is what makes a re-render
 * reproducible.
 *
 *   node tools/reels/render.mjs [--webm] [subject-id ...]
 *
 * Requires a Chromium that Playwright can launch and an ffmpeg with libx264.
 * See tools/reels/README.md for how those are located.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

// Resolved through createRequire on purpose: `import` ignores NODE_PATH, and
// Playwright is installed globally here rather than as a project dependency.
const { chromium } = createRequire(import.meta.url)('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../../the-lyceum-academy/public/reels');
const FPS = 30;
const JPEG_QUALITY = 0.94;

function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  // imageio-ffmpeg ships a static build with libx264; the ffmpeg Playwright
  // bundles is compiled webm-only and cannot write H.264.
  const guess = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries';
  try {
    const hit = readdirSync(guess).find(f => f.startsWith('ffmpeg-linux'));
    if (hit) return join(guess, hit);
  } catch { /* fall through */ }
  return 'ffmpeg';
}

/**
 * Encoders fed from a single pass of frames.
 *
 * H.264/mp4 is the shipped format — universally playable and, on this grainy
 * source, about five times smaller than the VP9 equivalent. `--webm` adds a
 * VP9 copy: bulkier, but the only format a Chromium built without proprietary
 * codecs can decode, so it is how you verify the output actually plays.
 */
function encoders(scene, withWebm) {
  const common = ['-hide_banner', '-loglevel', 'error', '-y',
                  '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0'];
  const specs = [
    ['mp4', ['-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p',
             '-g', String(FPS), '-movflags', '+faststart']],
    ['webm', ['-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0', '-pix_fmt', 'yuv420p',
              '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-g', String(FPS)]],
  ].filter(([ext]) => ext === 'mp4' || withWebm);
  return specs.map(([ext, args]) => {
    const out = join(OUT_DIR, `${scene.id}.${ext}`);
    const proc = spawn(ffmpegPath(), [...common, ...args, out]);
    const done = new Promise((res, rej) => {
      proc.on('error', rej);
      proc.stderr.on('data', d => process.stderr.write(d));
      proc.on('close', code => code === 0 ? res() : rej(new Error(`ffmpeg(${ext}) exited ${code}`)));
    });
    return { out, proc, done };
  });
}

async function renderScene(page, scene, withWebm) {
  await page.evaluate(s => window.__setScene(s), scene);
  const { DUR, W, H } = await page.evaluate(() => window.__meta);
  const frames = Math.round(DUR * FPS);
  const encs = encoders(scene, withWebm);

  for (let i = 0; i < frames; i++) {
    const b64 = await page.evaluate(
      ([t, q]) => { window.renderAt(t); return window.__frame(q); },
      [i / FPS, JPEG_QUALITY],
    );
    const buf = Buffer.from(b64, 'base64');
    for (const e of encs) {
      if (!e.proc.stdin.write(buf)) await new Promise(r => e.proc.stdin.once('drain', r));
    }
    if (i % 60 === 0) process.stdout.write(`  ${scene.id} ${i}/${frames}\r`);
  }
  for (const e of encs) e.proc.stdin.end();
  await Promise.all(encs.map(e => e.done));

  // Poster: the hook frame, so a card shows the headline instead of black
  // while the video is still buffering.
  const poster = await page.evaluate(
    () => { window.renderAt(1.5); return window.__frame(0.72); },
  );
  writeFileSync(join(OUT_DIR, `${scene.id}-poster.jpg`), Buffer.from(poster, 'base64'));

  process.stdout.write(`  ${scene.id} ${frames}/${frames} ${W}x${H} → ${encs.map(e => e.out.split('/').pop()).join(', ')}\n`);
}

const args = process.argv.slice(2);
const withWebm = args.includes('--webm');
const wanted = args.filter(a => !a.startsWith('--'));
const scenes = JSON.parse(readFileSync(join(HERE, 'scenes.json'), 'utf8'))
  .filter(s => wanted.length === 0 || wanted.includes(s.id));
if (!scenes.length) {
  console.error('no matching scenes');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--force-color-profile=srgb', '--font-render-hinting=none'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
page.on('pageerror', e => { throw e; });
await page.goto('file://' + join(HERE, 'scene.html'));
await page.evaluate(() => window.__fontsReady());

for (const scene of scenes) await renderScene(page, scene, withWebm);
await browser.close();
