import { expect, test } from 'vitest';
import { COMMANDS, SETTINGS, editDistance, formatDuration, parseDuration, suggest, tokenize } from '../src/tape';

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
