// Normalization shared by provider adapters. Every helper throws a plain
// Error on invalid input; adapters count the record as rejected or map the
// failure to their own fixed provider error code.

export class ResponseTooLargeError extends Error {
  constructor() {
    super('response_too_large');
    this.name = 'ResponseTooLargeError';
  }
}

// Reads a response body as text, failing once it exceeds `byteLimit`.
export async function readBoundedBody(response: Response, byteLimit: number) {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    Number.isSafeInteger(Number(contentLength)) &&
    Number(contentLength) > byteLimit
  ) {
    throw new ResponseTooLargeError();
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return body + decoder.decode();
    bytesRead += value.byteLength;
    if (bytesRead > byteLimit) {
      await reader.cancel();
      throw new ResponseTooLargeError();
    }
    body += decoder.decode(value, { stream: true });
  }
}

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function toAsciiDomain(value: string) {
  const domain = value.trim().toLowerCase();
  // Store internationalized names in their punycode (xn--) form.
  if (/^[\x00-\x7f]*$/.test(domain)) return domain;
  try {
    return new URL(`http://${domain}`).hostname;
  } catch {
    throw new Error('invalid_domain');
  }
}

// Lowercase, punycode, syntactically valid domain name.
export function parseDomain(value: string) {
  const domain = toAsciiDomain(value);
  const labels = domain.split('.');

  if (
    domain.length === 0 ||
    domain.length > 253 ||
    !domain.includes('.') ||
    domain.endsWith('.') ||
    labels.some((label) => !DOMAIN_LABEL.test(label))
  ) {
    throw new Error('invalid_domain');
  }

  return domain;
}

function decimalParts(value: string | number) {
  const text = String(value).trim().replaceAll(',', '').replace(/^\$/, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error('invalid_decimal');

  return { whole: match[1]!, fraction: (match[2] ?? '').padEnd(2, '0') };
}

// "$1,234.5", "1234.50", or 1234.5 as safe-integer cents.
export function parseMoneyCents(value: string | number) {
  const { whole, fraction } = decimalParts(value);
  const cents = Number(BigInt(whole) * 100n + BigInt(fraction));
  if (!Number.isSafeInteger(cents)) throw new Error('invalid_money');
  return cents;
}

export function parseNonnegativeInteger(value: string | number) {
  const parsed =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? value
      : Number(String(value).trim());
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('invalid_integer');
  }
  return parsed;
}
