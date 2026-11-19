import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ROOT, runCli } from './helpers';

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
