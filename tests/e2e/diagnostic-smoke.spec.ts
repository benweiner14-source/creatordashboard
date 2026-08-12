// tests/e2e/diagnostic-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('pasting a URL renders a diagnostic report', async ({ page }) => {
  await page.route('**/api/diagnostic', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'e2e-diagnostic-1' }),
    });
  });

  await page.route('**/api/diagnostic/e2e-diagnostic-1', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        diagnostic: {
          report_json: {
            headline: 'Strong hook, watch your pacing',
            scores: { overallScore: 76 },
            explanationSegments: [
              { type: 'text', value: 'Your ' },
              { type: 'term', value: 'hook rate' },
              { type: 'text', value: ' is strong for this format.' },
            ],
          },
        },
      }),
    });
  });

  await page.goto('/diagnostic');
  await page.getByLabel(/paste a youtube, tiktok, or instagram link/i).fill('https://www.tiktok.com/@user/video/123');
  await page.getByRole('button', { name: /get my report/i }).click();

  await expect(page).toHaveURL(/\/diagnostic\/e2e-diagnostic-1$/);
  await expect(page.getByRole('heading', { name: 'Strong hook, watch your pacing' })).toBeVisible();
  await expect(page.getByText('Overall score: 76')).toBeVisible();
  await expect(page.getByRole('button', { name: 'hook rate' })).toBeVisible();
});
