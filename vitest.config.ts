import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**', '.claude/**'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/components/**/*.{ts,tsx}',
        'src/domain/**/*.{ts,tsx}',
        'src/server/providers/**/*.ts',
        'src/server/ingestion/sync.ts',
        'src/server/enrichment/ahrefs.ts',
        'src/server/enrichment/domain-rating-request.ts',
        'src/server/ingestion/feed-stage.ts',
        'src/server/ingestion/feed-pages.ts',
        'src/server/ingestion/provider-sync-workflow.ts',
        'src/server/ingestion/local-runner.ts',
      ],
      exclude: [
        'src/components/ui/**',
        '**/*.{test,spec}.{ts,tsx}',
        '**/*.d.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
