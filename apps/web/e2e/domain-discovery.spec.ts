import { expect, type Page, test } from '@playwright/test'

async function expectUrlParameter(page: Page, name: string, expected: string | null) {
  await expect.poll(() => new URL(page.url()).searchParams.get(name)).toBe(expected)
}

// Requests that render the table page, which read D1. Route-tree prefetches,
// which the sidebar's links send after a load, are not among them.
function recordPageRequests(page: Page) {
  const requests: string[] = []
  page.on('request', request => {
    const prefetch = request.headers()['next-router-prefetch'] !== undefined
    if (new URL(request.url()).pathname === '/' && !prefetch) requests.push(request.url())
  })
  return requests
}

test('applies the URL trailing-slash rule in the Worker entry', async ({ request }) => {
  const page = await request.get('/filters?tld=com', { maxRedirects: 0 })
  expect(page.status()).toBe(308)
  expect(page.headers().location).toBe('/filters/?tld=com')

  for (const path of ['/api/health', '/api/health/']) {
    expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(200)
  }
})

test('marks a non-production Worker noindex and disallows crawling', async ({ request }) => {
  const page = await request.get('/')
  expect(page.headers()['x-robots-tag']).toBe('noindex, nofollow')
  const redirect = await request.get('/filters', { maxRedirects: 0 })
  expect(redirect.headers()['x-robots-tag']).toBe('noindex, nofollow')
  const robots = await request.get('/robots.txt')
  expect(robots.status()).toBe(200)
  expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')
})

