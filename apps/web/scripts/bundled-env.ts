import { readFile } from 'node:fs/promises'

// `opennextjs-cloudflare build` inlines every value from the project's
// `.env*` files into this module, which ships inside the Worker bundle.
// Each line has the form `export const <mode> = <JSON object>;`.
export const BUNDLED_ENV_MODULE = '.open-next/cloudflare/next-env.mjs'

// Variables that are public by definition may be bundled.
const PUBLIC_PREFIX = 'NEXT_PUBLIC_'
const EXPORT_LINE = /^export const \w+ = (\{.*\});$/

export async function findBundledEnvNames(modulePath: string) {
  const names = new Set<string>()
  for (const line of (await readFile(modulePath, 'utf8')).split('\n')) {
    if (line.trim() === '') continue
    const match = EXPORT_LINE.exec(line)
    // Fail closed if OpenNext changes the format.
    if (!match) throw new Error(`unrecognized line in ${modulePath}`)
    for (const name of Object.keys(JSON.parse(match[1]) as object)) {
      if (!name.startsWith(PUBLIC_PREFIX)) names.add(name)
    }
  }
  return [...names].sort()
}
