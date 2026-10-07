import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AppSidebar } from '@/components/app-shell/app-sidebar'
import { SiteHeader } from '@/components/app-shell/site-header'
import { ThemeProvider } from '@/components/app-shell/theme-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

beforeAll(() => {
  // jsdom has no matchMedia; the stock sidebar asks it whether the viewport is a phone.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn()
  })
})

function Shell({ parent }: { parent?: { label: string; href: string } }) {
  return (
    <ThemeProvider attribute="class">
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <SiteHeader title={parent ? 'Filters' : 'Auctions'} parent={parent}>
              <span>Synced 2 minutes ago</span>
            </SiteHeader>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}

afterEach(cleanup)

describe('app shell', () => {
  it('links the brand and the built screens, marking the current one', () => {
    const { container } = render(<Shell />)
    const sidebar = within(
      container.querySelector<HTMLElement>('[data-slot="sidebar"]') as HTMLElement
    )

    const auctions = sidebar.getByRole('link', { name: 'Auctions' })
    expect(auctions).toHaveAttribute('href', '/')
    expect(auctions).toHaveAttribute('data-active')
    expect(sidebar.getByRole('link', { name: /Domain Aggregator/ })).toHaveAttribute('href', '/')
    expect(sidebar.queryByRole('link', { name: 'Sync status' })).not.toBeInTheDocument()
  })

  it('keeps Auctions marked on the Filters page and on no other page', () => {
    pathname = '/filters/'
    const { container, unmount } = render(<Shell />)
    const link = () =>
      within(container.querySelector('[data-slot="sidebar"]') as HTMLElement).getByRole('link', {
        name: 'Auctions'
      })
    expect(link()).toHaveAttribute('data-active')
    unmount()

    pathname = '/syncs/'
    const other = render(<Shell />)
    expect(
      within(other.container.querySelector('[data-slot="sidebar"]') as HTMLElement).getByRole(
        'link',
        { name: 'Auctions' }
      )
    ).not.toHaveAttribute('data-active')
    pathname = '/'
  })

  it('puts the trigger, the page title, page status, and the theme toggle in the header', () => {
    render(<Shell />)

    const header = screen.getByRole('banner')
    expect(within(header).getByRole('button', { name: 'Toggle Sidebar' })).toBeInTheDocument()
    expect(within(header).getByRole('link', { name: 'Auctions' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(within(header).getByText('Synced 2 minutes ago')).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Toggle dark mode' })).toBeInTheDocument()
  })

  it('links a parent page in the breadcrumb', () => {
    render(<Shell parent={{ label: 'Auctions', href: '/?sort=price' }} />)

    const breadcrumb = screen.getByRole('navigation', { name: 'breadcrumb' })
    expect(within(breadcrumb).getByRole('link', { name: 'Auctions' })).toHaveAttribute(
      'href',
      '/?sort=price'
    )
    expect(within(breadcrumb).getByRole('link', { name: 'Filters' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })
})
