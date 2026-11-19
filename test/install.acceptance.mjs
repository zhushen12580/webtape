// Story 8 for real: starts from an empty browser folder, so the first run downloads Chromium (about 120 MB).
// Not part of `npm test`, which runs against an already installed browser. Run it with `npm run test:install`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import omggif from 'omggif';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'webtape-install-'));
const browsers = join(root, 'empty-browsers');
const work = join(root, 'work');
mkdirSync(browsers);
mkdirSync(work);
after(() => rmSync(root, { recursive: true, force: true }));

// The story 4 tape: 800x600, 28 frames.
writeFileSync(join(work, 'size.tape'), ['Output size.gif', 'Viewport 800 600', 'Set Framerate 10', 'Set Theme none',
  'Set TypingSpeed 200ms', 'Goto "data:text/html,<input autofocus>"', 'Type "abcd"', 'Sleep 2s'].join('\n'));

function run() {
  const r = spawnSync(process.execPath, [CLI, 'run', 'size.tape'], {
    cwd: work, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers }, encoding: 'utf8', timeout: 600_000,
  });
  assert.equal(r.status, 0, r.stderr);
  const gif = new omggif.GifReader(readFileSync(join(work, 'size.gif')));
  assert.deepEqual([gif.width, gif.height, gif.numFrames()], [800, 600, 28]);
  return r.stderr;
}

test('first run installs Chromium into the empty browser folder, then records', () => {
  const stderr = run();
  assert.match(stderr, /Installing Chromium once/);
  assert.match(stderr, /\d+% of/, 'download progress is shown');
  assert.ok(readdirSync(browsers).some(d => d.startsWith('chromium_headless_shell-')), readdirSync(browsers).join(', '));
});

test('second run reuses that Chromium without installing again', () => {
  rmSync(join(work, 'size.gif'));
  assert.doesNotMatch(run(), /Installing Chromium/);
});
