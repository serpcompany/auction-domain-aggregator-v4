import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeToggle } from '@/components/app-shell/theme-toggle'

const setTheme = vi.fn()
let resolvedTheme = 'light'

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme, setTheme })
}))

afterEach(cleanup)

describe('ThemeToggle', () => {
  beforeEach(() => setTheme.mockClear())

  it('switches a light page to dark', () => {
    resolvedTheme = 'light'
    render(<ThemeToggle />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle dark mode' }))
    expect(setTheme).toHaveBeenCalledWith('dark')
  })

  it('switches a dark page to light', () => {
    resolvedTheme = 'dark'
    render(<ThemeToggle />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle dark mode' }))
    expect(setTheme).toHaveBeenCalledWith('light')
  })
})
