// tests/e2e/oauth-connect-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('a connected TikTok platform shows as connected on /recap and can be disconnected', async ({ page }) => {
  let tiktokConnected = true;

  await page.route('**/api/recap', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        handles: { youtube: null, tiktok: null, instagram: null },
        connections: { tiktok: tiktokConnected, instagram: false },
        recapCardId: null,
      }),
    });
  });

  await page.route('**/api/oauth/tiktok/disconnect', async (route) => {
    tiktokConnected = false;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/recap');
  await expect(page.getByText(/connected via tiktok/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /connect via instagram/i })).toBeVisible();

  await page.getByRole('button', { name: /disconnect/i }).click();
  await expect(page.getByRole('link', { name: /connect via tiktok/i })).toBeVisible();
});

test('landing on /recap with a connected= query param shows a one-time success toast', async ({ page }) => {
  await page.route('**/api/recap', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        handles: { youtube: null, tiktok: null, instagram: null },
        connections: { tiktok: true, instagram: false },
        recapCardId: null,
      }),
    });
  });

  await page.goto('/recap?connected=tiktok');
  await expect(page.getByRole('alert').filter({ hasText: /tiktok connected/i })).toBeVisible();
  await expect(page).toHaveURL('/recap');
});
