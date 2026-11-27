import { test, expect } from './fixtures';

test('运行时没有外部网络请求或严重脚本错误', async ({ page }) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    const effectiveUrl = url.protocol === 'blob:' ? new URL(url.pathname) : url;
    if (!['127.0.0.1', 'localhost'].includes(effectiveUrl.hostname) && !request.url().startsWith('data:')) external.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '开 局' }).click();
  await expect(page.locator('.draft-option')).toHaveCount(7);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
