import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import { fetchDynadotPage } from '../providers/dynadot';
import {
  runDynadotSegment,
  type DynadotIngestionStorage,
  type FetchDynadotListingsPage,
} from './sync-dynadot';
import { createDynadotD1Storage } from './sync-dynadot-d1';

export type IngestionEnv = {
  DB: D1Database;
  DYNADOT_API_PRODUCTION_KEY: string;
};

const PATH = '/sync-dynadot';

type WorkerDependencies = {
  createStorage?: (database: D1Database) => DynadotIngestionStorage;
  fetchPage?: FetchDynadotListingsPage;
};

export async function handleLocalWorkerRequest(
  request: Request,
  env: IngestionEnv,
  dependencies: WorkerDependencies = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== PATH) return new Response(null, { status: 404 });
  if (request.method !== 'POST') {
    return new Response(null, { status: 405 });
  }

  const apiKey = env.DYNADOT_API_PRODUCTION_KEY;
  if (!apiKey) {
    return Response.json(
      { status: 'failed', errorCode: 'dynadot_sync_failed' },
      { status: 500 },
    );
  }

  try {
    const db = drizzle(env.DB, { schema });
    const body: unknown = await request.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      Object.keys(body).some((key) => key !== 'runId') ||
      ('runId' in body &&
        (!Number.isSafeInteger(body.runId) || Number(body.runId) < 1))
    ) {
      return Response.json(
        { status: 'failed', errorCode: 'dynadot_sync_invalid_request' },
        { status: 400 },
      );
    }
    const runId = 'runId' in body ? Number(body.runId) : undefined;
    /* v8 ignore next 3 -- default D1 wiring is exercised by the D1 adapter */
    const storage = dependencies.createStorage
      ? dependencies.createStorage(env.DB)
      : createDynadotD1Storage(db);
    const fetchPage =
      dependencies.fetchPage ??
      (({ pageIndex, pageSize }) =>
        fetchDynadotPage({ apiKey, pageIndex, pageSize }));
    const result = await runDynadotSegment(storage, {
      fetchPage,
      runId,
      segmentPages: 20,
    });
    return Response.json(
      result.done
        ? result.summary
        : {
            status: 'continue',
            runId: result.run.runId,
            nextPage: result.run.nextPage,
            pagesFetched: result.run.pagesFetched,
            recordsFetched: result.run.recordsFetched,
            recordsUpserted: result.run.recordsUpserted,
            recordsInactivated: result.run.recordsInactivated,
          },
    );
  } catch {
    return Response.json(
      { status: 'failed', errorCode: 'dynadot_sync_failed' },
      { status: 500 },
    );
  }
}

const worker = {
  fetch(request: Request, env: IngestionEnv) {
    return handleLocalWorkerRequest(request, env);
  },
};

export default worker;
