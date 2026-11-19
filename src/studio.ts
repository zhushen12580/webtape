import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright';
import { cleanMessage, type FrameSink } from './record';
import type { Format, InitOptions, Theme } from './shared';

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

/** Called only after every output encoded, so a failed run never touches existing files. */
export function writeOutputs(files: Array<{ path: string; bytes: Buffer }>): void {
  for (const f of files) {
    mkdirSync(dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.bytes);
  }
}
