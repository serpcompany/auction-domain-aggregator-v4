import '@testing-library/jest-dom/vitest'

// Next's Link reads the app's trailingSlash setting from this build-time variable.
process.env.__NEXT_TRAILING_SLASH = 'true'
