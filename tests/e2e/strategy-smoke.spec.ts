// tests/e2e/strategy-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('a signed-out visitor on /strategy sees a sign-in prompt, not a silent redirect', async ({ page }) => {
  await page.route('**/api/strategy', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'You must be signed in.' }) })
  );

  await page.goto('/strategy');

  await expect(page).toHaveURL(/\/strategy$/);
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /send sign-in link/i })).toBeVisible();
});

test('a subscribed visitor pastes a channel URL and sees a rendered breakdown', async ({ page }) => {
  await page.route('**/api/strategy', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'e2e-strategy-1' }) });
  });

  await page.route('**/api/strategy/e2e-strategy-1', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        breakdown: {
          platform: 'tiktok',
          channel_handle: 'creator',
          post_count: 12,
          cadence: { postCount: 12, spanDays: 30, postsPerWeek: 2.8, mostCommonDayOfWeek: 'Tuesday' },
          format_mix: { averageDurationSeconds: 35, shortPct: 80, mediumPct: 20, longPct: 0 },
          top_posts: [{ captionOrTitle: 'Wait for it', viewCount: 50000 }],
          headline: 'Short, frequent posts are driving this channel',
          explanation: 'This channel posts short-form content often, which keeps the algorithm engaged.',
        },
      }),
    });
  });

  await page.goto('/strategy');
  await page.getByLabel(/channel or profile link/i).fill('https://www.tiktok.com/@creator');
  await page.getByRole('button', { name: /break down this channel/i }).click();

  await expect(page).toHaveURL(/\/strategy\/e2e-strategy-1$/);
  await expect(page.getByRole('heading', { name: 'Short, frequent posts are driving this channel' })).toBeVisible();
  await expect(page.getByText('Tuesday')).toBeVisible();
  await expect(page.getByText('80%')).toBeVisible();
});
