import { spawn, type ChildProcess } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
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
const PORT = 8791;
const URL = `http://${HOST}:${PORT}/run`;
const CONFIG = 'wrangler.integration.jsonc';
const READY_TIMEOUT_MS = 30_000;
const PROOF_TIMEOUT_MS = 120_000;

type ProofSummary = {
  status: 'succeeded';
  initialCount: 3;
  idempotentCount: 3;
  staleRejected: true;
  failedRunActiveCount: 3;
  successfulReconciled: 2;
  repeatedReconciled: 0;
  activeCount: 51;
  inactiveCount: 2;
  filteredTotal: 1;
  firstPageCount: 50;
  secondPageCount: 1;
  successfulRunCount: 2;
  expandedFilterProof: true;
  sortCount: 11;
  facetTldCount: 4;
  nullSemantics: true;
  categoryBindCap: 64;
  exactSortProof: true;
  tieBreakProof: true;
  pageClampProof: true;
  independentFilterProof: true;
  wildcardEscapeProof: true;
  godaddyFeedProof: true;
  cloudFeedProof: true;
  derivedNameColumnProof: true;
  uncappedTldFacetProof: true;
  feedErrorProof: true;
};

function fixedError(code: string) {
  const error = new Error(code);
  error.stack = undefined;
  return error;
}

function pause(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ensurePortAvailable() {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(fixedError('d1_integration_port_unavailable')),
    );
    server.listen(PORT, HOST, () => {
      server.close((error) =>
        error
          ? reject(fixedError('d1_integration_port_unavailable'))
          : resolve(),
      );
    });
  });
}

async function runCommand(arguments_: string[], errorCode: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('corepack', arguments_, {
      cwd: process.cwd(),
      env: createChildEnvironment(process.env),
      stdio: 'ignore',
    });
    child.once('error', () => reject(fixedError(errorCode)));
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(fixedError(errorCode)),
    );
  });
}

async function waitUntilReady(child: ChildProcess) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw fixedError('d1_integration_runner_failed');
    try {
      const response = await fetchWithTimeout(
        fetch,
        URL,
        { method: 'GET' },
        1_000,
        'd1_integration_runner_timeout',
      );
      if (response.status === 405) return;
    } catch {
      // The bounded readiness poll retries while workerd starts.
    }
    await pause(100);
  }
  throw fixedError('d1_integration_runner_timeout');
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

function parseSummary(value: unknown): ProofSummary {
  if (typeof value !== 'object' || value === null) {
    throw fixedError('d1_integration_failed');
  }
  const summary = value as Record<string, unknown>;
  if (summary.status === 'failed' && typeof summary.failure === 'string') {
    throw fixedError(`d1_integration_failed: ${summary.failure}`);
  }
  const expected = {
    status: 'succeeded',
    initialCount: 3,
    idempotentCount: 3,
    staleRejected: true,
    failedRunActiveCount: 3,
    successfulReconciled: 2,
    repeatedReconciled: 0,
    activeCount: 51,
    inactiveCount: 2,
    filteredTotal: 1,
    firstPageCount: 50,
    secondPageCount: 1,
    successfulRunCount: 2,
    expandedFilterProof: true,
    sortCount: 11,
    facetTldCount: 4,
    nullSemantics: true,
    categoryBindCap: 64,
    exactSortProof: true,
    tieBreakProof: true,
    pageClampProof: true,
    independentFilterProof: true,
    wildcardEscapeProof: true,
    godaddyFeedProof: true,
    cloudFeedProof: true,
    derivedNameColumnProof: true,
    uncappedTldFacetProof: true,
    feedErrorProof: true,
  } as const;
  const mismatched = Object.entries(expected)
    .filter(([key, expectedValue]) => summary[key] !== expectedValue)
    .map(([key]) => `${key}=${String(summary[key])}`);
  if (mismatched.length > 0) {
    throw fixedError(`d1_integration_failed: ${mismatched.join(', ')}`);
  }
  return summary as ProofSummary;
}

async function main() {
  await ensurePortAvailable();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'd1-integration-'));
  const persistenceDirectory = join(temporaryDirectory, 'state');
  let child: ChildProcess | undefined;
  let unregisterSignals: (() => void) | undefined;

  try {
    await runCommand(
      [
        'pnpm',
        'exec',
        'wrangler',
        'd1',
        'migrations',
        'apply',
        'DB',
        '--local',
        '--config',
        CONFIG,
        '--persist-to',
        persistenceDirectory,
        '--env-file',
        '/dev/null',
      ],
      'd1_integration_migration_failed',
    );

    child = spawn(
      'corepack',
      [
        'pnpm',
        'exec',
        'wrangler',
        'dev',
        '--config',
        CONFIG,
        '--local',
        '--ip',
        HOST,
        '--port',
        String(PORT),
        '--persist-to',
        persistenceDirectory,
        '--env-file',
        '/dev/null',
      ],
      {
        cwd: process.cwd(),
        env: createChildEnvironment(process.env),
        stdio: 'ignore',
        detached: true,
      },
    );
    const signalCleanup = installSignalCleanup({
      child,
      temporaryDirectory,
    });
    unregisterSignals = signalCleanup.unregister;
    await waitUntilReady(child);

    const response = await fetchWithTimeout(
      fetch,
      URL,
      { method: 'POST' },
      PROOF_TIMEOUT_MS,
      'd1_integration_proof_timeout',
    );
    const summary = parseSummary(await response.json());
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    unregisterSignals?.();
    if (child) await stopChild(child);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const allowed = [
    'd1_integration_port_unavailable',
    'd1_integration_migration_failed',
    'd1_integration_runner_failed',
    'd1_integration_runner_timeout',
    'd1_integration_proof_timeout',
  ];
  const message =
    error instanceof Error &&
    (allowed.includes(error.message) ||
      error.message.startsWith('d1_integration_failed: '))
      ? error.message
      : 'd1_integration_failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
