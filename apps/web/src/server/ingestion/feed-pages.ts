// Staged file-feed pages in R2. Each Workflow instance writes its pages under
// its own prefix, the provider adapter reads them back one at a time, and
// the Workflow deletes the prefix when the run ends.
import { ResponseTooLargeError } from '../providers/normalize';
import type { AuctionProvider, FeedPageSource } from '../providers/types';
import type { FeedPageSink } from './feed-stage';

// The subset of the R2 binding this module uses, so tests can supply a fake.
export type FeedPageBucket = {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{
    size: number;
    text(): Promise<string>;
    body: ReadableStream;
  } | null>;
  list(options: {
    prefix: string;
    limit: number;
  }): Promise<{ objects: { key: string }[] }>;
  delete(keys: string[]): Promise<void>;
};

// Instance IDs match Workflows' `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$`.
const RUN_KEY = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/;

export function feedPagesPrefix(provider: AuctionProvider, runKey: string) {
  if (!RUN_KEY.test(runKey)) throw new Error('feed_invalid_run_key');
  return `feed-pages/${provider}/${runKey}/`;
}

export function feedPageKey(prefix: string, page: number) {
  return `${prefix}page-${page}.json`;
}

export function createR2PageSink(
  bucket: FeedPageBucket,
  prefix: string,
): FeedPageSink {
  return async (page, body) => {
    await bucket.put(feedPageKey(prefix, page), body);
  };
}

export function createR2PageSource(
  bucket: FeedPageBucket,
  prefix: string,
): FeedPageSource {
  return {
    async readPage(page, maxBytes) {
      const object = await bucket.get(feedPageKey(prefix, page));
      if (!object) return null;
      if (object.size > maxBytes) {
        await object.body.cancel();
        throw new ResponseTooLargeError();
      }
      return object.text();
    },
  };
}

// A run stages at most 1,000 pages; the bound only stops a bucket that never
// empties from looping forever.
const MAX_DELETE_ROUNDS = 100;

// Deletes every object under `prefix` and returns how many there were.
export async function deleteFeedPages(bucket: FeedPageBucket, prefix: string) {
  let deleted = 0;
  // Listing again after each deletion, rather than following a cursor,
  // stays correct while the listing changes.
  for (let round = 0; round < MAX_DELETE_ROUNDS; round += 1) {
    const listing = await bucket.list({ prefix, limit: 1000 });
    if (listing.objects.length === 0) return deleted;
    await bucket.delete(listing.objects.map((object) => object.key));
    deleted += listing.objects.length;
  }
  throw new Error('feed_cleanup_incomplete');
}
