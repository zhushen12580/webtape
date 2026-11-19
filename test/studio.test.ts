import * as fs from 'node:fs';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { writeOutputs } from '../src/studio';
import { tmpDir } from './helpers';

vi.mock('node:fs', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs')>();
  return { ...real, renameSync: vi.fn(real.renameSync), rmSync: vi.fn(real.rmSync) };
});

const bytes = Buffer.from('new');

test('writes every file, replacing old ones and leaving nothing else behind', () => {
  const dir = tmpDir(); writeFileSync(join(dir, 'a.gif'), 'old');
  writeOutputs([{ path: join(dir, 'a.gif'), bytes }, { path: join(dir, 'out', 'b.mp4'), bytes }]);
  expect(readFileSync(join(dir, 'a.gif'), 'utf8')).toBe('new');
  expect(readFileSync(join(dir, 'out', 'b.mp4'), 'utf8')).toBe('new');
  expect(readdirSync(dir).sort()).toEqual(['a.gif', 'out']);
});
test('a directory in the way fails before any file is replaced', () => {
  const dir = tmpDir(); writeFileSync(join(dir, 'keep.gif'), 'old'); mkdirSync(join(dir, 'blocked.gif'));
  expect(() => writeOutputs([{ path: join(dir, 'keep.gif'), bytes }, { path: join(dir, 'blocked.gif'), bytes }]))
    .toThrow(`Cannot write ${join(dir, 'blocked.gif')}: it is a directory`);
  expect(readFileSync(join(dir, 'keep.gif'), 'utf8')).toBe('old');
  expect(readdirSync(dir).sort()).toEqual(['blocked.gif', 'keep.gif']);
});
test('an output inside the path of another output fails cleanly', () => {
  const dir = tmpDir();
  expect(() => writeOutputs([{ path: join(dir, 'out.gif'), bytes }, { path: join(dir, 'out.gif', 'x.gif'), bytes }]))
    .toThrow(`Cannot write ${join(dir, 'out.gif')}: it is a directory`);
  expect(readdirSync(dir)).toEqual([]);
});
test('a backup that cannot be removed does not fail a finished write', async () => {
  const real = await vi.importActual<typeof import('node:fs')>('node:fs');
  const dir = tmpDir(); const a = join(dir, 'a.gif'); writeFileSync(a, 'old');
  vi.mocked(fs.rmSync).mockImplementation((p, o) => { if (String(p).endsWith('.bak')) throw new Error('EBUSY'); real.rmSync(p, o); });
  const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    writeOutputs([{ path: a, bytes }]);
  } finally {
    vi.mocked(fs.rmSync).mockImplementation(real.rmSync);
    warn.mockRestore();
  }
  expect(readFileSync(a, 'utf8')).toBe('new');
  expect(String(warn.mock.calls[0]?.[0])).toContain('could not remove');
});
test('a failed write removes the directories it created', () => {
  const dir = tmpDir(); writeFileSync(join(dir, 'file'), 'x');
  expect(() => writeOutputs([{ path: join(dir, 'new', 'sub', 'a.gif'), bytes }, { path: join(dir, 'file', 'b.gif'), bytes }])).toThrow();
  expect(readdirSync(dir)).toEqual(['file']);
});
test('a failed swap puts every previous file back', async () => {
  const real = await vi.importActual<typeof import('node:fs')>('node:fs');
  const dir = tmpDir(); const [a, b, c] = ['a.gif', 'b.gif', 'c.gif'].map(f => join(dir, f));
  writeFileSync(a, 'old a'); writeFileSync(c, 'old c');
  let failed = false;   // only the first move onto c fails, as if a viewer held it open
  vi.mocked(fs.renameSync).mockImplementation((from, to) => {
    if (to === c && !failed) { failed = true; throw new Error('EBUSY: resource busy or locked'); }
    real.renameSync(from, to);
  });
  try {
    expect(() => writeOutputs([a, b, c].map(path => ({ path, bytes })))).toThrow('EBUSY');
  } finally {
    vi.mocked(fs.renameSync).mockImplementation(real.renameSync);
  }
  expect(readFileSync(a, 'utf8')).toBe('old a');
  expect(readFileSync(c, 'utf8')).toBe('old c');
  expect(existsSync(b)).toBe(false);
  expect(readdirSync(dir).sort()).toEqual(['a.gif', 'c.gif']);
});
