import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { readGif, ROOT } from './helpers';

const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const lines = readme.split(/\r?\n/);

test('README opens with title, one-liner and the demo GIF before any section', () => {
  const firstSection = lines.findIndex(l => l.startsWith('## '));
  const img = lines.findIndex(l => /!\[[^\]]*\]\(docs\/images\/demo\.gif\)/.test(l));
  expect(lines[0]).toMatch(/^# WebTape/);
  expect(img).toBeGreaterThan(0);
  expect(img).toBeLessThan(firstSection);
});

test('README has quick start, full command table and agent section', () => {
  expect(readme).toContain('## Quick start');
  expect(readme).toContain('webtape init');
  expect(readme).toContain('webtape run demo.tape');
  for (const c of ['Output', 'Viewport', 'Set', 'Goto', 'Click', 'Type', 'Press', 'Scroll', 'Wait', 'Sleep'])
    expect(readme).toMatch(new RegExp('^\\| `' + c + '\\b', 'm'));
  for (const k of ['Framerate', 'Theme', 'TypingSpeed']) expect(readme).toContain(k);
  expect(readme).toContain('Let your agent record the demo');
  expect(lines.filter(l => l !== '').at(-1)).toBe('Built with Claude Code & Codex');
});

test('docs/images/demo.gif is the recorded template', () => {
  const g = readGif(join(ROOT, 'docs', 'images', 'demo.gif'));
  expect([g.width, g.height, g.frames]).toEqual([1280, 760, 148]);
  expect(g.size).toBeLessThanOrEqual(5 * 1024 * 1024);
});

test('.env.example documents the optional browser path and that the shell must export it', () => {
  const env = readFileSync(join(ROOT, '.env.example'), 'utf8');
  expect(env).toMatch(/^# ?PLAYWRIGHT_BROWSERS_PATH=/m);
  expect(env).toContain('$env:PLAYWRIGHT_BROWSERS_PATH');
  expect(env).toContain('export PLAYWRIGHT_BROWSERS_PATH');
});

test('README states the CLI Node minimum and, separately, the Node versions the test runner supports', () => {
  const vitestNode = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'vitest', 'package.json'), 'utf8')).engines.node;
  const cliNode = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines.node;
  expect(cliNode).toBe('>=20');
  expect(readme).toContain('The CLI needs Node.js 20 or newer.');
  expect(readme).toContain(`\`${vitestNode}\``);
});
