import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { addressText, easeInOut, rippleAge, type Overlay } from './shared';
import { charsDue, CLICK_MOVE_MS, formatDuration, framesFor, GOTO_TIMEOUT_MS, SELECTOR_TIMEOUT_MS, type Script } from './tape';

export interface LaunchDeps { launch(): Promise<Browser>; install(): number; log(msg: string): void }

/** Runs the bundled playwright CLI, so the downloaded Chromium always matches our playwright version. */
export function installCommand(): { command: string; args: string[] } {
  // cli.js is not in playwright's exports, so locate it next to package.json.
  const pkgDir = dirname(createRequire(import.meta.url).resolve('playwright/package.json'));
  return { command: process.execPath, args: [join(pkgDir, 'cli.js'), 'install', 'chromium', '--only-shell'] };
}

const defaultDeps: LaunchDeps = {
  launch: () => chromium.launch(),
  install: () => {
    const { command, args } = installCommand();
    // Download progress goes to stderr so stdout stays clean.
    return spawnSync(command, args, { stdio: ['ignore', 2, 2] }).status ?? 1;
  },
  log: m => { process.stderr.write(m + '\n'); },
};

/** Launches headless Chromium, installing it once if the executable is missing. */
export async function launchBrowser(deps: LaunchDeps = defaultDeps): Promise<Browser> {
  try {
    return await deps.launch();
  } catch (e) {
    if (!/Executable doesn't exist/.test(String((e as Error)?.message))) throw e;
  }
  deps.log('Chromium not found. Installing Chromium once (about 120 MB)...');
  if (deps.install() !== 0) {
    const { command, args } = installCommand();
    throw new Error(`Chromium installation failed. Install it manually with:\n  "${command}" "${args[0]}" install chromium --only-shell`);
  }
  return deps.launch();
}

export interface FrameSink { addFrame(png: Buffer, overlay: Overlay): Promise<void> }

export class StepError extends Error {
  constructor(readonly line: number, readonly command: string, readonly reason: string) {
    super(`${command} failed: ${reason}`);
  }
}

/** First line of an error message, without Playwright's "page.goto: " style prefix. */
export function cleanMessage(e: unknown): string {
  return String((e as Error)?.message ?? e).split('\n')[0].replace(/^\w+\.\w+: /, '').replace(/^Error: /, '');
}

/** URLs pass through; anything else is a local file relative to the tape directory. */
export function resolveGotoTarget(arg: string, tapeDir: string): string {
  if (/^(https?|file|about|data):/i.test(arg)) return arg;
  const abs = resolve(tapeDir, arg);
  if (existsSync(abs)) return pathToFileURL(abs).href;
  const hint = /^[\w.-]+:\d+(\/|$)/.test(arg) ? `; did you mean http://${arg} ?` : '';
  throw new Error(`file not found: ${abs}${hint}`);
}

/** Plays the script in a fresh context, sending each frame to the sink. */
export async function recordScript(browser: Browser, script: Script, tapeDir: string, sink: FrameSink): Promise<void> {
  const { width, height, fps } = script.settings;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    let frameIndex = 0;
    let cursor: { x: number; y: number } | null = null;
    let ripples: Array<{ x: number; y: number; clickFrame: number }> = [];
    const capture = async () => {
      const png = await page.screenshot({ type: 'png', caret: 'initial' });
      ripples = ripples.filter(r => rippleAge(frameIndex, r.clickFrame, fps) <= 1);
      const live = ripples.map(r => ({ x: r.x, y: r.y, age: rippleAge(frameIndex, r.clickFrame, fps) }));
      await sink.addFrame(png, { cursor, ripples: live, address: addressText(page.url()) });
      frameIndex++;
    };
    // First visible match, not Playwright's strict mode: demo scripts should be forgiving.
    const visible = async (sel: string, timeout: number) => {
      const el = page.locator(sel).filter({ visible: true }).first();
      try {
        await el.waitFor({ state: 'visible', timeout });
      } catch (e) {
        if ((e as Error)?.name === 'TimeoutError') throw new Error(`"${sel}" not visible within ${formatDuration(timeout)}`);
        throw e;
      }
      return el;
    };
    for (const step of script.steps) {
      try {
        switch (step.kind) {
          case 'Goto': await page.goto(resolveGotoTarget(step.url, tapeDir), { waitUntil: 'load', timeout: GOTO_TIMEOUT_MS }); break;
          case 'Sleep': for (let i = 0; i < step.frames; i++) await capture(); break;
          case 'Type': {
            const chars = [...step.text];
            if (step.frames === 0) await page.keyboard.type(step.text);
            for (let i = 0, typed = 0; i < step.frames; i++) {
              while (typed < charsDue(i, step.frames, chars.length)) await page.keyboard.type(chars[typed++]);
              await capture();
            }
            break;
          }
          case 'Press':
            await page.keyboard.press(step.key);
            for (let i = 0; i < step.frames; i++) await capture();
            break;
          case 'Click': {
            const el = await visible(step.selector, SELECTOR_TIMEOUT_MS);
            await el.scrollIntoViewIfNeeded();
            const box = await el.boundingBox();
            if (!box) throw new Error(`"${step.selector}" has no layout box`);
            const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            const start: { x: number; y: number } = cursor ?? { x: width / 2, y: height / 2 };
            const m = framesFor(CLICK_MOVE_MS, fps);
            for (let i = 1; i <= m; i++) {
              const t = easeInOut(i / m);
              cursor = { x: start.x + (target.x - start.x) * t, y: start.y + (target.y - start.y) * t };
              await page.mouse.move(cursor.x, cursor.y);
              await capture();
            }
            await page.mouse.down();
            await page.mouse.up();
            ripples = [...ripples, { ...target, clickFrame: frameIndex }];
            for (let i = m; i < step.frames; i++) await capture();
            break;
          }
          case 'Wait': await visible(step.selector, step.timeoutMs); break;
          default: throw new StepError(step.line, step.kind, 'not supported yet');
        }
      } catch (e) {
        throw e instanceof StepError ? e : new StepError(step.line, step.kind, cleanMessage(e));
      }
    }
    if (frameIndex !== script.totalFrames) throw new Error(`Internal error: captured ${frameIndex} frames, expected ${script.totalFrames}`);
  } finally {
    await context.close();
  }
}
