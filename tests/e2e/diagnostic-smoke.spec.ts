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

test('an unauthenticated submission prompts inline sign-in, and a returning link pre-fills the URL without auto-submitting', async ({ page }) => {
  let diagnosticCallCount = 0;
  await page.route('**/api/diagnostic', async (route) => {
    diagnosticCallCount += 1;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'You must be signed in to run a diagnostic.' }),
    });
  });

  await page.route('**/api/auth/magic-link', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/diagnostic');
  await page.getByLabel(/paste a youtube, tiktok, or instagram link/i).fill('https://www.tiktok.com/@user/video/999');
  await page.getByRole('button', { name: /get my report/i }).click();

  await expect(page.getByText(/checking: https:\/\/www\.tiktok\.com\/@user\/video\/999/i)).toBeVisible();
  await page.getByLabel('Email').fill('creator@example.com');
  await page.getByRole('button', { name: /send sign-in link/i }).click();

  await expect(page.getByText(/check your email/i)).toBeVisible();
  expect(diagnosticCallCount).toBe(1);

  // Simulate returning from the magic-link email: the callback route would
  // redirect here with the original URL restored, unsubmitted.
  await page.goto('/diagnostic?url=' + encodeURIComponent('https://www.tiktok.com/@user/video/999'));
  const urlField = page.getByLabel(/paste a youtube, tiktok, or instagram link/i);
  await expect(urlField).toHaveValue('https://www.tiktok.com/@user/video/999');
  expect(diagnosticCallCount).toBe(1); // still 1 — no auto-submit occurred
});
