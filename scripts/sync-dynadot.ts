import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createChildEnvironment,
  fetchWithTimeout,
  installSignalCleanup,
  killChildProcessGroup,
} from '../src/server/ingestion/local-runner';

const HOST = '127.0.0.1';
const PORT = 8790;
const SYNC_URL = `http://${HOST}:${PORT}/sync-dynadot`;
const READY_TIMEOUT_MS = 30_000;
const SEGMENT_TIMEOUT_MS = 120_000;

type SafeSummary = {
  provider: 'dynadot';
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
    server.once('error', () =>
      reject(fixedError('dynadot_sync_port_unavailable')),
    );
    server.listen(PORT, HOST, () => {
      server.close((error) =>
        error ? reject(fixedError('dynadot_sync_port_unavailable')) : resolve(),
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
    if (child.exitCode !== null) throw fixedError('dynadot_sync_runner_failed');
    try {
      const response = await fetchWithTimeout(
        fetch,
        SYNC_URL,
        { method: 'GET' },
        1_000,
        'dynadot_sync_runner_timeout',
      );
      if (response.status === 405) return;
    } catch {
      // The bounded readiness poll retries while workerd starts.
    }
    await pause(100);
  }
  throw fixedError('dynadot_sync_runner_timeout');
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
    throw fixedError('dynadot_sync_failed');
  }
  const summary = value as Record<string, unknown>;
  const counters = [
    summary.pagesFetched,
    summary.recordsFetched,
    summary.recordsUpserted,
    summary.recordsInactivated,
  ];
  if (
    summary.provider !== 'dynadot' ||
    summary.status !== 'succeeded' ||
    counters.some(
      (counter) => !Number.isSafeInteger(counter) || Number(counter) < 0,
    )
  ) {
    throw fixedError('dynadot_sync_failed');
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

// The worker reports only fixed `dynadot_*` codes; anything else is replaced.
const ERROR_CODE = /^dynadot_[a-z_]+$/;

function reportedErrorCode(body: unknown) {
  const code =
    typeof body === 'object' && body !== null && 'errorCode' in body
      ? body.errorCode
      : undefined;
  return typeof code === 'string' && ERROR_CODE.test(code)
    ? code
    : 'dynadot_sync_failed';
}

async function main() {
  const apiKey = process.env.DYNADOT_API_PRODUCTION_KEY;
  if (!apiKey) throw fixedError('missing_dynadot_api_key');

  await ensurePortAvailable();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'dynadot-sync-'));
  const environmentFile = join(temporaryDirectory, 'worker.env');
  let child: ChildProcess | undefined;
  let unregisterSignals: (() => void) | undefined;

  try {
    await writeFile(
      environmentFile,
      `DYNADOT_API_PRODUCTION_KEY=${JSON.stringify(apiKey)}\n`,
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
    spawnedChild.stdout?.resume();
    spawnedChild.stderr?.resume();

    const signalCleanup = installSignalCleanup({
      child: spawnedChild,
      temporaryDirectory,
    });
    unregisterSignals = signalCleanup.unregister;
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
        'dynadot_sync_segment_timeout',
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
    unregisterSignals?.();
    if (child) await stopChild(child);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error &&
    (error.message === 'missing_dynadot_api_key' ||
      ERROR_CODE.test(error.message))
      ? error.message
      : 'dynadot_sync_failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
