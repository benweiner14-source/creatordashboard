// tests/e2e/home-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('dashboard home renders both sections and nav links work', async ({ page }) => {
  await page.route('**/api/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'jordan@example.com' }),
    });
  });

  await page.route('**/api/strategy', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ history: [] }),
    });
  });

  await page.route('**/api/home', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        email: 'jordan@example.com',
        diagnostic: null,
        recap: {
          id: 'card-1',
          month: '2026-08-01',
          totals: { views: 142000, likes: 4000, comments: 300, postCount: 5 },
          platformData: {
            youtube: { views: 104000, likes: 3000, comments: 200, postCount: 3 },
            tiktok: { views: 38000, likes: 1000, comments: 100, postCount: 2 },
          },
          topPost: {
            platform: 'youtube',
            captionOrTitle: '3 Editing Tricks I Wish I Knew Sooner',
            // Deliberately distinct from every other number in this fixture —
            // 38000 collided with the TikTok platform total above, which made
            // a failing assertion ambiguous about which value it had matched.
            viewCount: 42000,
            permalink: 'https://example.com/post',
          },
          generatedAt: '2026-08-01T00:00:00Z',
        },
        ideas: { niche: 'home baking', digest: null },
      }),
    });
  });

  await page.goto('/home');

  await expect(page.getByText('Welcome back, Jordan.')).toBeVisible();
  await expect(page.getByText('142K')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get my ideas' })).toBeVisible();

  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await page.getByRole('link', { name: 'Strategy' }).click();
  await expect(page).toHaveURL(/\/strategy$/);
  // The nav is mocked out of every unit test, so this is the only place its
  // mount point on the destination page is verified at all.
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Creator strategy breakdown' })).toBeVisible();
});

// <AppNav> is mocked to () => null in every unit test file, so each of its four
// mount points is only ever exercised end-to-end here. These two walk /recap and
// /ideas far enough into their authenticated branch for the nav to render.
test('the nav renders on /recap once the page reaches its authenticated view', async ({ page }) => {
  await page.route('**/api/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'jordan@example.com' }),
    });
  });

  await page.route('**/api/recap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ handles: { youtube: null, tiktok: null, instagram: null }, recapCardId: null }),
    });
  });

  await page.goto('/recap');

  await expect(page.getByRole('heading', { name: 'Monthly recap card' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Recap' })).toHaveAttribute('aria-current', 'page');
  // The nav must sit outside <main> so skip-to-content lands on page content.
  await expect(page.locator('main nav[aria-label="Primary"]')).toHaveCount(0);
});

test('the nav renders on /ideas once the page reaches its authenticated view', async ({ page }) => {
  await page.route('**/api/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'jordan@example.com' }),
    });
  });

  await page.route('**/api/ideas', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ niche: 'home baking', digest: null }),
    });
  });

  await page.goto('/ideas');

  await expect(page.getByRole('heading', { name: 'Weekly content ideas' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Ideas' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('main nav[aria-label="Primary"]')).toHaveCount(0);
});
