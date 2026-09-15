import { test, expect } from '@playwright/test';

test('a subscribed user sees a War Room alert and follows it into a pre-filled Content Ideas generation', async ({ page }) => {
  await page.route('**/api/warroom', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          alerts: [
            {
              id: 'a1',
              platform: 'youtube',
              externalPostId: 'v1',
              url: 'https://example.com/v1',
              captionOrTitle: 'GTA 6 trailer breakdown',
              viewCount: 300000,
              engagementCount: 1000,
              publishedAt: '2026-09-15T10:00:00Z',
              severity: 'already_viral',
              detectedAt: '2026-09-15T11:00:00Z',
            },
          ],
          emailOptIn: false,
        }),
      });
    }
  });

  await page.route('**/api/ideas', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ niche: 'GTA RP', digest: null }) });
      return;
    }
    await route.continue();
  });

  await page.goto('/warroom');

  await expect(page.getByText('GTA 6 trailer breakdown')).toBeVisible();
  await expect(page.getByText(/already viral/i)).toBeVisible();

  await page.getByRole('link', { name: /generate an idea from this/i }).click();

  await expect(page).toHaveURL(/\/ideas\?context=/);
  await expect(page.getByRole('heading', { name: 'Weekly content ideas' })).toBeVisible();
});
