import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ErrorPage from '@/app/error'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
afterEach(cleanup)

describe('error page', () => {
  it('explains the unreadable inventory and retries from the server', () => {
    const reset = vi.fn()
    render(
      <TooltipProvider>
        <SidebarProvider>
          <ErrorPage error={new Error('D1_ERROR')} reset={reset} />
        </SidebarProvider>
      </TooltipProvider>
    )

    expect(
      screen.getByRole('heading', { level: 1, name: 'The inventory couldn’t be read' })
    ).toBeInTheDocument()
    expect(screen.getByText('corepack pnpm db:migrate:local')).toBeInTheDocument()
    expect(screen.queryByText('D1_ERROR')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalled()
    expect(reset).toHaveBeenCalled()
  })
})
