import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser } from 'playwright';
import { expect, test } from 'vitest';
import { installCommand, launchBrowser, resolveGotoTarget } from '../src/record';

const fakeBrowser = {} as Browser;
const missing = () => new Error("browserType.launch: Executable doesn't exist at C:\\pw\\chrome-headless-shell.exe");
function deps(launchResults: Array<Browser | Error>, installCode = 0) {
  const calls = { launch: 0, install: 0, log: [] as string[] };
  return { calls, d: {
    launch: async () => { const r = launchResults[calls.launch++]; if (r instanceof Error) throw r; return r; },
    install: () => { calls.install++; return installCode; },
    log: (m: string) => { calls.log.push(m); },
  } };
}
test('launches directly when Chromium exists', async () => {
  const { calls, d } = deps([fakeBrowser]);
  expect(await launchBrowser(d)).toBe(fakeBrowser);
  expect(calls).toMatchObject({ launch: 1, install: 0, log: [] });
});
test('installs once and retries when the executable is missing', async () => {
  const { calls, d } = deps([missing(), fakeBrowser]);
  expect(await launchBrowser(d)).toBe(fakeBrowser);
  expect(calls.install).toBe(1);
  expect(calls.launch).toBe(2);
  expect(calls.log.join('\n')).toContain('Installing Chromium');
});
test('failed install prints the manual command', async () => {
  const { d } = deps([missing()], 1);
  await expect(launchBrowser(d)).rejects.toThrow('install chromium --only-shell');
});
test('other launch errors are rethrown without installing', async () => {
  const { calls, d } = deps([new Error('boom')]);
  await expect(launchBrowser(d)).rejects.toThrow('boom');
  expect(calls.install).toBe(0);
});
test('installCommand uses the bundled playwright CLI', () => {
  const { command, args } = installCommand();
  expect(command).toBe(process.execPath);
  expect(existsSync(args[0])).toBe(true);
  expect(args[0]).toMatch(/cli\.js$/);
  expect(args.slice(1)).toEqual(['install', 'chromium', '--only-shell']);
});
test('resolveGotoTarget passes URLs through', () => {
  for (const u of ['https://example.com/a', 'http://localhost:5173/', 'data:text/html,x', 'about:blank', 'FILE:///C:/x.html'])
    expect(resolveGotoTarget(u, tmpdir())).toBe(u);
});
test('resolveGotoTarget resolves local files against the tape directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'webtape-')); writeFileSync(join(dir, 'page.html'), 'x');
  expect(resolveGotoTarget('page.html', dir)).toBe(pathToFileURL(join(dir, 'page.html')).href);
  expect(resolveGotoTarget(join(dir, 'page.html'), tmpdir())).toBe(pathToFileURL(join(dir, 'page.html')).href);
  expect(() => resolveGotoTarget('nope.html', dir)).toThrow(`file not found: ${join(dir, 'nope.html')}`);
  expect(() => resolveGotoTarget('localhost:3000', dir)).toThrow('did you mean http://localhost:3000 ?');
});
test('a sandbox launch failure says the sandbox stays on, without installing', async () => {
  const { calls, d } = deps([new Error('browserType.launch: Target page, context or browser has been closed\nBrowser logs:\n[pid=1][err] No usable sandbox!')]);
  await expect(launchBrowser(d)).rejects.toThrow(/Chromium could not start with its sandbox enabled.*AppArmor/);
  expect(calls.install).toBe(0);
});
