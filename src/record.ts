import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { addressText, type Overlay } from './shared';
import { GOTO_TIMEOUT_MS, type Script } from './tape';

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

/** Plays the script in a fresh context, sending each frame to the sink. */
export async function recordScript(browser: Browser, script: Script, tapeDir: string, sink: FrameSink): Promise<void> {
  const { width, height } = script.settings;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    let frameIndex = 0;
    const capture = async () => {
      const png = await page.screenshot({ type: 'png', caret: 'initial' });
      await sink.addFrame(png, { cursor: null, ripples: [], address: addressText(page.url()) });
      frameIndex++;
    };
    for (const step of script.steps) {
      try {
        switch (step.kind) {
          case 'Goto': await page.goto(step.url, { waitUntil: 'load', timeout: GOTO_TIMEOUT_MS }); break;
          case 'Sleep': for (let i = 0; i < step.frames; i++) await capture(); break;
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
