'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Asks the server to fetch Ahrefs DR for visible rows that have none stored,
// then re-renders the page from D1. Renders nothing; on any failure the cells
// keep showing "not collected".
export function EnrichVisibleDomainRatings({ domains }: { domains: string[] }) {
  const router = useRouter();
  const key = domains.join(',');

  useEffect(() => {
    if (key === '') return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/enrichment/domain-rating', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ domains: key.split(',') }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as { stored?: unknown };
        if (typeof body.stored === 'number' && body.stored > 0) {
          router.refresh();
        }
      } catch {
        // Enrichment is best effort.
      }
    })();
    return () => controller.abort();
  }, [key, router]);

  return null;
}
