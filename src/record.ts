import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium, type Browser } from 'playwright';

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
