import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('Mobile: menu hoạt động, không cuộn ngang', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Mở menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Sinh bộ số' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Number Generator' })).toBeVisible();
  for (const path of ['/', '/generator', '/data', '/statistics', '/predictability', '/xskt', '/capital']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `cuộn ngang tại ${path}`).toBeLessThanOrEqual(1);
  }
});
