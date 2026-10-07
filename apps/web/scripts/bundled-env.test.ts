import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { findBundledEnvNames } from './bundled-env'

describe('findBundledEnvNames', () => {
  let directory: string | undefined

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  async function writeModule(source: string) {
    directory = await mkdtemp(join(tmpdir(), 'bundled-env-'))
    const path = join(directory, 'next-env.mjs')
    await writeFile(path, source)
    return path
  }

  it('accepts an empty bundle', async () => {
    const path = await writeModule(
      'export const production = {};\nexport const development = {};\nexport const test = {};\n'
    )
    await expect(findBundledEnvNames(path)).resolves.toEqual([])
  })

  it('reports non-public names across modes and ignores NEXT_PUBLIC_ names', async () => {
    const path = await writeModule(
      'export const production = {"PROVIDER_KEY":"x","NEXT_PUBLIC_SITE":"y"};\n' +
        'export const development = {"OTHER_SECRET":"z","PROVIDER_KEY":"x"};\n' +
        'export const test = {};\n'
    )
    await expect(findBundledEnvNames(path)).resolves.toEqual(['OTHER_SECRET', 'PROVIDER_KEY'])
  })

  it('fails closed on an unrecognized format', async () => {
    const path = await writeModule('export default {};\n')
    await expect(findBundledEnvNames(path)).rejects.toThrow('unrecognized line')
  })
})
