import { expect, test } from 'vitest';
import { addressText, easeInOut, formatBytes, gifDelayMs, outputSize, rippleAge } from '../src/shared';

test('easeInOut endpoints and monotonic', () => {
  expect([easeInOut(0), easeInOut(0.5), easeInOut(1)]).toEqual([0, 0.5, 1]);
  for (let t = 0; t < 1; t += 0.05) expect(easeInOut(t + 0.05)).toBeGreaterThanOrEqual(easeInOut(t));
});
test.each([20, 30, 7])('gif delays at %i fps stay within 10ms of real time', fps => {
  for (const n of [1, 7, 148]) {
    let sum = 0;
    for (let k = 0; k < n; k++) { const d = gifDelayMs(k, fps); expect(d % 10).toBe(0); expect(d).toBeGreaterThanOrEqual(10); sum += d; }
    expect(Math.abs(sum - n * 1000 / fps)).toBeLessThanOrEqual(10);
  }
  expect([0, 1, 2].map(k => gifDelayMs(k, 30))).toEqual([30, 40, 30]);
});
test('addressText hides query, hash and local paths', () => {
  expect(addressText('https://example.com/app/page?token=abc#x')).toBe('example.com/app/page');
  expect(addressText('http://localhost:5173/')).toBe('localhost:5173/');
  expect(addressText('file:///C:/Users/alice/demo.html')).toBe('demo.html');
  expect(addressText('file:///C:/Users/alice/my%20page.html?x=1#y')).toBe('my page.html');
  expect(addressText('data:text/html,<h1>x</h1>')).toBe('');
  expect(addressText('about:blank')).toBe('');
  expect(addressText('not a url')).toBe('');
});
test('outputSize adds the title bar', () => {
  expect(outputSize(1280, 720, 'light')).toEqual({ width: 1280, height: 760 });
  expect(outputSize(800, 600, 'dark')).toEqual({ width: 800, height: 640 });
  expect(outputSize(800, 600, 'none')).toEqual({ width: 800, height: 600 });
});
test('formatBytes', () => {
  expect([formatBytes(512), formatBytes(1536), formatBytes(1048576), formatBytes(5.5 * 1048576)])
    .toEqual(['0.5 KB', '1.5 KB', '1.0 MB', '5.5 MB']);
});
test('rippleAge', () => {
  expect(rippleAge(10, 10, 20)).toBe(0.125);
  expect(rippleAge(17, 10, 20)).toBe(1);
});
