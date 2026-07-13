import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'dist/**',
    '.open-next/**',
    '.wrangler/**',
    '.vercel/**',
    'coverage/**',
    'next-env.d.ts',
    'cloudflare-env.d.ts',
  ]),
]);

export default eslintConfig;
