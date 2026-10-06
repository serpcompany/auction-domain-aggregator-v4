// Ingestion Worker entry (`wrangler.ingestion.jsonc`). Kept thin: the
// runtime-only Workflow class and Cron Trigger handler delegate to
// `provider-sync-workflow.ts`, which is unit-tested without the runtime.
// The Worker has no fetch handler, so it serves no HTTP routes.
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

import {
  runProviderSync,
  scheduleProviderSyncs,
  type ProviderSyncParams,
  type StepRunner,
  type SyncWorkerEnv,
} from './provider-sync-workflow';

export class ProviderSyncWorkflow extends WorkflowEntrypoint<
  SyncWorkerEnv,
  ProviderSyncParams
> {
  async run(
    event: Readonly<WorkflowEvent<ProviderSyncParams>>,
    step: WorkflowStep,
  ) {
    // Step results here are plain JSON objects, which Workflows persists.
    const runner: StepRunner = {
      do: (name, config, callback) =>
        step.do(name, config as never, callback as never) as Promise<never>,
    };
    return runProviderSync({
      provider: String(event.payload?.provider ?? ''),
      runKey: event.instanceId,
      env: this.env,
      step: runner,
      nonRetryable: (code) => new NonRetryableError(code),
    });
  }
}

const worker = {
  // The daily Cron Trigger starts one Workflow instance per provider.
  async scheduled(controller: ScheduledController, env: SyncWorkerEnv) {
    await scheduleProviderSyncs(
      env.PROVIDER_SYNC,
      new Date(controller.scheduledTime),
    );
  },
} satisfies ExportedHandler<SyncWorkerEnv>;

export default worker;
