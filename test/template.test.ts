import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { launchBrowser } from '../src/record';
import { ROOT } from './helpers';

test('templates/demo.html is offline and matches the template contract', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const urls: string[] = [];
    page.on('request', r => { urls.push(r.url()); });
    await page.goto(pathToFileURL(join(ROOT, 'templates', 'demo.html')).href);
    await page.waitForLoadState('load');
    for (const u of urls) expect(u).toMatch(/^(file|data):/);

    expect(await page.locator('#new-todo').isVisible()).toBe(true);
    const add = page.getByRole('button', { name: 'Add', exact: true });
    expect(await add.count()).toBe(1);
    const text = (await page.evaluate(() => document.body.innerText)).toLowerCase();
    expect(text.split('add').length - 1).toBe(1);
    expect(text).not.toContain('saved');
    const placeholders = await page.evaluate(() =>
      [...document.querySelectorAll('[placeholder]')].map(e => e.getAttribute('placeholder')!.toLowerCase()));
    for (const p of placeholders) expect(p).not.toContain('add');

    const list = await page.evaluate(() => {
      const l = document.querySelector('#todo-list')!;
      return { overflow: getComputedStyle(l).overflowY, scroll: l.scrollHeight, client: l.clientHeight, items: l.children.length };
    });
    expect(['auto', 'scroll']).toContain(list.overflow);
    expect(list.scroll).toBeGreaterThan(list.client);
    expect(list.items).toBeGreaterThanOrEqual(8);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThanOrEqual(1200);
    expect((await page.textContent('#save'))!.trim()).toBe('Save');

    const count = () => page.evaluate(() => document.querySelector('#todo-list')!.children.length);
    const n = await count();
    await page.fill('#new-todo', 'Alpha');
    await add.click();
    expect(await count()).toBe(n + 1);
    expect(await page.inputValue('#new-todo')).toBe('');
    await page.fill('#new-todo', 'Beta');
    await page.press('#new-todo', 'Enter');
    expect(await count()).toBe(n + 2);

    const start = Date.now();
    await page.click('#save');
    await expect.poll(async () => (await page.textContent('#save'))!.trim(), { timeout: 300, interval: 20 }).toBe('Saving…');
    await page.waitForSelector('text=Saved', { timeout: 2500 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(1200);
  } finally {
    await browser.close();
  }
});
