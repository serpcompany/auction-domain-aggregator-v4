import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  downloadFeed,
  serveFeedPages,
  stageZippedFeed,
} from '../src/server/ingestion/file-feed';
import {
  createChildEnvironment,
  fetchWithTimeout,
  installSignalCleanup,
  killChildProcessGroup,
} from '../src/server/ingestion/local-runner';
import {
  implementedProvider,
  PROVIDER_REGISTRY,
  type FileFeed,
} from '../src/server/providers/registry';

// Usage: node --env-file-if-exists=.secrets/providers.env --import tsx scripts/sync-provider.ts <provider>
const PROVIDER = implementedProvider(process.argv[2] ?? '');

const HOST = '127.0.0.1';
const PORT = 8790;
const SYNC_URL = `http://${HOST}:${PORT}/sync/${PROVIDER}`;
const READY_TIMEOUT_MS = 30_000;
const SEGMENT_TIMEOUT_MS = 120_000;
// Bounds for file feeds. GoDaddy's biddable inventory is about 37 MB zipped
// and 450 MB unzipped.
const FEED_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const FEED_ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;
const FEED_JSON_MAX_BYTES = 4 * 1024 * 1024 * 1024;

type SafeSummary = {
  provider: string;
  status: 'succeeded';
  pagesFetched: number;
  recordsFetched: number;
  recordsUpserted: number;
  recordsInactivated: number;
};

function fixedError(message: string): Error {
  const error = new Error(message);
  error.stack = undefined;
  return error;
}

async function ensurePortAvailable() {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(fixedError('sync_port_unavailable')));
    server.listen(PORT, HOST, () => {
      server.close((error) =>
        error ? reject(fixedError('sync_port_unavailable')) : resolve(),
      );
    });
  });
}

function pause(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntilReady(child: ChildProcess) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw fixedError('sync_runner_failed');
    try {
      const response = await fetchWithTimeout(
        fetch,
        SYNC_URL,
        { method: 'GET' },
        1_000,
        'sync_runner_timeout',
      );
      if (response.status === 405) return;
    } catch {
      // The bounded readiness poll retries while workerd starts.
    }
    await pause(100);
  }
  throw fixedError('sync_runner_timeout');
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const closed = new Promise<void>((resolve) =>
    child.once('close', () => resolve()),
  );
  killChildProcessGroup(child);
  const stopped = await Promise.race([
    closed.then(() => true),
    pause(5_000).then(() => false),
  ]);
  if (!stopped && child.exitCode === null) {
    killChildProcessGroup(child, 'SIGKILL');
    await closed;
  }
}

function parseSummary(value: unknown): SafeSummary {
  if (typeof value !== 'object' || value === null) {
    throw fixedError('sync_failed');
  }
  const summary = value as Record<string, unknown>;
  const counters = [
    summary.pagesFetched,
    summary.recordsFetched,
    summary.recordsUpserted,
    summary.recordsInactivated,
  ];
  if (
    summary.provider !== PROVIDER ||
    summary.status !== 'succeeded' ||
    counters.some(
      (counter) => !Number.isSafeInteger(counter) || Number(counter) < 0,
    )
  ) {
    throw fixedError('sync_failed');
  }
  return summary as SafeSummary;
}

function parseContinuation(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const response = value as Record<string, unknown>;
  if (response.status !== 'continue') return null;
  const state = response;
  const values = [
    state.runId,
    state.nextPage,
    state.pagesFetched,
    state.recordsFetched,
    state.recordsUpserted,
    state.recordsInactivated,
  ];
  if (
    values.some(
      (item, index) =>
        !Number.isSafeInteger(item) ||
        (index < 2 ? Number(item) <= 0 : Number(item) < 0),
    )
  ) {
    return null;
  }
  return Number(state.runId);
}

