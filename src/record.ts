import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Locator } from 'playwright';
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
  // Tapes open arbitrary URLs, so Chromium keeps its sandbox (Playwright turns it off by default).
  launch: () => chromium.launch({ chromiumSandbox: true }),
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
    return await launchSandboxed(deps);
  } catch (e) {
    if (!/Executable doesn't exist/.test(String((e as Error)?.message))) throw e;
  }
  deps.log('Chromium not found. Installing Chromium once (about 120 MB)...');
  if (deps.install() !== 0) {
    const { command, args } = installCommand();
    throw new Error(`Chromium installation failed. Install it manually with:\n  "${command}" "${args[0]}" install chromium --only-shell`);
  }
  return launchSandboxed(deps);
}

// The texts Playwright and Chromium use when the sandbox cannot start.
const SANDBOX_FAILURE = /sandboxing failed|No usable sandbox|crbug\.com\/(357670|638180)/;

function launchSandboxed(deps: LaunchDeps): Promise<Browser> {
  return deps.launch().catch((e: unknown) => {
    if (!SANDBOX_FAILURE.test(String((e as Error)?.message))) throw e;
    throw new Error('Chromium could not start with its sandbox enabled. WebTape keeps the sandbox on because tapes '
      + 'open arbitrary pages, so run it as a regular (non-root) user on a system that supports the Chromium sandbox.');
  });
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

/** Waits up to the selector timeout for the element to be on top at the point; returns what covers it, if anything. */
async function coveredBy(el: Locator, point: { x: number; y: number }): Promise<string> {
  const hitTest = () => el.evaluate((e, { x, y }) => {
    const hit = (e.getRootNode() as Document | ShadowRoot).elementFromPoint(x, y);
    // As in Playwright, a hit on the enclosing button or link, or on a label of the target, still reaches it.
    const target = e.closest('button,a,[role=button],[role=link]') ?? e;
    if (hit && (target.contains(hit) || target.contains(hit.closest('label')?.control ?? null))) return '';
    return hit ? `<${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}${[...hit.classList].map(c => `.${c}`).join('')}>` : 'nothing';
  }, point);
  const end = Date.now() + SELECTOR_TIMEOUT_MS;
  let blocker = await hitTest();
  while (blocker && Date.now() < end) {
    await el.page().waitForTimeout(100);
    blocker = await hitTest();
  }
  return blocker;
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
          case 'Goto':
            await page.goto(resolveGotoTarget(step.url, tapeDir), { waitUntil: 'load', timeout: GOTO_TIMEOUT_MS });
            // Autofocus happens in the next rendering update, which can come after load; let it land before Type.
            // A page that navigates away on load destroys this context, and then there is nothing to wait for.
            await page.evaluate(() => new Promise(r => requestAnimationFrame(r))).catch(() => undefined);
            break;
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
            // The real click lands on whatever is on top at that point, so it must be the target.
            const blocker = await coveredBy(el, target);
            if (blocker) {
              const at = `(${Math.round(target.x)}, ${Math.round(target.y)})`;
              throw new Error(`"${step.selector}" is covered by ${blocker} at ${at} and would not receive the click`);
            }
            await page.mouse.down();
            await page.mouse.up();
            ripples = [...ripples, { ...target, clickFrame: frameIndex }];
            for (let i = m; i < step.frames; i++) await capture();
            break;
          }
          case 'Wait': await visible(step.selector, step.timeoutMs); break;
          case 'Scroll': {
            const el = step.selector ? await visible(step.selector, SELECTOR_TIMEOUT_MS) : null;
            // The browser clamps top to the scrollable range.
            const scrollTo = (top: number) => el
              ? el.evaluate((e, top) => e.scrollTo({ top, behavior: 'instant' }), top)
              : page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), top);
            const start = await (el ? el.evaluate(e => e.scrollTop) : page.evaluate(() => window.scrollY));
            const n = step.frames;
            if (n === 0) await scrollTo(start + step.pixels);
            for (let i = 1; i <= n; i++) {
              await scrollTo(start + easeInOut(i / n) * step.pixels);
              await capture();
            }
            break;
          }
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
