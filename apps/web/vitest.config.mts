import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { configDefaults, defineConfig } from 'vitest/config'

const ignored = [...configDefaults.exclude, 'e2e/**', '.claude/**', 'tmp/**']

export default defineConfig({
  resolve: {
    tsconfigPaths: true
  },
  test: {
    coverage: {
      // The Workers runtime has no V8 coverage, so both projects use Istanbul.
      provider: 'istanbul',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.{test,spec}.{ts,tsx}',
        '**/*.d.ts',
        // Stock shadcn source, kept as upstream ships it.
        'src/components/ui/**',
        'src/hooks/use-mobile.ts',
        // Next.js renders these server components; browser acceptance (e2e/) covers them.
        'src/app/**/{page,layout}.tsx',
        // Test fixtures and helpers.
        'src/**/test-*.ts',
        'src/server/ingestion/zip-fixture.ts'
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100
      }
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          exclude: [...ignored, '**/*.workers.test.ts']
        }
      },
      {
        // Real D1 and R2 in workerd, with the ingestion Worker's bindings and compatibility
        // settings. Every test starts from empty storage with the migrations applied
        // (vitest.workers-setup.ts); nothing touches the owner's .wrangler state.
        extends: true,
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: './wrangler.ingestion.jsonc' },
            miniflare: {
              bindings: { TEST_MIGRATIONS: await readD1Migrations('./drizzle') }
            }
          }))
        ],
        test: {
          name: 'workers',
          include: ['src/**/*.workers.test.ts'],
          exclude: ignored,
          setupFiles: ['./vitest.workers-setup.ts']
        }
      }
    ]
  }
})
