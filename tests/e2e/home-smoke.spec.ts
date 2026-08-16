// tests/e2e/home-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('dashboard home renders all three sections and nav links work', async ({ page }) => {
  await page.route('**/api/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'jordan@example.com' }),
    });
  });

  await page.route('**/api/home', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        email: 'jordan@example.com',
        diagnostic: {
          id: 'diagnostic-1',
          platform: 'youtube',
          overallScore: 78,
          hookStrengthScore: 82,
          retentionRiskScore: 61,
          timingScore: 88,
          formatFitScore: 75,
          createdAt: '2026-08-13T00:00:00Z',
        },
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
            viewCount: 38000,
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
  await expect(page.getByRole('heading', { name: 'Latest diagnostic' })).toBeVisible();
  await expect(page.getByText('142K')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get my ideas' })).toBeVisible();

  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await page.getByRole('link', { name: 'Diagnostic' }).click();
  await expect(page).toHaveURL(/\/diagnostic$/);
});
