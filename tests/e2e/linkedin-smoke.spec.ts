// tests/e2e/linkedin-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('a signed-out visitor on /linkedin sees a sign-in prompt, not a silent redirect', async ({ page }) => {
  await page.route('**/api/linkedin/strategy', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'You must be signed in.' }) })
  );

  await page.goto('/linkedin');

  await expect(page).toHaveURL(/\/linkedin$/);
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /send sign-in link/i })).toBeVisible();
});

test('a subscribed visitor picks a niche and goal, builds a strategy, sees ideas, and audits their profile', async ({ page }) => {
  let strategyBuilt = false;

  await page.route('**/api/linkedin/strategy', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, latest: null, history: [] }),
      });
      return;
    }
    strategyBuilt = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        strategy: {
          id: 'e2e-strategy-1',
          niche: 'Gaming & esports',
          targetGoal: 'Land brand or product partnerships',
          contentPillars: ['Industry commentary', 'Behind-the-scenes wins'],
          postingCadenceRecommendation: 'Aim for 2 posts a week.',
          positioningNotes: 'Position yourself as a rising voice in gaming.',
          headline: 'Lead with gaming industry insight',
          createdAt: '2026-09-09T00:00:00Z',
        },
      }),
    });
  });

  await page.route('**/api/linkedin/ideas', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ideas: {
          postIdeas: [
            {
              workingTitle: 'What I learned scrimming with a pro team',
              angle: 'Share one concrete lesson from a real scrim.',
              whyItFitsYourGoal: 'Shows real esports credibility to partnership scouts.',
            },
          ],
        },
      }),
    });
  });

  await page.route('**/api/linkedin/audit', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, history: [] }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        audit: {
          id: 'e2e-audit-1',
          headline: 'Solid start, a couple of easy fixes',
          workingWell: ['Your headline is specific and clear.'],
          needsWork: ['Your About section is thin — add a few more sentences about what you actually do.'],
          createdAt: '2026-09-09T00:00:00Z',
        },
      }),
    });
  });

  await page.goto('/linkedin');

  await page.getByRole('button', { name: 'Gaming & esports' }).click();
  await page.getByRole('button', { name: 'Land brand or product partnerships' }).click();
  await page.getByRole('button', { name: /build my strategy/i }).click();

  expect(strategyBuilt).toBe(true);
  await expect(page.getByRole('heading', { name: 'Lead with gaming industry insight' })).toBeVisible();
  await expect(page.getByText(/aim for 2 posts a week/i)).toBeVisible();

  await expect(page.getByText('What I learned scrimming with a pro team')).toBeVisible();

  await page.setInputFiles('#linkedin-audit-upload', {
    name: 'profile.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake profile export'),
  });

  await expect(page.getByText('Solid start, a couple of easy fixes').first()).toBeVisible();
  await expect(page.getByText(/your headline is specific and clear/i)).toBeVisible();
});
