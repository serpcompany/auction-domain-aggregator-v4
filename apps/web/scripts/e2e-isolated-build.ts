import { cp, copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';

export const E2E_BUILD_ROOT_FILES = [
  'cloudflare-env.d.ts',
  'components.json',
  'next.config.ts',
  'open-next.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'postcss.config.mjs',
  'tsconfig.json',
  'wrangler.jsonc',
] as const;

const E2E_BUILD_SOURCE_DIRECTORIES = ['src', 'public'] as const;
const SOURCE_EXTENSIONS = new Set(['.css', '.svg', '.ts', '.tsx']);

function isAllowedSourceFile(path: string) {
  if (path.split('/').some((segment) => segment.startsWith('.'))) return false;
  return path.endsWith('/_headers') || SOURCE_EXTENSIONS.has(extname(path));
}

async function copySourceDirectory(
  sourceRoot: string,
  targetRoot: string,
  currentSource: string,
) {
  const entries = await readdir(currentSource, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(currentSource, entry.name);
    const relativePath = relative(sourceRoot, sourcePath);
    const targetPath = join(targetRoot, relativePath);
    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copySourceDirectory(sourceRoot, targetRoot, sourcePath);
    } else if (entry.isFile() && isAllowedSourceFile(relativePath)) {
      await mkdir(join(targetPath, '..'), { recursive: true });
      await copyFile(sourcePath, targetPath);
    } else if (entry.isSymbolicLink()) {
      throw new Error('e2e_build_source_symlink');
    }
  }
}

export async function copyE2eBuildSources(
  repositoryRoot: string,
  workspace: string,
) {
  await mkdir(workspace, { recursive: true });
  for (const file of E2E_BUILD_ROOT_FILES) {
    await copyFile(join(repositoryRoot, file), join(workspace, file));
  }
  for (const directory of E2E_BUILD_SOURCE_DIRECTORIES) {
    const source = join(repositoryRoot, directory);
    const target = join(workspace, directory);
    await mkdir(target, { recursive: true });
    await copySourceDirectory(repositoryRoot, workspace, source);
  }
}

export async function createIsolatedE2eBuildWorkspace(
  repositoryRoot: string,
  runId: string,
) {
  const workspace = await mkdtemp(join(tmpdir(), `domain-e2e-build-${runId}-`));
  try {
    await copyE2eBuildSources(repositoryRoot, workspace);
    return workspace;
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

export async function publishIsolatedE2eBuild(
  workspace: string,
  repositoryRoot: string,
) {
  const target = join(repositoryRoot, '.open-next');
  await rm(target, { recursive: true, force: true });
  await cp(join(workspace, '.open-next'), target, { recursive: true });
}
