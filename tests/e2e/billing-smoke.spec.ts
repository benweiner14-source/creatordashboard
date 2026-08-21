// tests/e2e/billing-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('a free visitor sees the upgrade screen on /recap and can start checkout', async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'creator@example.com' }) })
  );
  await page.route('**/api/recap', (route) =>
    route.fulfill({
      status: 402,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Recap Card requires an active subscription.', upgradeUrl: '/billing' }),
    })
  );
  await page.route('**/api/billing/checkout', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://checkout.stripe.com/pay/cs_test_1' }) })
  );
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Stripe Checkout (mocked)</body></html>' })
  );

  await page.goto('/recap');

  await expect(page.getByText("Recap Card is part of Creator Dashboard's paid plan")).toBeVisible();
  await page.getByRole('button', { name: /upgrade/i }).click();
  await page.waitForURL('https://checkout.stripe.com/pay/cs_test_1');
});

test('a subscribed visitor on /billing sees their renewal date and can open the portal', async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'creator@example.com' }) })
  );
  await page.route('**/api/billing/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'active', currentPeriodEnd: '2026-09-19T00:00:00Z', cancelAtPeriodEnd: false }),
    })
  );
  await page.route('**/api/billing/portal', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://billing.stripe.com/session/xyz' }) })
  );
  await page.route('https://billing.stripe.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Stripe Billing Portal (mocked)</body></html>' })
  );

  await page.goto('/billing');

  await expect(page.getByText(/you're subscribed — renews/i)).toBeVisible();
  await page.getByRole('button', { name: /manage plan/i }).click();
  await page.waitForURL('https://billing.stripe.com/session/xyz');
});