test('edits every filter on the Filters page and applies them to the results', async ({ page }) => {
  await page.goto('/filters/?tld=com&sort=price&direction=desc&page=3')

  await expect(page.getByRole('heading', { level: 1, name: 'Filters' })).toBeVisible()
  await expect(page.getByText('1 filter set')).toBeVisible()
  await page.getByLabel('Min bids').fill('1')
  await page.getByLabel('Minimum length (characters)').fill('20')
  await page.getByLabel('Maximum length (characters)').fill('5')
  await expect(page.getByText('Fix the domain length range to apply')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show results' })).toBeDisabled()

  await page.getByLabel('Maximum length (characters)').fill('')
  await page.getByLabel('Minimum length (characters)').fill('')
  await expect(page.getByText('2 filters set')).toBeVisible()
  await page.getByRole('button', { name: 'Show results' }).click()

  await expect(page).toHaveURL(/\/\?tld=com&bidsMin=1&sort=price&direction=desc&page=1$/)
  await expect(page.getByRole('link', { name: 'Remove Bids: 1+ filter' })).toBeVisible()
})

test('serves the deterministic domain inventory with a healthy database', async ({
  page,
  request
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  // Every type: the bare address opens on auctions only (see below).
  await page.goto('/?sort=endsAt&direction=asc&page=1')

  await expect(
    page.getByRole('heading', { level: 1, name: 'Auctions', exact: true })
  ).toBeAttached()
  const search = page.getByRole('searchbox', { name: 'Domain contains' })
  await expect(search).toBeVisible()
  await expect(search).toHaveAttribute('autocomplete', 'off')
  await expect(search).toHaveAttribute('placeholder', 'Search domains…')
  await page.getByRole('button', { name: /^TLD/ }).click()
  await page.getByPlaceholder('TLD').fill('co')
  await expect(page.getByRole('option', { name: '.com' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('100 listings', { exact: true })).toBeVisible()

  const table = page.getByRole('table')
  await expect(table).toBeVisible()
  for (const header of ['Domain', 'Source', 'Price', 'Bids', 'Ends', 'Age', 'Links', 'Appraisal']) {
    await expect(table.getByRole('columnheader', { name: header, exact: true })).toBeVisible()
  }

  // Seeded Ahrefs DR renders with the licence-required attribution link in the
  // footer, visible while the DR column shows.
  await expect(page.getByRole('link', { name: 'Domain Rating by Ahrefs' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Domain Rating by Ahrefs' })).toHaveAttribute(
    'href',
    'https://ahrefs.com/'
  )
  await expect(
    table.getByRole('row', { name: /garden\.com/ }).getByTitle('Domain Rating by Ahrefs')
  ).toHaveText('37')

  // Uncaught script errors, such as a broken theme script in the Worker bundle.
  expect(pageErrors).toEqual([])

  const response = await request.get('/api/health')
  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ status: 'ok', database: 'ok' })
})

test('opens on auctions, with expired listings one chip away', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL('/?type=auction&sort=endsAt&direction=asc&page=1')
  await expect(page.getByText('50 listings', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /garden\.com/ })).toBeHidden()

  await page.getByRole('link', { name: 'Remove Type: Auction filter' }).click()
  await expect(page).toHaveURL('/?sort=endsAt&direction=asc&page=1')
  await expect(page.getByText('100 listings', { exact: true })).toBeVisible()
})

test('applies, removes, sorts, clears, and restores URL-backed filters', async ({ page }) => {
  await page.goto('/?sort=endsAt&direction=asc&page=1')

  const search = page.getByRole('searchbox', { name: 'Domain contains' })
  await search.fill('garden')
  await search.press('Enter')
  await expectUrlParameter(page, 'q', 'garden')

  await page.getByRole('button', { name: /^Max bid/ }).click()
  await page.getByRole('spinbutton', { name: 'Max bid' }).fill('30')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expectUrlParameter(page, 'priceMax', '30')

  // The toolbar's Ends filter, not the Ends header's menu button after it.
  const endsFilter = page.getByRole('button', { name: /^Ends/ }).first()
  await endsFilter.click()
  await page.getByRole('option', { name: 'Within 1 hour' }).click()
  await expectUrlParameter(page, 'endingWithin', '1h')
  await expectUrlParameter(page, 'q', 'garden')
  await expect(page.getByText('1 listing', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /garden\.com.*opens auction/i })).toBeVisible()

  const endTime = page.getByRole('table').locator('time').first()
  await expect(endTime).toContainText(/\d+m/)
  await expect(endTime).toContainText(/UTC/)
  await expect(endTime).toHaveAttribute('datetime', /T.*Z$/)

  await page.getByRole('link', { name: 'All filters' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Filters' })).toBeVisible()
  await page.getByLabel('Minimum current bid').fill('20')
  await page.getByText('No digits', { exact: true }).click()
  await page.getByText('No hyphens', { exact: true }).click()
  await page.getByRole('button', { name: 'Show results' }).click()

  await expectUrlParameter(page, 'priceMin', '20')
  await expectUrlParameter(page, 'noDigits', '1')
  await expectUrlParameter(page, 'noHyphens', '1')
  await expect(page.getByText('1 listing', { exact: true })).toBeVisible()

  await page.getByRole('columnheader', { name: 'Price', exact: true }).getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Sort ascending' }).click()
  await expectUrlParameter(page, 'sort', 'price')
  await expectUrlParameter(page, 'q', 'garden')
  await expectUrlParameter(page, 'noDigits', '1')

  await page.goBack()
  await expectUrlParameter(page, 'sort', 'endsAt')
  await expect(page.getByRole('searchbox', { name: 'Domain contains' })).toHaveValue('garden')
  await expect(page.getByRole('button', { name: /^Max bid/ })).toContainText('$30')
  await expect(endsFilter).toContainText('1 hour')
  await expect(page.getByText('1 listing', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: /^All filters/ }).click()
  await expect(page.getByLabel('Minimum current bid')).toHaveValue('20')
  await expect(page.getByRole('checkbox', { name: 'No digits' })).toBeChecked()
  await page.getByRole('link', { name: 'Cancel' }).click()
  await expectUrlParameter(page, 'priceMin', '20')

  await page.getByRole('link', { name: 'Remove Domain: no digits filter' }).click()
  await expectUrlParameter(page, 'noDigits', null)
  await expectUrlParameter(page, 'noHyphens', '1')
  await expectUrlParameter(page, 'q', 'garden')

  await page.getByRole('link', { name: 'Clear all', exact: true }).click()
  await expect(page).toHaveURL('/?sort=endsAt&direction=asc&page=1')
  await expect(page.getByText('100 listings', { exact: true })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Domain contains' })).toHaveValue('')
})

// Below 768 px the list replaces the table (see the phone journey below).
for (const viewport of [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'narrow desktop', width: 800, height: 720 }
]) {
  test(`contains table scrolling and renders sticky, hover, and focus states at ${viewport.name}`, async ({
    page
  }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')

    const container = page.getByTestId('domain-results-scroll-container')
    const table = page.getByRole('table')
    const domainHeader = table.getByRole('columnheader', {
      name: 'Domain',
      exact: true
    })
    const auctionHeader = table.getByRole('columnheader', {
      name: 'Source',
      exact: true
    })
    await expect(container).toBeVisible()

    const domainMenuButton = domainHeader.getByRole('button')
    const headerButtonBackground = await domainMenuButton.evaluate(
      element => getComputedStyle(element).backgroundColor
    )
    await domainMenuButton.hover()
    await expect
      .poll(() => domainMenuButton.evaluate(element => getComputedStyle(element).backgroundColor))
      .not.toBe(headerButtonBackground)

    const layout = await container.evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    }))
    expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth)
    expect(['auto', 'scroll']).toContain(layout.overflowX)
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)

    const regionFocusBefore = await container.evaluate(element => {
      const style = getComputedStyle(element)
      return `${style.outlineWidth}|${style.boxShadow}`
    })
    await container.focus()
    await expect(container).toBeFocused()
    await expect
      .poll(() =>
        container.evaluate(element => {
          const style = getComputedStyle(element)
          return `${style.outlineWidth}|${style.boxShadow}`
        })
      )
      .not.toBe(regionFocusBefore)

    await container.evaluate(element => {
      element.scrollLeft = 0
      element.scrollTop = 0
    })
    // Chromium animates keyboard scrolling. Wait for each animation to settle
    // so it cannot move the container after the positions are reset below.
    const settledScroll = (axis: 'scrollLeft' | 'scrollTop') =>
      expect
        .poll(async () => {
          const before = await container.evaluate((element, key) => element[key], axis)
          await page.waitForTimeout(150)
          const after = await container.evaluate((element, key) => element[key], axis)
          return before === after && after > 0
        })
        .toBe(true)
    await page.keyboard.press('ArrowRight')
    await settledScroll('scrollLeft')
    await page.keyboard.press('PageDown')
    await settledScroll('scrollTop')
    await container.evaluate(element => {
      element.scrollLeft = 0
      element.scrollTop = 0
    })
    await expect
      .poll(() =>
        container.evaluate(element => ({
          left: element.scrollLeft,
          top: element.scrollTop
        }))
      )
      .toEqual({ left: 0, top: 0 })

    const domainBefore = await domainHeader.boundingBox()
    const auctionBefore = await auctionHeader.boundingBox()
    expect(domainBefore).not.toBeNull()
    expect(auctionBefore).not.toBeNull()

    await container.evaluate(element => {
      element.scrollLeft = 420
    })
    await expect.poll(() => container.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)

    const domainAfterHorizontal = await domainHeader.boundingBox()
    const auctionAfterHorizontal = await auctionHeader.boundingBox()
    expect(Math.abs(domainAfterHorizontal!.x - domainBefore!.x)).toBeLessThan(1)
    expect(auctionAfterHorizontal!.x).toBeLessThan(auctionBefore!.x - 1)

    const stickyStyle = await domainHeader.evaluate(element => {
      const style = getComputedStyle(element)
      return {
        position: style.position,
        backgroundColor: style.backgroundColor,
        zIndex: Number(style.zIndex)
      }
    })
    expect(stickyStyle.position).toBe('sticky')
    expect(stickyStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(stickyStyle.zIndex).toBeGreaterThan(0)

    await container.evaluate(element => {
      element.scrollTop = 32
    })
    await expect.poll(() => container.evaluate(element => element.scrollTop)).toBe(32)
    const stackingProof = await domainHeader.evaluate(header => {
      const headerBox = header.getBoundingClientRect()
      const firstRow = header.closest('table')?.tBodies[0]?.rows[0]
      // Past the sticky selection and Domain cells.
      const movingCell = [...(firstRow?.cells ?? [])].slice(2).find(cell => {
        const box = cell.getBoundingClientRect()
        return (
          box.left < headerBox.right &&
          box.right > headerBox.left &&
          box.top < headerBox.bottom &&
          box.bottom > headerBox.top
        )
      })
      if (!movingCell) return { found: false }
      const movingBox = movingCell.getBoundingClientRect()
      const point = {
        x:
          (Math.max(movingBox.left, headerBox.left) + Math.min(movingBox.right, headerBox.right)) /
          2,
        y:
          (Math.max(movingBox.top, headerBox.top) + Math.min(movingBox.bottom, headerBox.bottom)) /
          2
      }
      const hit = document.elementFromPoint(point.x, point.y)
      return {
        found: true,
        movingCellPosition: getComputedStyle(movingCell).position,
        intersectionIsTopHit: hit === header || (hit !== null && header.contains(hit))
      }
    })
    expect(stackingProof).toEqual({
      found: true,
      movingCellPosition: 'static',
      intersectionIsTopHit: true
    })

    const domainTopBefore = (await domainHeader.boundingBox())!.y
    await container.evaluate(element => {
      element.scrollTop = 420
    })
    await expect.poll(() => container.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const domainAfterVertical = await domainHeader.boundingBox()
    expect(Math.abs(domainAfterVertical!.y - domainTopBefore)).toBeLessThan(1)

    await container.evaluate(element => {
      element.scrollTop = 0
    })
    await expect.poll(() => container.evaluate(element => element.scrollTop)).toBe(0)
    const firstRow = table.locator('tbody tr').first()
    const rowBackgroundBefore = await firstRow.evaluate(
      element => getComputedStyle(element).backgroundColor
    )
    await firstRow.hover()
    await expect
      .poll(() => firstRow.evaluate(element => getComputedStyle(element).backgroundColor))
      .not.toBe(rowBackgroundBefore)

    const domainLink = firstRow.getByRole('link')
    const focusBefore = await domainLink.evaluate(element => {
      const style = getComputedStyle(element)
      return `${style.outlineWidth}|${style.boxShadow}`
    })
    await domainLink.focus()
    await expect(domainLink).toBeFocused()
    await expect
      .poll(() =>
        domainLink.evaluate(element => {
          const style = getComputedStyle(element)
          return `${style.outlineWidth}|${style.boxShadow}`
        })
      )
      .not.toBe(focusBefore)
  })
}

