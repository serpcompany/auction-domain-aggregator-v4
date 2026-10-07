import '@testing-library/jest-dom/vitest'

// Next's Link reads the app's trailingSlash setting from this build-time variable.
process.env.__NEXT_TRAILING_SLASH = 'true'

// jsdom has no matchMedia; the stock sidebar and the details panel ask it for
// the phone breakpoint. Tests that need a width set window.innerWidth.
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })) as typeof window.matchMedia
}
