import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { copyE2eBuildSources, E2E_BUILD_ROOT_FILES } from './e2e-isolated-build'

describe('isolated E2E build sources', () => {
  it('copies the allowlisted build manifest without dotenv or local state', async () => {
    const source = await mkdtemp(join(tmpdir(), 'e2e-build-source-proof-'))
    const target = await mkdtemp(join(tmpdir(), 'e2e-build-target-proof-'))
    try {
      for (const file of E2E_BUILD_ROOT_FILES) {
        await writeFile(join(source, file), `controlled ${file}`)
      }
      expect(E2E_BUILD_ROOT_FILES).not.toContain('next-env.d.ts')
      await writeFile(join(source, 'next-env.d.ts'), 'controlled generated file must not copy')
      await mkdir(join(source, 'src', 'app'), { recursive: true })
      await mkdir(join(source, 'public'), { recursive: true })
      await mkdir(join(source, '.wrangler'), { recursive: true })
      await mkdir(join(source, 'tmp'), { recursive: true })
      await writeFile(join(source, 'src', 'app', 'page.tsx'), 'export default 1')
      await writeFile(join(source, 'public', 'favicon.svg'), '<svg />')
      await writeFile(join(source, '.env'), 'CONTROLLED_SENTINEL=must-not-copy')
      await writeFile(join(source, '.env.local'), 'CONTROLLED_SENTINEL=must-not-copy')
      await writeFile(join(source, '.dev.vars'), 'CONTROLLED_SENTINEL=must-not-copy')
      await writeFile(join(source, '.wrangler', 'state'), 'must-not-copy')
      await writeFile(join(source, 'tmp', 'local-state'), 'must-not-copy')
      await writeFile(join(source, 'src', 'secret.pem'), 'must-not-copy')

      await copyE2eBuildSources(source, target)

      await expect(access(join(target, 'src', 'app', 'page.tsx'))).resolves.toBeUndefined()
      await expect(access(join(target, 'public', 'favicon.svg'))).resolves.toBeUndefined()
      for (const excluded of [
        '.env',
        '.env.local',
        '.dev.vars',
        'next-env.d.ts',
        '.wrangler',
        'tmp',
        'src/secret.pem'
      ]) {
        await expect(access(join(target, excluded))).rejects.toMatchObject({
          code: 'ENOENT'
        })
      }
    } finally {
      await rm(source, { recursive: true, force: true })
      await rm(target, { recursive: true, force: true })
    }
  })
})
