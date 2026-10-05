import { BUNDLED_ENV_MODULE, findBundledEnvNames } from './bundled-env';

async function main() {
  const names = await findBundledEnvNames(BUNDLED_ENV_MODULE);
  if (names.length === 0) return;
  // Print variable names only, never values.
  process.stderr.write(
    `Refusing to continue: the Worker bundle contains non-public env variables (${names.join(', ')}). ` +
      'Move credentials out of .env* files (see providers.env.example) and rebuild.\n',
  );
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `bundled_env_check_failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
});