// The worker reports only fixed `<prefix>_<code>` identifiers, such as
// `sync_reconciliation_guard` or `dynadot_http_error`; anything else is
// replaced.
const ERROR_CODE = /^[a-z]+_[a-z_]+$/;

function reportedErrorCode(body: unknown) {
  const code =
    typeof body === 'object' && body !== null && 'errorCode' in body
      ? body.errorCode
      : undefined;
  return typeof code === 'string' && ERROR_CODE.test(code)
    ? code
    : 'sync_failed';
}

async function main() {
  if (!PROVIDER) throw fixedError('sync_unknown_provider');
  const { secretNames } = PROVIDER_REGISTRY[PROVIDER]!;
  if (secretNames.some((name) => !process.env[name])) {
    throw fixedError(`${PROVIDER}_missing_credentials`);
  }

  await ensurePortAvailable();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'provider-sync-'));
  const environmentFile = join(temporaryDirectory, 'worker.env');
  let child: ChildProcess | undefined;
  let closeFeedServer: (() => Promise<void>) | undefined;
  // Installed before any download so an interruption also removes staged
  // feed files; the worker process is attached once it starts.
  const signalCleanup = installSignalCleanup({ temporaryDirectory });

  try {
    // Only this provider's secrets reach the worker.
    const workerValues = secretNames.map((name) => [name, process.env[name]!]);
    const { fileFeed } = PROVIDER_REGISTRY[PROVIDER]!;
    if (fileFeed) {
      const feedServer = await stageFileFeed(fileFeed, temporaryDirectory);
      closeFeedServer = feedServer.close;
      workerValues.push([fileFeed.pagesUrlName, feedServer.url]);
    }
    await writeFile(
      environmentFile,
      workerValues
        .map(([name, value]) => `${name}=${JSON.stringify(value)}\n`)
        .join(''),
      { mode: 0o600 },
    );
    const spawnedChild = spawn(
      'corepack',
      [
        'pnpm',
        'exec',
        'wrangler',
        'dev',
        '--config',
        'wrangler.ingestion.jsonc',
        '--local',
        '--ip',
        HOST,
        '--port',
        String(PORT),
        '--env-file',
        environmentFile,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env: createChildEnvironment(process.env),
      },
    );
    child = spawnedChild;
    signalCleanup.attachChild(spawnedChild);
    spawnedChild.stdout?.resume();
    spawnedChild.stderr?.resume();

    await waitUntilReady(spawnedChild);
    let runId: number | undefined;
    while (true) {
      const response = await fetchWithTimeout(
        fetch,
        SYNC_URL,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(runId ? { runId } : {}),
        },
        SEGMENT_TIMEOUT_MS,
        'sync_segment_timeout',
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw fixedError(reportedErrorCode(body));
      const next = parseContinuation(body);
      if (next) {
        runId = next;
        continue;
      }
      const summary = parseSummary(body);
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      break;
    }
  } finally {
    signalCleanup.unregister();
    if (child) await stopChild(child);
    await closeFeedServer?.();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

// Downloads a provider's zipped feed, splits it into page files, and serves
// them on loopback for the worker's adapter. Only the pages stay on disk.
async function stageFileFeed(fileFeed: FileFeed, temporaryDirectory: string) {
  const archive = join(temporaryDirectory, 'feed.zip');
  const pages = join(temporaryDirectory, 'pages');
  await downloadFeed({
    url: fileFeed.url,
    destination: archive,
    maxBytes: FEED_ARCHIVE_MAX_BYTES,
    timeoutMs: FEED_DOWNLOAD_TIMEOUT_MS,
  });
  await stageZippedFeed({
    archive,
    entry: fileFeed.entry,
    directory: pages,
    pageSize: fileFeed.pageSize,
    maxBytes: FEED_JSON_MAX_BYTES,
  });
  await rm(archive, { force: true });
  return serveFeedPages(pages);
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error && ERROR_CODE.test(error.message)
      ? error.message
      : 'sync_failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
