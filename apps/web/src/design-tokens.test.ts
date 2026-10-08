import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// SERP web UI rule: color only through the tokens in globals.css. Stock shadcn
// files in components/ui stay as the registry writes them, so they are skipped.
const SRC = join(process.cwd(), 'src')
const SKIPPED = new Set(['app/globals.css', 'design-tokens.test.ts'])
const SKIPPED_DIRECTORIES = ['components/ui/']

const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/i
const PALETTE_CLASS =
  /\b(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|fill|stroke|from|via|to|shadow|divide|placeholder|accent|caret|decoration)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:css|ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

function violations(pattern: RegExp) {
  return sourceFiles(SRC).flatMap(path => {
    const file = relative(SRC, path)
    if (SKIPPED.has(file) || SKIPPED_DIRECTORIES.some(prefix => file.startsWith(prefix))) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        pattern.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : []
      )
  })
}

describe('design tokens', () => {
  it('uses no literal colors outside globals.css', () => {
    expect(violations(LITERAL_COLOR)).toEqual([])
  })

  it('uses no Tailwind palette colors', () => {
    expect(violations(PALETTE_CLASS)).toEqual([])
  })

  it('gives each provider dot a light and a dark color, apart in lightness', () => {
    const css = readFileSync(join(SRC, 'app/globals.css'), 'utf8')
    const block = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split('}')[0]
    for (const theme of [block(':root'), block('.dark')]) {
      const lightness = ['namecheap', 'godaddy', 'dynadot', 'namesilo'].map(provider => {
        const value = theme.match(new RegExp(`--provider-${provider}: oklch\\(([\\d.]+) `))
        expect(value, provider).not.toBeNull()
        return Number(value?.[1])
      })
      const sorted = [...lightness].sort((a, b) => a - b)
      for (let index = 1; index < sorted.length; index++) {
        expect(sorted[index] - sorted[index - 1]).toBeGreaterThanOrEqual(0.08)
      }
    }
  })
})
