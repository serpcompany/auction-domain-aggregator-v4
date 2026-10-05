import { expect, test, type Page } from '@playwright/test';

import { E2E_BASE_URL } from '../scripts/e2e-preview-lifecycle';

async function expectUrlParameter(
  page: Page,
  name: string,
  expected: string | null,
) {
  await expect
    .poll(() => new URL(page.url()).searchParams.get(name))
    .toBe(expected);
}

test('serves the deterministic domain inventory with a healthy database', async ({
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
  await expect(page.getByLabel('Domain contains')).toHaveAttribute(
    'autocomplete',
    'off',
  );
  await expect(page.getByLabel('Domain contains')).toHaveAttribute(
    'placeholder',
    'e.g. garden…',
  );
  await expect(page.getByLabel('Max current bid')).toHaveAttribute(
    'autocomplete',
    'off',
  );
  await expect(page.getByLabel('Auction source')).toBeVisible();
  await page.getByRole('button', { name: 'TLD: Any' }).click();
  await expect(page.getByLabel('Search tld')).toHaveAttribute(
    'autocomplete',
    'off',
  );
  await expect(page.getByLabel('Search tld')).toHaveAttribute(
    'placeholder',
    'Search tld…',
  );
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Apply filters', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('60 active listings', { exact: true }),
  ).toBeVisible();

  const table = page.getByRole('table');
  await expect(table).toBeVisible();
  for (const header of [
    'Domain',
    'Auction',
    'Price',
    'Interest',
    'Ends',
    'Age',
    'Links',
    'Appraisal',
    'Majestic topic',
    'Ahrefs Domain Rating',
  ]) {
    await expect(
      table.getByRole('columnheader', { name: header, exact: true }),
    ).toBeVisible();
  }

  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', database: 'ok' });
});

test('applies, removes, sorts, clears, and restores URL-backed filters', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByLabel('Domain contains').fill('garden');
  await page.getByLabel('Max current bid').fill('30');
  await page.getByLabel('Ending').selectOption('1h');
  await page
    .getByRole('button', { name: 'Apply filters', exact: true })
    .click();

  await expectUrlParameter(page, 'q', 'garden');
  await expectUrlParameter(page, 'priceMax', '30');
  await expectUrlParameter(page, 'endingWithin', '1h');
  await expect(
    page.getByText('1 active listing', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /garden\.com.*opens auction/i }),
  ).toBeVisible();

  const endTime = page.getByRole('table').locator('time').first();
  await expect(endTime).toContainText(/\d+m/);
  await expect(endTime).toContainText(/UTC/);
  await expect(endTime).toHaveAttribute('datetime', /T.*Z$/);

  await page.getByRole('button', { name: 'More filters' }).click();
  const sheet = page.getByRole('dialog', { name: 'More filters' });
  await expect(sheet.getByLabel('Minimum current bid')).toHaveAttribute(
    'autocomplete',
    'off',
  );
  await sheet.getByLabel('Minimum current bid').fill('20');
  await sheet.getByText('No digits', { exact: true }).click();
  await sheet.getByText('No hyphens', { exact: true }).click();
  await sheet
    .getByRole('button', { name: 'Apply filters', exact: true })
    .click();

  await expectUrlParameter(page, 'priceMin', '20');
  await expectUrlParameter(page, 'noDigits', '1');
  await expectUrlParameter(page, 'noHyphens', '1');
  await expect(
    page.getByText('1 active listing', { exact: true }),
  ).toBeVisible();

  await page
    .getByRole('columnheader', { name: 'Price', exact: true })
    .getByRole('link')
    .click();
  await expectUrlParameter(page, 'sort', 'price');
  await expectUrlParameter(page, 'q', 'garden');
  await expectUrlParameter(page, 'noDigits', '1');

  await page.goBack();
  await expectUrlParameter(page, 'sort', 'endsAt');
  await expectUrlParameter(page, 'q', 'garden');
  await expect(page.getByLabel('Domain contains')).toHaveValue('garden');
  await expect(page.getByLabel('Max current bid')).toHaveValue('30');
  await expect(page.getByLabel('Ending')).toHaveValue('1h');
  await expect(
    page.getByText('1 active listing', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: /More filters/ }).click();
  await expect(
    page.getByRole('dialog').getByLabel('Minimum current bid'),
  ).toHaveValue('20');
  await expect(
    page.getByRole('dialog').getByRole('checkbox', { name: 'No digits' }),
  ).toBeChecked();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Dismiss' })
    .click();

  await page
    .getByRole('link', { name: 'Remove Domain: no digits filter' })
    .click();
  await expectUrlParameter(page, 'noDigits', null);
  await expectUrlParameter(page, 'noHyphens', '1');
  await expectUrlParameter(page, 'q', 'garden');

  await page.getByRole('link', { name: 'Clear all', exact: true }).click();
  await expect(page).toHaveURL(`${E2E_BASE_URL}/`);
  await expect(
    page.getByText('60 active listings', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Domain contains')).toHaveValue('');
});

