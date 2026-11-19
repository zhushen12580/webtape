import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ROOT, runCli, tmpDir, writeTape } from './helpers';

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
