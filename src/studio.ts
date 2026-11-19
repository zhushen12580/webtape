import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright';
import { cleanMessage, type FrameSink } from './record';
import type { Format, InitOptions, Theme } from './shared';
import { destinationKey } from './tape';

export interface OutputTarget { path: string; format: Format }
export interface Studio extends FrameSink { finish(): Promise<Array<{ path: string; bytes: Buffer }>> }

// An https origin is a secure context, which WebCodecs needs.
const ORIGIN = 'https://webtape.local';
const PAGE = '<!doctype html><meta charset="utf-8"><script src="/studio-page.js"></script>';

/** Opens the compositing page in its own context of the same browser. */
export async function openStudio(
  browser: Browser,
  o: { width: number; height: number; fps: number; theme: Theme; outputs: OutputTarget[] },
): Promise<Studio> {
  const context = await browser.newContext();
  await context.route(`${ORIGIN}/**`, route => new URL(route.request().url()).pathname === '/studio-page.js'
    ? route.fulfill({ contentType: 'text/javascript', body: readFileSync(fileURLToPath(new URL('./studio-page.js', import.meta.url))) })
    : route.fulfill({ contentType: 'text/html', body: PAGE }));
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  const clean = <T>(p: Promise<T>) => p.catch((e: unknown) => { throw new Error(cleanMessage(e)); });
  const init: InitOptions = { width: o.width, height: o.height, fps: o.fps, theme: o.theme, formats: [...new Set(o.outputs.map(t => t.format))] };
  await clean(page.evaluate(i => window.webtape.init(i), init));
  return {
    addFrame: (png, overlay) => clean(page.evaluate(a => window.webtape.addFrame(a.png, a.overlay), { png: png.toString('base64'), overlay })),
    async finish() {
      const out = await clean(page.evaluate(() => window.webtape.finish()));
      return o.outputs.map(t => ({ path: t.path, bytes: Buffer.from(out[t.format]!, 'base64') }));
    },
  };
}

/**
 * Called only after every output encoded. Writes each file next to its target first, then swaps them in,
 * moving old files aside; if any step fails, the old files come back and nothing new is left behind.
 * Once every file is in place the write has succeeded, so a leftover backup only gets a warning.
 */
export function writeOutputs(files: Array<{ path: string; bytes: Buffer }>): void {
  const keys = files.map(f => destinationKey(f.path, '.'));
  for (const [i, key] of keys.entries()) {
    const inside = keys.findIndex(k => k.startsWith(key + sep));
    if (inside >= 0) throw new Error(`Cannot write ${files[i].path}: it is a directory in the path of ${files[inside].path}`);
  }
  const undo: Array<() => void> = [];
  const backups: string[] = [];
  try {
    const staged = files.map(({ path, bytes }) => {
      if (statSync(path, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Cannot write ${path}: it is a directory`);
      const created = mkdirSync(dirname(path), { recursive: true });
      if (created) undo.push(() => rmSync(created, { recursive: true, force: true }));
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, bytes, { flag: 'wx' });
      undo.push(() => rmSync(tmp, { force: true }));
      return { tmp, path };
    });
    for (const { tmp, path } of staged) {
      if (existsSync(path)) {
        const backup = `${path}.${process.pid}.bak`;
        renameSync(path, backup);
        backups.push(backup);
        undo.push(() => renameSync(backup, path));
      } else {
        undo.push(() => rmSync(path, { force: true }));
      }
      renameSync(tmp, path);
    }
  } catch (e) {
    const failed: string[] = [];
    for (const step of undo.toReversed()) {
      try { step(); } catch (u) { failed.push(cleanMessage(u)); }
    }
    if (failed.length) throw new Error(`${cleanMessage(e)} (rollback also failed: ${failed.join('; ')})`);
    throw e;
  }
  for (const backup of backups) {
    try {
      rmSync(backup, { force: true });
    } catch (e) {
      process.stderr.write(`warning: could not remove ${backup}: ${cleanMessage(e)}\n`);
    }
  }
}
