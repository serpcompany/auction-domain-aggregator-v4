import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CopyCommand } from '@/components/auctions/copy-command'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
afterEach(cleanup)

describe('CopyCommand', () => {
  it('copies the command and says so, or says when copying is blocked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<CopyCommand command="corepack pnpm sync godaddy" />)

    expect(screen.getByText('corepack pnpm sync godaddy')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy corepack pnpm sync godaddy' }))
    })
    expect(writeText).toHaveBeenCalledWith('corepack pnpm sync godaddy')
    expect(toast.success).toHaveBeenCalledWith('Copied the command')

    writeText.mockRejectedValueOnce(new Error('blocked'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy corepack pnpm sync godaddy' }))
    })
    expect(toast.error).toHaveBeenCalledWith('Copying is blocked in this browser.')
  })
})
