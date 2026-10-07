import { z } from 'zod';

// Ahrefs' free Domain Rating endpoint. Requests cost no API units but need an
// APIv3 key; displayed values must carry the attribution required by
// https://ahrefs.com/legal/domain-rating-license.
const ENDPOINT = 'https://api.ahrefs.com/v3/public/domain-rating-free';
export const AHREFS_DR_MAX_TARGETS = 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const RESPONSE_BYTE_LIMIT = 1024 * 1024;

const responseSchema = z.object({
  domain_rating: z.object({
    targets: z
      .array(
        z.object({
          target: z.string().max(253),
          domain_rating: z.number().min(0).max(100).nullable(),
        }),
      )
      .max(AHREFS_DR_MAX_TARGETS),
  }),
});

export type AhrefsErrorCode =
  | 'ahrefs_invalid_request'
  | 'ahrefs_network_error'
  | 'ahrefs_unauthorized'
  | 'ahrefs_rate_limited'
  | 'ahrefs_http_error'
  | 'ahrefs_response_error';

export class AhrefsError extends Error {
  readonly code: AhrefsErrorCode;

  constructor(code: AhrefsErrorCode) {
    super(code);
    this.name = 'AhrefsError';
    this.code = code;
  }
}

async function readBoundedText(response: Response) {
  const text = await response.text();
  if (text.length > RESPONSE_BYTE_LIMIT) {
    throw new AhrefsError('ahrefs_response_error');
  }
  return text;
}

// Returns DR keyed by requested domain. A domain Ahrefs returns without a
// rating maps to null; a domain missing from the response is omitted so the
// caller can retry it later.
export async function fetchDomainRatings({
  apiKey,
  domains,
  fetchImpl = fetch,
}: {
  apiKey: string;
  domains: string[];
  fetchImpl?: typeof fetch;
}): Promise<Map<string, number | null>> {
  if (
    !apiKey ||
    domains.length === 0 ||
    domains.length > AHREFS_DR_MAX_TARGETS
  ) {
    throw new AhrefsError('ahrefs_invalid_request');
  }

  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ targets: domains }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AhrefsError('ahrefs_network_error');
  }

  if (response.status === 401 || response.status === 403) {
    throw new AhrefsError('ahrefs_unauthorized');
  }
  if (response.status === 429) throw new AhrefsError('ahrefs_rate_limited');
  if (!response.ok) throw new AhrefsError('ahrefs_http_error');

  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(JSON.parse(await readBoundedText(response)));
  } catch {
    throw new AhrefsError('ahrefs_response_error');
  }

  const requested = new Set(domains);
  const ratings = new Map<string, number | null>();
  for (const { target, domain_rating } of parsed.domain_rating.targets) {
    // Ahrefs echoes targets as URL-ish strings, e.g. `example.com/`.
    const domain = target
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    if (requested.has(domain)) ratings.set(domain, domain_rating);
  }
  return ratings;
}
