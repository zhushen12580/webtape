import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import omggif from 'omggif';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = join(ROOT, 'dist', 'cli.js');

export function tmpDir(): string {
  return mkdtempSync(join(os.tmpdir(), 'webtape-'));
}

export function runCli(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { code: number | null; stdout: string; stderr: string; ms: number } {
  const start = Date.now();
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - start };
}

export function writeTape(dir: string, name: string, lines: string[]): string {
  const file = join(dir, name);
  writeFileSync(file, lines.join('\n'));
  return file;
}

/** Copies test/fixtures/<name> into dir (optionally renamed) and returns the new path. */
export function copyFixture(name: string, dir: string, as = name): string {
  const file = join(dir, as);
  copyFileSync(join(ROOT, 'test', 'fixtures', name), file);
  return file;
}

export function readGif(file: string) {
  const bytes = readFileSync(file);
  const gif = new omggif.GifReader(bytes);
  const frames = gif.numFrames();
  let totalDelayMs = 0;
  for (let i = 0; i < frames; i++) totalDelayMs += gif.frameInfo(i).delay * 10;
  return {
    width: gif.width, height: gif.height, frames, loop: gif.loopCount() as number | null, totalDelayMs, size: bytes.length,
    /** Frames are diffs over the previous one (dispose = keep), so blit every frame up to the target. */
    pixel(frame: number, x: number, y: number): [number, number, number] {
      const rgba = new Uint8Array(gif.width * gif.height * 4);
      for (let i = 0; i <= frame; i++) gif.decodeAndBlitFrameRGBA(i, rgba);
      const o = (y * gif.width + x) * 4;
      return [rgba[o], rgba[o + 1], rgba[o + 2]];
    },
  };
}
