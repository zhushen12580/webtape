import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { copyFixture, readGif, ROOT, runCli, tmpDir, writeTape } from './helpers';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

test('--version and -v print the package.json version', () => {
  for (const flag of ['--version', '-v']) {
    const r = runCli([flag]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  }
});

test('--help and -h describe init and run', () => {
  for (const flag of ['--help', '-h']) {
    const r = runCli([flag]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('webtape init [--force]');
    expect(r.stdout).toContain('webtape run <file.tape> [-o <path>]...');
  }
});

test('no arguments prints usage to stderr and exits 2', () => {
  const r = runCli([]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain('Usage:');
});

const BAD = ['Output bad.gif', 'Goto "data:text/html,<button id=add>Add</button>"', 'Clik "#add"'];
test('story 6a: parse error reports file:line and suggestion, writes nothing, exits fast', () => {
  const dir = tmpDir(); writeTape(dir, 'bad.tape', BAD);
  const r = runCli(['run', 'bad.tape'], { cwd: dir });
  expect(r.code).toBe(1);
  expect(r.stderr).toContain('bad.tape:3:');
  expect(r.stderr).toContain('Unknown command "Clik"');
  expect(r.stderr).toContain('Did you mean "Click"?');
  expect(existsSync(join(dir, 'bad.gif'))).toBe(false);
  expect(r.ms).toBeLessThan(3000);
});
test('every parse error is printed on its own line', () => {
  const dir = tmpDir(); writeTape(dir, 'two.tape', ['Goto x', 'Clik a', 'Sleep 5', 'Sleep 1s']);
  const r = runCli(['run', 'two.tape'], { cwd: dir });
  expect(r.stderr.split(/\r?\n/).filter(l => /^two\.tape:\d+: /.test(l))).toHaveLength(2);
});
test('UTF-16LE tape (PowerShell Out-File) is decoded', () => {
  const dir = tmpDir();
  writeFileSync(join(dir, 'bad.tape'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(BAD.join('\r\n'), 'utf16le')]));
  const r = runCli(['run', 'bad.tape'], { cwd: dir });
  expect(r.stderr).toContain('bad.tape:3: Unknown command "Clik"');
});
test('story 6c: run without a tape prints usage and exits 2', () => {
  const r = runCli(['run']);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain('Usage:');
});
test('unknown subcommand and bad -o extension exit 2', () => {
  expect(runCli(['record']).code).toBe(2);
  const dir = tmpDir(); writeTape(dir, 'ok.tape', ['Goto x', 'Sleep 1s']);
  expect(runCli(['run', 'ok.tape', '-o', 'x.png'], { cwd: dir }).code).toBe(2);
});
test('missing tape file exits 1', () => {
  const r = runCli(['run', 'nope.tape'], { cwd: tmpDir() });
  expect(r.code).toBe(1);
  expect(r.stderr).toContain('nope.tape');
});
test('valid tape announces the recording plan on stderr', () => {
  const dir = tmpDir(); writeTape(dir, 'ok.tape', ['Goto "data:text/html,hi"', 'Sleep 1s']);
  expect(runCli(['run', 'ok.tape'], { cwd: dir }).stderr).toContain('Recording ok.tape -> 20 frames (1.00s @ 20 fps)');
});

const RED = 'Goto "data:text/html,<body style=margin:0;background:red>"';
test('records a data: URL to GIF with Theme none', () => {
  const dir = tmpDir(); writeTape(dir, 't.tape', ['Output a.gif', 'Set Theme none', RED, 'Sleep 1s']);
  const r = runCli(['run', 't.tape'], { cwd: dir });
  expect(r.code).toBe(0);
  expect(r.stderr).toContain('Recording t.tape -> 20 frames (1.00s @ 20 fps)');
  expect(r.stdout.trim()).toMatch(/^Wrote a\.gif \(1280x720, 20 frames, 1\.00s, \d+\.\d (KB|MB)\)$/);
  const g = readGif(join(dir, 'a.gif'));
  expect([g.width, g.height, g.frames, g.loop]).toEqual([1280, 720, 20, 0]);
  expect(Math.abs(g.totalDelayMs - 1000)).toBeLessThanOrEqual(10);
  const [r0, g0, b0] = g.pixel(0, 10, 10);
  expect(r0).toBeGreaterThan(200); expect(g0).toBeLessThan(60); expect(b0).toBeLessThan(60);
});
test('default theme adds a 40px title bar', () => {
  const dir = tmpDir(); writeTape(dir, 't.tape', ['Output a.gif', RED, 'Sleep 100ms']);
  expect(runCli(['run', 't.tape'], { cwd: dir }).code).toBe(0);
  expect(readGif(join(dir, 'a.gif')).height).toBe(760);
});
test('default output is <tape name>.gif next to the tape', () => {
  const dir = tmpDir(); mkdirSync(join(dir, 'sub')); writeTape(join(dir, 'sub'), 'clip.tape', [RED, 'Sleep 100ms']);
  const r = runCli(['run', join('sub', 'clip.tape')], { cwd: dir });
  expect(r.code).toBe(0);
  expect(existsSync(join(dir, 'sub', 'clip.gif'))).toBe(true);
  expect(r.stdout).toContain(`Wrote ${join('sub', 'clip.gif')} (`);
});
test('-o replaces tape outputs and is relative to cwd', () => {
  const dir = tmpDir(); writeTape(dir, 't.tape', ['Output a.gif', RED, 'Sleep 100ms']);
  expect(runCli(['run', 't.tape', '-o', join('out', 'b.gif')], { cwd: dir }).code).toBe(0);
  expect(existsSync(join(dir, 'out', 'b.gif'))).toBe(true);
  expect(existsSync(join(dir, 'a.gif'))).toBe(false);
});
test('runtime failure keeps the previous output file', () => {
  const dir = tmpDir(); writeFileSync(join(dir, 'keep.gif'), 'old');
  writeTape(dir, 't.tape', ['Output keep.gif', RED, 'Sleep 500ms', 'Goto "http://127.0.0.1:9/"']);
  const r = runCli(['run', 't.tape'], { cwd: dir });
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(/t\.tape:4: Goto failed: /);
  expect(readFileSync(join(dir, 'keep.gif'), 'utf8')).toBe('old');
});

test('Goto resolves files relative to the tape dir, with spaces and non-ASCII names', () => {
  const dir = tmpDir(); const sub = join(dir, 'My Demos 演示'); mkdirSync(sub);
  copyFixture('page.html', sub, '页面 one.html');
  writeTape(sub, 't.tape', ['Set Theme none', 'Goto "页面 one.html"', 'Sleep 100ms']);
  const r = runCli(['run', join('My Demos 演示', 't.tape')], { cwd: dir });
  expect(r.code).toBe(0);
  expect(readGif(join(sub, 't.gif')).pixel(0, 10, 10)[0]).toBeGreaterThan(200);
});
test('Goto accepts an absolute Windows path in single quotes', () => {
  const dir = tmpDir(); const html = copyFixture('page.html', dir);
  writeTape(dir, 't.tape', ['Set Theme none', `Goto '${html}'`, 'Sleep 100ms']);
  expect(runCli(['run', 't.tape'], { cwd: dir }).code).toBe(0);
});
test('missing local file and host:port hint are runtime errors with line numbers', () => {
  const dir = tmpDir();
  writeTape(dir, 'a.tape', ['Output a.gif', 'Goto nope.html', 'Sleep 1s']);
  const a = runCli(['run', 'a.tape'], { cwd: dir });
  expect(a.code).toBe(1);
  expect(a.stderr).toContain('a.tape:2: Goto failed: file not found:');
  writeTape(dir, 'b.tape', ['Goto localhost:3000', 'Sleep 1s']);
  expect(runCli(['run', 'b.tape'], { cwd: dir }).stderr).toContain('did you mean http://localhost:3000 ?');
});

const SIZE = ['Output size.gif', 'Viewport 800 600', 'Set Framerate 10', 'Set Theme none', 'Set TypingSpeed 200ms',
  'Goto "data:text/html,<input autofocus>"', 'Type "abcd"', 'Sleep 2s'];
test('story 4: same tape gives the same size and frame count twice', () => {
  const dir = tmpDir(); writeTape(dir, 'size.tape', SIZE);
  for (let i = 0; i < 2; i++) {
    expect(runCli(['run', 'size.tape'], { cwd: dir }).code).toBe(0);
    const g = readGif(join(dir, 'size.gif'));
    expect([g.width, g.height, g.frames]).toEqual([800, 600, 28]);
  }
});
test('Type types real keys and Press presses after typing', () => {
  const dir = tmpDir(); copyFixture('type.html', dir);
  writeTape(dir, 't.tape', ['Set Theme none', 'Set Framerate 10', 'Goto type.html', 'Type "abcd"', 'Press Enter']);
  expect(runCli(['run', 't.tape'], { cwd: dir }).code).toBe(0);
  const g = readGif(join(dir, 't.gif'));
  expect(g.frames).toBe(4);
  expect(g.pixel(0, 5, 300)).toEqual([255, 255, 255]);      // 只输入了 "ab"
  const lime = g.pixel(1, 5, 300); expect(lime[1]).toBeGreaterThan(200); expect(lime[0]).toBeLessThan(60);
  const blue = g.pixel(2, 5, 300); expect(blue[2]).toBeGreaterThan(200); expect(blue[0]).toBeLessThan(60);
});
test('Type handles Chinese and emoji', () => {
  const dir = tmpDir(); copyFixture('type.html', dir);
  writeTape(dir, 't.tape', ['Set Theme none', 'Set Framerate 10', 'Goto type.html', 'Type "你好🙂"']);
  expect(runCli(['run', 't.tape'], { cwd: dir }).code).toBe(0);
  const g = readGif(join(dir, 't.gif'));
  expect(g.frames).toBe(2);
  expect(g.pixel(1, 5, 300)[1]).toBeGreaterThan(200);
});
test('unknown key is a runtime error with the line number', () => {
  const dir = tmpDir(); writeTape(dir, 't.tape', ['Goto "data:text/html,hi"', 'Sleep 100ms', 'Press NotAKey']);
  const r = runCli(['run', 't.tape'], { cwd: dir });
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(/t\.tape:3: Press failed: /);
});
