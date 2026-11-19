import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  COMMANDS, SETTINGS, charsDue, decodeTape, editDistance, formatDuration, framesFor, parseDuration, parseTape, suggest, tokenize,
} from '../src/tape';

test('tokenize splits on whitespace and keeps mid-word # and quotes', () => {
  expect(tokenize('  Click\t#add  ')).toEqual(['Click', '#add']);
  expect(tokenize('Click text="Foo"')).toEqual(['Click', 'text="Foo"']);
});
test('tokenize double quotes: only \\" and \\\\ escape', () => {
  expect(tokenize(String.raw`Type "a \"b\" \\ c"`)).toEqual(['Type', String.raw`a "b" \ c`]);
  expect(tokenize(String.raw`Goto "C:\Users\me\x.html"`)).toEqual(['Goto', String.raw`C:\Users\me\x.html`]);
  expect(tokenize('Type ""')).toEqual(['Type', '']);
});
test('tokenize single quotes do not escape', () => {
  expect(tokenize(String.raw`Type 'a\"b'`)).toEqual(['Type', String.raw`a\"b`]);
});
test('tokenize rejects unterminated strings', () => {
  expect(() => tokenize('Type "abc')).toThrow('Unterminated string');
  expect(() => tokenize("Type 'abc")).toThrow('Unterminated string');
  expect(() => tokenize(String.raw`Type "abc\"`)).toThrow('Unterminated string');
});
test('parseDuration requires a unit', () => {
  expect(parseDuration('500ms')).toBe(500);
  expect(parseDuration('1.5s')).toBe(1500);
  expect(parseDuration('2s')).toBe(2000);
  expect(parseDuration('1.1s')).toBe(1100);
  for (const bad of ['5', '1.5 s', '-1s', '1m', '.5s', 's', '']) expect(parseDuration(bad)).toBeUndefined();
});
test('formatDuration', () => {
  expect(formatDuration(1000)).toBe('1s');
  expect(formatDuration(1500)).toBe('1.5s');
  expect(formatDuration(10000)).toBe('10s');
  expect(formatDuration(500)).toBe('500ms');
});
test('suggest finds close command names', () => {
  expect(editDistance('kitten', 'sitting')).toBe(3);
  expect(suggest('Clik', COMMANDS)).toBe('Click');
  expect(suggest('click', COMMANDS)).toBe('Click');
  expect(suggest('Slep', COMMANDS)).toBe('Sleep');
  expect(suggest('Frobnicate', COMMANDS)).toBeUndefined();
  expect(suggest('Framrate', SETTINGS)).toBe('Framerate');
});

const DEMO_TAPE = `# WebTape demo. Record it with: webtape run demo.tape
Output demo.gif
Viewport 1280 720
Set Framerate 20
Set Theme light
Set TypingSpeed 50ms

Goto demo.html
Wait "#new-todo"
Sleep 500ms
Click "#new-todo"
Type "Record a demo with WebTape"
Press Enter
Sleep 500ms
Click "#save"
Wait "text=Saved"
Sleep 1s
Scroll "#todo-list" 240
Sleep 500ms
Scroll 400
Sleep 1s
`;
const FLOW_TAPE = `Output flow.gif
Goto demo.html
Click "#new-todo"
Type "Ship it"
Click "text=Add"
Click "#save"
Wait "text=Saved"
Sleep 1s
Scroll "#todo-list" 200
Scroll 300
`;
const SIZE_TAPE = `Output size.gif
Viewport 800 600
Set Framerate 10
Set Theme none
Set TypingSpeed 200ms
Goto "data:text/html,<input autofocus>"
Type "abcd"
Sleep 2s
`;
const FORMATS_TAPE = `Output out/a.gif
Output out/a.webm
Output out/a.mp4
Set Framerate 20
Goto "data:text/html,<h1>Formats</h1>"
Sleep 1s
`;

const ok = (src: string) => { const r = parseTape(src); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.script; };
const errs = (src: string) => { const r = parseTape(src); expect(r.ok).toBe(false); return r.ok ? [] : r.errors; };

