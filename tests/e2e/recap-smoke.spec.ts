// tests/e2e/recap-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('connecting a platform and generating a recap redirects to a shareable card', async ({ page }) => {
  await page.route('**/api/recap', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ handles: { youtube: null, tiktok: null, instagram: null }, recapCardId: null }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ recapCard: { id: 'e2e-recap-1' } }),
    });
  });

  await page.route('**/api/recap/handles', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.route('**/api/recap/e2e-recap-1', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        recapCard: {
          id: 'e2e-recap-1',
          month: '2026-08-01',
          totals: { views: 127000, likes: 8200, comments: 430, postCount: 14 },
          topPost: {
            platform: 'tiktok',
            captionOrTitle: 'Wait for it...',
            viewCount: 52000,
            permalink: 'https://tiktok.com/@creator/video/1',
          },
        },
      }),
    });
  });

  await page.route('**/recap/e2e-recap-1/image', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      // 1x1 transparent PNG — content doesn't matter for this smoke test,
      // only that the page requests and displays an image at this URL.
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      ),
    });
  });

  await page.goto('/recap');
  await page.getByLabel(/youtube channel handle/i).fill('creator');
  await page.getByRole('button', { name: /save platforms/i }).click();
  await page.getByRole('button', { name: /generate this month/i }).click();

  await expect(page).toHaveURL(/\/recap\/e2e-recap-1$/);
  await expect(page.getByRole('heading', { name: /august 2026 recap/i })).toBeVisible();
  await expect(page.getByRole('img', { name: /august 2026 recap card/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /download image/i })).toBeVisible();
});
