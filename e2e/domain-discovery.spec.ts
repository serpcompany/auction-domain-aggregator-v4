import { expect, test } from '@playwright/test';

test('serves domain discovery from local D1 with a healthy database', async ({
  page,
  request,
}) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Domain discovery',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Domain contains')).toBeVisible();
  await expect(page.getByLabel('Auction source')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Apply filters', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Reset', exact: true }),
  ).toBeVisible();

  const table = page.getByRole('table');
  if ((await table.count()) > 0) {
    await expect(table).toBeVisible();
    for (const header of [
      'Domain',
      'Source',
      'Auction type',
      'Current bid',
      'Bids',
      'Ends',
      'Age',
      'Majestic topic',
      'Ahrefs DR',
    ]) {
      await expect(
        table.getByRole('columnheader', { name: header, exact: true }),
      ).toBeVisible();
    }
  } else {
    await expect(
      page.getByRole('heading', { name: 'No domains found', exact: true }),
    ).toBeVisible();
  }

  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', database: 'ok' });
});