test('frame counts from the spec', () => {
  expect(ok(DEMO_TAPE).totalFrames).toBe(148);
  expect(ok(FLOW_TAPE).totalFrames).toBe(89);
  const size = ok(SIZE_TAPE);
  expect(size.totalFrames).toBe(28);
  expect(size.settings).toEqual({ width: 800, height: 600, fps: 10, theme: 'none', typingSpeedMs: 200 });
  const f = ok(FORMATS_TAPE);
  expect(f.totalFrames).toBe(20);
  expect(f.outputs.map(o => [o.path, o.format])).toEqual([['out/a.gif','gif'], ['out/a.webm','webm'], ['out/a.mp4','mp4']]);
});
test('defaults', () => {
  expect(ok('Goto x\nSleep 1s').settings).toEqual({ width: 1280, height: 720, fps: 20, theme: 'light', typingSpeedMs: 50 });
});
test('BOM, CRLF, comments and blank lines keep line numbers right', () => {
  const e = errs('\uFEFF# comment\r\n\r\nGoto x\r\nClik "#a"\r\nSleep 1s\r\n');
  expect(e).toEqual([{ line: 4, message: 'Unknown command "Clik". Did you mean "Click"?' }]);
});
test('mid-line # is not a comment', () => {
  expect(ok('Goto x\nClick #add').steps[1]).toMatchObject({ kind: 'Click', selector: '#add', frames: 14 });
});
test('unknown commands and settings', () => {
  expect(errs('Goto x\nFrobnicate\nSleep 1s')[0].message).toBe('Unknown command "Frobnicate"');
  expect(errs('Goto x\nclick a\nSleep 1s')[0].message).toContain('Did you mean "Click"?');
  expect(errs('Set Framrate 10\nGoto x\nSleep 1s')[0].message).toBe('Unknown setting "Framrate". Did you mean "Framerate"?');
});
test.each([
  ['Viewport 801 600', 'Viewport width must be an even integer'], ['Viewport 2000 600', 'from 320 to 1920'],
  ['Viewport 800 100', 'Viewport height'], ['Viewport 800', 'Usage: Viewport <width> <height>'],
  ['Set Framerate 0', 'Framerate must be'], ['Set Framerate 51', 'Framerate must be'], ['Set Framerate 2.5', 'Framerate must be'],
  ['Set Theme blue', 'Theme must be light, dark or none'], ['Set TypingSpeed 5ms', 'TypingSpeed must be'],
  ['Set TypingSpeed 2s', 'TypingSpeed must be'], ['Set TypingSpeed 50', 'Invalid duration "50"'],
  ['Output a.png', 'Output must end with .gif, .webm or .mp4'],
])('setting line %s -> %s', (line, msg) => {
  const e = errs(`${line}\nGoto x\nSleep 1s`);
  expect(e[0]).toMatchObject({ line: 1 });
  expect(e[0].message).toContain(msg);
});
test.each([
  ['Sleep 0s', 'Sleep duration'], ['Sleep 61s', 'Sleep duration'], ['Sleep 5', 'Invalid duration "5"'],
  ['Type ""', 'Type text must not be empty'], ['Scroll 0', 'Scroll pixels'], ['Scroll 100001', 'Scroll pixels'],
  ['Scroll 1.5', 'Scroll pixels'], ['Scroll 100 0ms', 'Scroll duration'], ['Scroll a b c d', 'Usage: Scroll [selector] <pixels> [duration]'],
  ['Wait "#a" 50ms', 'Wait timeout'], ['Wait "#a" 61s', 'Wait timeout'], ['Click', 'Usage: Click <selector>'],
  ['Click a b', 'Usage: Click <selector>'], ['Goto', 'Usage: Goto <url>'], ['Press', 'Usage: Press <key>'],
  ['Click "#a', 'Unterminated string'],
])('action line %s -> %s', (line, msg) => {
  const e = errs(`Goto x\n${line}\nSleep 1s`);
  expect(e[0]).toMatchObject({ line: 2 });
  expect(e[0].message).toContain(msg);
});
test('Output anywhere, duplicates rejected case-insensitively', () => {
  expect(ok('Goto x\nSleep 1s\nOutput a.gif').outputs).toHaveLength(1);
  expect(errs('Output out/A.gif\nOutput out\\a.GIF\nGoto x\nSleep 1s')[0]).toMatchObject({ line: 2, message: 'Duplicate Output "out\\a.GIF"' });
});
test('duplicate Output compares resolved destinations, not spellings', () => {
  const dir = join(tmpdir(), 'tapes');
  const dup = (a: string, b: string) => {
    const r = parseTape(`Output ${a}\nOutput ${b}\nGoto x\nSleep 1s`, dir);
    expect(r.ok ? [] : r.errors).toEqual([{ line: 2, message: `Duplicate Output "${b}"` }]);
  };
  dup('alias.gif', './alias.gif');
  dup('alias.gif', 'sub/../alias.gif');
  dup('alias.gif', join(dir, 'alias.gif'));
  expect(parseTape('Output a/x.gif\nOutput b/x.gif\nGoto x\nSleep 1s', dir).ok).toBe(true);
});
test('ordering rules', () => {
  expect(errs('Goto x\nViewport 800 600\nSleep 1s')[0]).toEqual({ line: 2, message: 'Viewport must come before the first action command' });
  expect(errs('Goto x\nSet Theme dark\nSleep 1s')[0].message).toBe('Set must come before the first action command');
  expect(errs('Viewport 800 600\nViewport 800 600\nGoto x\nSleep 1s')[0].message).toBe('Viewport can only be set once');
  expect(errs('Set Framerate 10\nSet Framerate 20\nGoto x\nSleep 1s')[0].message).toBe('Set Framerate can only be set once');
  expect(errs('Output a.gif\nSleep 1s\nGoto x')[0]).toEqual({ line: 2, message: 'The first action command must be Goto' });
});
test('totals', () => {
  expect(errs('Goto x')[0]).toEqual({ line: 1, message: 'Tape produces no frames' });
  expect(ok('Goto x\n' + 'Sleep 60s\n'.repeat(5)).totalFrames).toBe(6000);
  expect(errs('Goto x\n' + 'Sleep 60s\n'.repeat(6))[0]).toEqual({ line: 1, message: 'Tape is too long: 360.00s (max 300s)' });
});
test('collects all errors', () => {
  expect(errs('Goto x\nClik a\nSleep 5\nSleep 1s').map(e => e.line)).toEqual([2, 3]);
});
test('Scroll argument forms', () => {
  const s = ok('Goto x\nScroll 300\nScroll "#l" 200\nScroll -100 1s\nScroll "#l" 200 250ms').steps;
  expect(s.slice(1)).toMatchObject([
    { selector: null, pixels: 300, frames: 10 }, { selector: '#l', pixels: 200, frames: 10 },
    { selector: null, pixels: -100, frames: 20 }, { selector: '#l', pixels: 200, frames: 5 },
  ]);
});
test('Wait timeouts and zero frames', () => {
  const s = ok('Goto x\nWait "#a"\nWait "#a" 1.5s\nSleep 1s').steps;
  expect(s[1]).toMatchObject({ timeoutMs: 10000, frames: 0 });
  expect(s[2]).toMatchObject({ timeoutMs: 1500 });
});
test('Type counts code points; per-command rounding', () => {
  expect(ok('Goto x\nType "你好🙂"').steps[1].frames).toBe(3);
  expect(ok('Goto x\nSleep 10ms\nSleep 1s').steps[1].frames).toBe(0);
  expect(ok('Set Framerate 7\nGoto x\nClick a').steps[1].frames).toBe(5);
});
test('framesFor and charsDue', () => {
  expect([framesFor(500, 20), framesFor(500, 7), framesFor(10, 20), framesFor(700, 1)]).toEqual([10, 4, 0, 1]);
  expect([0, 1, 2, 7].map(i => charsDue(i, 8, 4))).toEqual([1, 1, 2, 4]);
  expect([0, 1].map(i => charsDue(i, 2, 4))).toEqual([2, 4]);
});
test('decodeTape handles UTF-8 BOM and UTF-16LE from PowerShell', () => {
  expect(decodeTape(Buffer.from('\uFEFFGoto x', 'utf8'))).toBe('Goto x');
  expect(decodeTape(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Goto x', 'utf16le')]))).toBe('Goto x');
});