test('resizes a column by dragging its header edge, keeps the width, and resets it', async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')

  const header = page.getByRole('columnheader', { name: 'Price', exact: true })
  const handle = page.getByRole('separator', { name: 'Resize Price column' })
  const width = async () => Math.round((await header.boundingBox())?.width ?? 0)
  await expect(handle).toHaveAttribute('aria-valuenow', '80')
  const before = await width()
  const opened = page.url()

  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  const y = box!.y + box!.height / 2
  await page.mouse.move(box!.x + box!.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 60, y, { steps: 5 })
  await page.mouse.up()
  await expect.poll(width).toBe(before + 60)
  // The drag neither sorted the table, opened the header's menu, nor selected text.
  await expect(page).toHaveURL(opened)
  await expect(page.getByRole('menu')).toBeHidden()

  await page.reload()
  await expect.poll(width).toBe(before + 60)
  await expect(handle).toHaveAttribute('aria-valuenow', '140')

  await handle.dblclick()
  await expect.poll(width).toBe(before)
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect.poll(width).toBe(before)
  await expect(page.getByRole('menu')).toBeHidden()
})

test('sorts and hides columns from the header menus without a page request to hide', async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?sort=endsAt&direction=asc&page=1')
  const table = page.getByRole('table')
  const header = (name: string) => table.getByRole('columnheader', { name, exact: true })

  // One header row; Semrush AS is off by default; short labels have tooltips.
  // Selection, Domain, ten default columns, and the row actions.
  await expect(table.getByRole('row').first().getByRole('columnheader')).toHaveCount(14)
  await expect(header('AS')).toHaveCount(0)
  const tooltip = page.locator('[data-slot=tooltip-content]')
  await header('TF').getByRole('button').hover()
  await expect(tooltip.filter({ hasText: /^Majestic Trust Flow$/ })).toBeVisible()
  await header('DR').getByRole('button').hover()
  await expect(tooltip.filter({ hasText: /^Domain Rating by Ahrefs$/ })).toBeVisible()
  await expect(page.getByText(/^Showing 1–\d+ of \d+ · 96 per page$/)).toBeVisible()

  // Domain's menu sorts only.
  await header('Domain').getByRole('button').click()
  await expect(page.getByRole('menuitem')).toHaveText(['Sort ascending', 'Sort descending'])
  await page.keyboard.press('Escape')

  // Hiding a column and resetting the layout change only the cookie.
  const pageRequests = recordPageRequests(page)
  await header('Bids').getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Hide column' }).click()
  await expect(header('Bids')).toHaveCount(0)
  await header('Price').getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Columns' }).click()
  await page.getByRole('menuitemcheckbox', { name: /^Domain Rating/ }).click()
  await expect(header('DR')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Domain Rating by Ahrefs' })).toBeHidden()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  expect(pageRequests).toEqual([])

  await page.reload()
  await expect(header('Price')).toBeVisible()
  await expect(header('Bids')).toHaveCount(0)
  pageRequests.length = 0
  await page.getByRole('button', { name: /^Columns/ }).click()
  await page.getByRole('menuitem', { name: 'Reset layout' }).click()
  await expect(header('Bids')).toBeVisible()
  await expect(header('DR')).toBeVisible()
  expect(pageRequests).toEqual([])

  // Sorting from the menu navigates, and aria-sort follows.
  await header('Price').getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Sort descending' }).click()
  await expect(page).toHaveURL('/?sort=price&direction=desc&page=1')
  await expect(header('Price')).toHaveAttribute('aria-sort', 'descending')
  await header('Price').getByRole('button').click()
  await expect(page.getByRole('menuitem', { name: /^Sort descending/ })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
})

test('opens listing details beside the table from the row menu on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/?q=garden')

  const actions = page.getByRole('button', { name: 'Actions for garden.com' })
  await actions.click()
  await expect(page.getByRole('menuitem', { name: 'Open auction' })).toHaveAttribute(
    'target',
    '_blank'
  )
  await page.getByRole('menuitem', { name: 'Copy domain' }).click()
  await expect(page.getByText('Copied garden.com')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('garden.com')

  await actions.click()
  await page.getByRole('menuitem', { name: 'Details' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('garden.com', { exact: true })).toBeVisible()
  await expect(sheet.getByRole('link', { name: /Open auction on Dynadot/ })).toHaveAttribute(
    'target',
    '_blank'
  )
  await expect(sheet.getByRole('region', { name: 'Auction' })).toContainText('Current price')
  await expect(sheet.getByRole('link', { name: 'Domain Rating by Ahrefs' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

test('pins and moves columns in the browser only, keeping them across a reload', async ({
  page,
  browser
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?sort=endsAt&direction=asc&page=1')
  const opened = page.url()
  const table = page.getByRole('table')
  const header = (name: string) => table.getByRole('columnheader', { name, exact: true })
  const headerNames = () =>
    page
      .locator('thead th:not([aria-hidden])')
      .evaluateAll(cells => cells.map(cell => cell.getAttribute('aria-label') ?? cell.textContent))
  const pageRequests = recordPageRequests(page)

  await header('Price').getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Pin to left' }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await header('Bids').getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Move right' }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  const pinnedOrder = ['', 'Domain', 'Price', 'Source', 'Type', 'Ends', 'Bids', 'Age']
  await expect.poll(async () => (await headerNames()).slice(0, 8)).toEqual(pinnedOrder)
  await expect(header('Price').getByRole('img', { name: 'Pinned' })).toBeVisible()
  await header('Price').getByRole('button').click()
  await expect(page.getByRole('menuitem', { name: 'Unpin' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Move left' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  expect(pageRequests).toEqual([])
  await expect(page).toHaveURL(opened)

  // The pinned column stays put while the table scrolls sideways.
  const container = page.getByTestId('domain-results-scroll-container')
  const left = (name: string) => header(name).evaluate(cell => cell.getBoundingClientRect().x)
  const priceBefore = await left('Price')
  const sourceBefore = await left('Source')
  await container.evaluate(element => {
    element.scrollLeft = 300
  })
  await expect.poll(() => container.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  expect(Math.abs((await left('Price')) - priceBefore)).toBeLessThan(1)
  expect(await left('Source')).toBeLessThan(sourceBefore - 1)

  // A reload renders the same layout from the cookie, and the URL never holds it.
  await page.reload()
  await expect(page).toHaveURL(opened)
  expect((await headerNames()).slice(0, 8)).toEqual(pinnedOrder)
  const other = await browser.newContext()
  const fresh = await other.newPage()
  await fresh.setViewportSize({ width: 1440, height: 900 })
  await fresh.goto(opened)
  await expect(fresh.getByRole('columnheader', { name: 'Source', exact: true })).toBeVisible()
  expect(
    (
      await fresh
        .locator('thead th:not([aria-hidden])')
        .evaluateAll(cells =>
          cells.map(cell => cell.getAttribute('aria-label') ?? cell.textContent)
        )
    ).slice(0, 4)
  ).toEqual(['', 'Domain', 'Source', 'Type'])
  await other.close()

  // Reset layout clears pins and order too.
  await page.getByRole('button', { name: /^Columns/ }).click()
  await page.getByRole('menuitem', { name: 'Reset layout' }).click()
  await expect
    .poll(async () => (await headerNames()).slice(0, 4))
    .toEqual(['', 'Domain', 'Source', 'Type'])
})

test('selects rows on the page and clears the selection on navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?sort=endsAt&direction=asc&page=1')
  const rows = page.getByRole('table').locator('tbody tr')
  const all = page.getByRole('checkbox', { name: 'Select all rows on this page' })
  const bar = page.getByRole('region', { name: 'Selected rows' })

  await expect(bar).toBeHidden()
  await rows.nth(0).getByRole('checkbox').click()
  await rows.nth(1).getByRole('checkbox').click()
  await expect(bar.getByRole('status')).toHaveText('2 selected')
  await expect(all).toHaveAttribute('aria-checked', 'mixed')
  await expect(rows.nth(0)).toHaveAttribute('data-state', 'selected')
  // The tint reaches the sticky cells too.
  const tint = (index: number) =>
    rows
      .nth(index)
      .locator('td')
      .nth(1)
      .evaluate(cell => getComputedStyle(cell).backgroundColor)
  expect(await tint(0)).not.toBe(await tint(2))

  await bar.getByRole('button', { name: 'Save to list' }).click()
  await expect(
    page.getByText('Saving selected rows to a list comes in a later feature.')
  ).toBeVisible()
  await bar.getByRole('button', { name: 'Clear selection' }).click()
  await expect(bar).toBeHidden()
  await expect(all).toHaveAttribute('aria-checked', 'false')

  await all.click()
  await expect(bar.getByRole('status')).toHaveText('96 selected')
  await expect(all).toHaveAttribute('aria-checked', 'true')

  await page.getByRole('link', { name: 'Go to next page' }).click()
  await expectUrlParameter(page, 'page', '2')
  await expect(bar).toBeHidden()
  await expect(all).toHaveAttribute('aria-checked', 'false')
})

test('shows listings as a list on phones and opens details from a tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?sort=endsAt&direction=asc&page=1')

  const list = page.getByRole('list', { name: 'Domain results' })
  await expect(list).toBeVisible()
  await expect(page.getByTestId('domain-results-scroll-container')).toBeHidden()
  await expect(list.getByRole('listitem')).toHaveCount(96)
  const width = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth
  }))
  expect(width.document).toBeLessThanOrEqual(width.viewport)

  await expect(page.getByRole('link', { name: /^Filters/ })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Sort' })).toHaveValue('endsAt:asc')
  await expect(page.getByRole('button', { name: 'Fields shown' })).toBeVisible()

  const garden = list.getByRole('listitem').filter({ hasText: 'garden.com' })
  await expect(garden.getByRole('link', { name: /garden\.com.*opens auction/i })).toHaveAttribute(
    'target',
    '_blank'
  )
  await garden.getByRole('button', { name: 'Details for garden.com' }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText('garden.com', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('region', { name: 'Domain' })).toContainText('TLD')

  await page.goto('/?sort=price&direction=desc')
  await page.getByRole('combobox', { name: 'Sort' }).selectOption('domain:asc')
  await expectUrlParameter(page, 'sort', 'domain')
})

test('explains filters that match nothing and keeps the way back', async ({ page }) => {
  await page.goto('/?q=no-such-domain-anywhere&tld=com&sort=price')

  await expect(page.getByRole('heading', { name: 'No listings match these filters' })).toBeVisible()
  await expect(page.getByText('Nothing in the active inventory meets all 2 filters.')).toBeVisible()
  await expect(page.getByText('0 listings', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Clear all filters' }).click()
  await expect(page).toHaveURL('/?sort=price&direction=asc&page=1')
  await expect(page.getByText('100 listings', { exact: true })).toBeVisible()
})

test('shows each provider sync and the recent runs on Sync status', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Sync status' }).click()
  await expect(page).toHaveURL('/syncs/')
  await expect(page.getByRole('heading', { level: 1, name: 'Sync status' })).toBeAttached()

  await expect(page.getByText('Auction API')).toBeVisible()
  await expect(page.getByText('active listings')).toBeVisible()
  await expect(page.getByText('active listings').locator('xpath=preceding-sibling::p')).toHaveText(
    '100'
  )
  await expect(page.getByText('Daily at 15:30 UTC').first()).toBeVisible()
  const runs = page.getByRole('table')
  await expect(runs.getByRole('row', { name: /Dynadot\s+Succeeded/ })).toBeVisible()
  await expect(page.getByText('corepack pnpm sync dynadot')).toBeVisible()
})
