import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import {
  implementedProvider,
  PROVIDER_REGISTRY,
  type ProviderSecrets,
} from '../providers/registry';
import type { AuctionProvider, ProviderAdapter } from '../providers/types';
import { createD1IngestionStorage } from './d1-storage';
import { runSyncSegment, SyncError, type IngestionStorage } from './sync';

export type IngestionEnv = ProviderSecrets & { DB: D1Database };

const PATH = /^\/sync\/([a-z]+)$/;

type WorkerDependencies = {
  createStorage?: (
    database: D1Database,
    provider: AuctionProvider,
  ) => IngestionStorage;
  createAdapter?: (provider: AuctionProvider) => ProviderAdapter;
};

function failed(errorCode: string, status: number) {
  return Response.json({ status: 'failed', errorCode }, { status });
}

export async function handleLocalWorkerRequest(
  request: Request,
  env: IngestionEnv,
  dependencies: WorkerDependencies = {},
): Promise<Response> {
  const match = PATH.exec(new URL(request.url).pathname);
  const provider = match ? implementedProvider(match[1]!) : null;
  if (!provider) return new Response(null, { status: 404 });
  if (request.method !== 'POST') {
    return new Response(null, { status: 405 });
  }

  const registration = PROVIDER_REGISTRY[provider]!;
  if (registration.secretNames.some((name) => !env[name])) {
    return failed(`${provider}_missing_credentials`, 500);
  }
  // A file-feed provider reads pages the runner staged on loopback.
  if (registration.fileFeed && !env[registration.fileFeed.pagesUrlName]) {
    return failed(`${provider}_missing_feed`, 500);
  }

  try {
    const body: unknown = await request.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      Object.keys(body).some((key) => key !== 'runId') ||
      ('runId' in body &&
        (!Number.isSafeInteger(body.runId) || Number(body.runId) < 1))
    ) {
      return failed('sync_invalid_request', 400);
    }
    const runId = 'runId' in body ? Number(body.runId) : undefined;
    /* v8 ignore next 6 -- default wiring is exercised by the D1 proof and live sync */
    const storage = dependencies.createStorage
      ? dependencies.createStorage(env.DB, provider)
      : createD1IngestionStorage(drizzle(env.DB, { schema }), provider);
    const adapter = dependencies.createAdapter
      ? dependencies.createAdapter(provider)
      : registration.createAdapter(env);
    const result = await runSyncSegment(adapter, storage, {
      runId,
      segmentPages: 20,
    });
    return Response.json(
      result.done
        ? result.summary
        : {
            status: 'continue',
            provider,
            runId: result.run.runId,
            nextPage: result.run.nextPage,
            pagesFetched: result.run.pagesFetched,
            recordsFetched: result.run.recordsFetched,
            recordsUpserted: result.run.recordsUpserted,
            recordsInactivated: result.run.recordsInactivated,
            recordsRejected: result.run.recordsRejected,
          },
    );
  } catch (error) {
    // Sync and provider error codes are fixed, non-secret identifiers.
    return failed(error instanceof SyncError ? error.code : 'sync_failed', 500);
  }
}

const worker = {
  fetch(request: Request, env: IngestionEnv) {
    return handleLocalWorkerRequest(request, env);
  },
};

export default worker;
