import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {
    // Do not let lockfiles outside this repository change Next.js's workspace root.
    root: process.cwd(),
  },
};

export default nextConfig;

// Enable calling `getCloudflareContext()` in `next dev`.
// See https://opennext.js.org/cloudflare/bindings#local-access-to-bindings.
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
initOpenNextCloudflareForDev();
