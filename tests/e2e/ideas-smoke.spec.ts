import { test, expect } from '@playwright/test';

test('setting a niche and generating shows the returned idea cards', async ({ page }) => {
  await page.route('**/api/ideas', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ niche: null, digest: null }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        digest: {
          id: 'e2e-digest-1',
          weekStart: '2026-08-10',
          contentIdeas: [
            {
              workingTitle: 'Sourdough Speedrun',
              pitch: 'Bake a loaf in under 2 hours on camera',
              medium: 'reel',
              format: 'Speed Recap',
              whyItsHotNow: 'Sourdough resurgence trending this week',
              sourceUrl: 'https://example.com/a',
              whyItRanksHere: 'High reach from trend-jacking',
              kpiSignals: ['reach'],
              reelDetails: { suggestedLengthSeconds: 60, style: 'talking-head' },
              carouselDetails: null,
            },
          ],
        },
      }),
    });
  });

  await page.route('**/api/ideas/niche', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/ideas');
  await page.getByLabel(/your niche/i).fill('home baking');
  await page.getByRole('button', { name: /save niche/i }).click();
  await page.getByRole('button', { name: /get this week's ideas/i }).click();

  await expect(page.getByRole('heading', { name: 'Sourdough Speedrun' })).toBeVisible();
  await expect(page.getByText('Bake a loaf in under 2 hours on camera')).toBeVisible();
  await expect(page.getByText(/Speed Recap/)).toBeVisible();
});
