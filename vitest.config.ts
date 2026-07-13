import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/components/**/*.{ts,tsx}',
        'src/domain/**/*.{ts,tsx}',
        'src/providers/**/*.{ts,tsx}',
        'src/server/providers/dynadot/index.ts',
        'src/server/ingestion/sync-dynadot.ts',
        'src/server/ingestion/local-worker.ts',
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
