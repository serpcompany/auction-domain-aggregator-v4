import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';

const ALLOWED_CHILD_ENV = [
  'PATH',
  'NODE_ENV',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'CI',
  'COREPACK_HOME',
  'PNPM_HOME',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
] as const;

export function createChildEnvironment(
  source: Record<string, string | undefined>,
) {
  return Object.fromEntries(
    ALLOWED_CHILD_ENV.flatMap((name) =>
      source[name] === undefined ? [] : [[name, source[name]]],
    ),
  ) as NodeJS.ProcessEnv;
}

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
  errorCode: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  try {
    return await fetchImpl(input, { ...init, signal });
  } catch {
    throw new Error(errorCode);
  } finally {
    clearTimeout(timeout);
  }
}

type SignalName = 'SIGINT' | 'SIGTERM';

type ProcessTarget = {
  once(signal: SignalName, listener: () => void): unknown;
  off(signal: SignalName, listener: () => void): unknown;
  exit(code: number): never | void;
};

export function killChildProcessGroup(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM',
  platform = process.platform,
) {
  if (!child.pid || child.exitCode !== null) return;
  if (platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when it is not a process-group leader.
    }
  }
  child.kill(signal);
}

export function installSignalCleanup({
  child,
  temporaryDirectory,
  processTarget = process,
  killChild = killChildProcessGroup,
  removeDirectory = (path: string) =>
    rmSync(path, { recursive: true, force: true }),
}: {
  child: ChildProcess;
  temporaryDirectory: string;
  processTarget?: ProcessTarget;
  killChild?: (child: ChildProcess) => void;
  removeDirectory?: (path: string) => void;
}) {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    killChild(child);
    removeDirectory(temporaryDirectory);
  };
  const onInterrupt = () => {
    cleanup();
    processTarget.exit(130);
  };
  const onTerminate = () => {
    cleanup();
    processTarget.exit(143);
  };
  processTarget.once('SIGINT', onInterrupt);
  processTarget.once('SIGTERM', onTerminate);

  return {
    cleanup,
    unregister() {
      processTarget.off('SIGINT', onInterrupt);
      processTarget.off('SIGTERM', onTerminate);
    },
  };
}
