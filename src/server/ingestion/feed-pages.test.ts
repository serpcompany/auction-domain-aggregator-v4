// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ResponseTooLargeError } from '../providers/normalize';
import {
  createR2PageSink,
  createR2PageSource,
  deleteFeedPages,
  feedPageKey,
  feedPagesPrefix,
  type FeedPageBucket,
} from './feed-pages';

// In-memory stand-in for the subset of the R2 binding the module uses.
function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  const cancelled: string[] = [];
  const bucket: FeedPageBucket = {
    async put(key, value) {
      objects.set(key, value.slice());
    },
    async get(key) {
      const value = objects.get(key);
      if (!value) return null;
      return {
        size: value.byteLength,
        text: async () => new TextDecoder().decode(value),
        body: new ReadableStream({
          cancel() {
            cancelled.push(key);
          },
        }),
      };
    },
    async list({ prefix, limit }) {
      return {
        objects: [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .sort()
          .slice(0, limit)
          .map((key) => ({ key })),
      };
    },
    async delete(keys) {
      for (const key of keys) objects.delete(key);
    },
  };
  return { bucket, objects, cancelled };
}

describe('feed page keys', () => {
  it('scopes pages by provider and run key', () => {
    const prefix = feedPagesPrefix('godaddy', 'godaddy-20261006T1530');
    expect(prefix).toBe('feed-pages/godaddy/godaddy-20261006T1530/');
    expect(feedPageKey(prefix, 3)).toBe(
      'feed-pages/godaddy/godaddy-20261006T1530/page-3.json',
    );
  });

  it('rejects run keys that could escape the prefix', () => {
    for (const key of ['', '../x', 'a/b', '-x', 'x'.repeat(101)]) {
      expect(() => feedPagesPrefix('godaddy', key)).toThrow(
        'feed_invalid_run_key',
      );
    }
  });
});

describe('R2 feed pages', () => {
  it('writes pages and reads them back within a size limit', async () => {
    const { bucket, cancelled } = memoryBucket();
    const prefix = feedPagesPrefix('godaddy', 'run-1');
    const sink = createR2PageSink(bucket, prefix);
    await sink(1, new TextEncoder().encode('{"page":1}'));
    const source = createR2PageSource(bucket, prefix);

    await expect(source.readPage(1, 100)).resolves.toBe('{"page":1}');
    await expect(source.readPage(2, 100)).resolves.toBeNull();
    await expect(source.readPage(1, 5)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
    expect(cancelled).toEqual([feedPageKey(prefix, 1)]);
  });

  it("deletes only one run's pages, across listing pages", async () => {
    const { bucket, objects } = memoryBucket();
    const prefix = feedPagesPrefix('godaddy', 'run-1');
    const other = feedPagesPrefix('godaddy', 'run-10');
    const body = new Uint8Array([1]);
    for (let page = 1; page <= 1001; page += 1) {
      await bucket.put(feedPageKey(prefix, page), body);
    }
    await bucket.put(feedPageKey(other, 1), body);

    await expect(deleteFeedPages(bucket, prefix)).resolves.toBe(1001);
    expect([...objects.keys()]).toEqual([feedPageKey(other, 1)]);
    await expect(deleteFeedPages(bucket, prefix)).resolves.toBe(0);
  });

  it('gives up on a bucket that never empties', async () => {
    const { bucket } = memoryBucket();
    const prefix = feedPagesPrefix('godaddy', 'run-1');
    await bucket.put(feedPageKey(prefix, 1), new Uint8Array([1]));
    const stuck = { ...bucket, delete: vi.fn(async () => undefined) };
    await expect(deleteFeedPages(stuck, prefix)).rejects.toThrow(
      'feed_cleanup_incomplete',
    );
    expect(stuck.delete).toHaveBeenCalledTimes(100);
  });
});