for (const viewport of [
  { name: 'desktop', width: 1280, height: 720 },
  { name: '375px', width: 375, height: 812 },
]) {
  test(`contains table scrolling and renders sticky, hover, and focus states at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    const container = page.getByTestId('domain-results-scroll-container');
    const table = page.getByRole('table');
    const domainHeader = table.getByRole('columnheader', {
      name: 'Domain',
      exact: true,
    });
    const auctionHeader = table.getByRole('columnheader', {
      name: 'Auction',
      exact: true,
    });
    await expect(container).toBeVisible();

    const domainSortLink = domainHeader.getByRole('link');
    const headerLinkBackground = await domainSortLink.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await domainSortLink.hover();
    await expect
      .poll(() =>
        domainSortLink.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      )
      .not.toBe(headerLinkBackground);

    const layout = await container.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
    expect(['auto', 'scroll']).toContain(layout.overflowX);
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);

    const regionFocusBefore = await container.evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.outlineWidth}|${style.boxShadow}`;
    });
    await container.focus();
    await expect(container).toBeFocused();
    await expect
      .poll(() =>
        container.evaluate((element) => {
          const style = getComputedStyle(element);
          return `${style.outlineWidth}|${style.boxShadow}`;
        }),
      )
      .not.toBe(regionFocusBefore);

    await container.evaluate((element) => {
      element.scrollLeft = 0;
      element.scrollTop = 0;
    });
    // Chromium animates keyboard scrolling. Wait for each animation to settle
    // so it cannot move the container after the positions are reset below.
    const settledScroll = (axis: 'scrollLeft' | 'scrollTop') =>
      expect
        .poll(async () => {
          const before = await container.evaluate(
            (element, key) => element[key],
            axis,
          );
          await page.waitForTimeout(150);
          const after = await container.evaluate(
            (element, key) => element[key],
            axis,
          );
          return before === after && after > 0;
        })
        .toBe(true);
    await page.keyboard.press('ArrowRight');
    await settledScroll('scrollLeft');
    await page.keyboard.press('PageDown');
    await settledScroll('scrollTop');
    await container.evaluate((element) => {
      element.scrollLeft = 0;
      element.scrollTop = 0;
    });
    await expect
      .poll(() =>
        container.evaluate((element) => ({
          left: element.scrollLeft,
          top: element.scrollTop,
        })),
      )
      .toEqual({ left: 0, top: 0 });

    const domainBefore = await domainHeader.boundingBox();
    const auctionBefore = await auctionHeader.boundingBox();
    expect(domainBefore).not.toBeNull();
    expect(auctionBefore).not.toBeNull();

    await container.evaluate((element) => {
      element.scrollLeft = 420;
    });
    await expect
      .poll(() => container.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);

    const domainAfterHorizontal = await domainHeader.boundingBox();
    const auctionAfterHorizontal = await auctionHeader.boundingBox();
    expect(Math.abs(domainAfterHorizontal!.x - domainBefore!.x)).toBeLessThan(
      1,
    );
    expect(auctionAfterHorizontal!.x).toBeLessThan(auctionBefore!.x - 1);

    const stickyStyle = await domainHeader.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        position: style.position,
        backgroundColor: style.backgroundColor,
        zIndex: Number(style.zIndex),
      };
    });
    expect(stickyStyle.position).toBe('sticky');
    expect(stickyStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(stickyStyle.zIndex).toBeGreaterThan(0);

    await container.evaluate((element) => {
      element.scrollTop = 32;
    });
    await expect
      .poll(() => container.evaluate((element) => element.scrollTop))
      .toBe(32);
    const stackingProof = await domainHeader.evaluate((header) => {
      const headerBox = header.getBoundingClientRect();
      const firstRow = header.closest('table')?.tBodies[0]?.rows[0];
      const movingCell = [...(firstRow?.cells ?? [])].slice(1).find((cell) => {
        const box = cell.getBoundingClientRect();
        return (
          box.left < headerBox.right &&
          box.right > headerBox.left &&
          box.top < headerBox.bottom &&
          box.bottom > headerBox.top
        );
      });
      if (!movingCell) return { found: false };
      const movingBox = movingCell.getBoundingClientRect();
      const point = {
        x:
          (Math.max(movingBox.left, headerBox.left) +
            Math.min(movingBox.right, headerBox.right)) /
          2,
        y:
          (Math.max(movingBox.top, headerBox.top) +
            Math.min(movingBox.bottom, headerBox.bottom)) /
          2,
      };
      const hit = document.elementFromPoint(point.x, point.y);
      return {
        found: true,
        movingCellPosition: getComputedStyle(movingCell).position,
        intersectionIsTopHit:
          hit === header || (hit !== null && header.contains(hit)),
      };
    });
    expect(stackingProof).toEqual({
      found: true,
      movingCellPosition: 'static',
      intersectionIsTopHit: true,
    });

    const domainTopBefore = (await domainHeader.boundingBox())!.y;
    await container.evaluate((element) => {
      element.scrollTop = 420;
    });
    await expect
      .poll(() => container.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    const domainAfterVertical = await domainHeader.boundingBox();
    expect(Math.abs(domainAfterVertical!.y - domainTopBefore)).toBeLessThan(1);

    await container.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect
      .poll(() => container.evaluate((element) => element.scrollTop))
      .toBe(0);
    const firstRow = table.getByRole('row').nth(1);
    const rowBackgroundBefore = await firstRow.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await firstRow.hover();
    await expect
      .poll(() =>
        firstRow.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      )
      .not.toBe(rowBackgroundBefore);

    const domainLink = firstRow.getByRole('link');
    const focusBefore = await domainLink.evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.outlineWidth}|${style.boxShadow}`;
    });
    await domainLink.focus();
    await expect(domainLink).toBeFocused();
    await expect
      .poll(() =>
        domainLink.evaluate((element) => {
          const style = getComputedStyle(element);
          return `${style.outlineWidth}|${style.boxShadow}`;
        }),
      )
      .not.toBe(focusBefore);
  });
}
