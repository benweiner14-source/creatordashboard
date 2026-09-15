// tests/e2e/watchlist-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('a signed-out visitor on /watchlist sees a sign-in prompt, not a silent redirect', async ({ page }) => {
  await page.route('**/api/watchlist', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'You must be signed in.' }) })
  );

  await page.goto('/watchlist');

  await expect(page).toHaveURL(/\/watchlist$/);
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /send sign-in link/i })).toBeVisible();
});

test('a subscribed visitor adds a competitor, sees its snapshot, expands top posts, and removes it', async ({ page }) => {
  let added = false;

  await page.route('**/api/watchlist', async (route) => {
    if (route.request().method() === 'POST') {
      added = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entry: { id: 'e2e-entry-1' } }) });
      return;
    }
    const entries = added
      ? [
          {
            id: 'e2e-entry-1',
            platform: 'tiktok',
            handle: 'creator',
            url: 'https://www.tiktok.com/@creator',
            label: null,
            lastError: null,
            hasSnapshot: true,
            isStale: false,
            subscriberCount: 42000,
            totalViewCount: 900000,
            videoCount: 30,
            topPosts: [
              {
                captionOrTitle: 'Wait for it',
                url: 'https://www.tiktok.com/@creator/video/1',
                viewCount: 50000,
                publishedAt: '2026-09-09T00:00:00Z',
                viewsPerHour: 2083,
              },
            ],
            sevenDayDelta: { subscriberDelta: 1200, totalViewDelta: 50000, videoDelta: 2, comparedAgainstCapturedAt: '2026-09-03T00:00:00Z' },
            thirtyDayDelta: null,
          },
        ]
      : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries, subscriptionRequired: false }) });
  });

  // GET /api/watchlist is read-only now, so the page refreshes stale entries
  // itself via POST /api/watchlist/refresh. The mocked list above hands back an
  // already-fresh entry (isStale: false), so this should never be hit -- it is
  // mocked as a no-op so a regression that refreshes regardless of staleness
  // fails loudly on the assertion below rather than on an unrouted request.
  let refreshCalls = 0;
  await page.route('**/api/watchlist/refresh', async (route) => {
    refreshCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entry: null, refreshed: false }) });
  });

  await page.route('**/api/watchlist/e2e-entry-1', async (route) => {
    await route.fulfill({ status: 204, contentType: 'application/json', body: '' });
  });

  await page.goto('/watchlist');
  await expect(page.getByText(/no competitors tracked yet/i)).toBeVisible();

  await page.getByLabel(/channel or profile link/i).fill('https://www.tiktok.com/@creator');
  await page.getByRole('button', { name: /add competitor/i }).click();

  await expect(page.getByText('@creator', { exact: true })).toBeVisible();
  await expect(page.getByText('42,000')).toBeVisible();

  await page.getByText(/view top posts/i).click();
  await expect(page.getByRole('link', { name: 'Wait for it' })).toBeVisible();

  await page.getByRole('button', { name: /remove/i }).click();
  await expect(page.getByText(/no competitors tracked yet/i)).toBeVisible();

  expect(refreshCalls).toBe(0);
});
