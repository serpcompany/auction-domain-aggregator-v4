import { createScheduledController, introspectWorkflowInstance } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { ingestionRuns } from '../db/schema'
import { testDatabase } from '../test-database'
import type { ProviderSyncParams, SyncWorkerEnv } from './provider-sync-workflow'
import worker from './sync-worker'

// The real `provider-sync` Workflow binding of the ingestion Worker (wrangler.ingestion.jsonc).
// No step reaches a provider: the download steps are mocked, and the rest read only D1 and R2.
const workflow = (env as unknown as SyncWorkerEnv).PROVIDER_SYNC

const summary = {
  runId: 1,
  pagesFetched: 1,
  recordsFetched: 0,
  recordsUpserted: 0,
  recordsInactivated: 0,
  recordsRejected: 0
}

describe('ingestion Worker', () => {
  it('runs the steps through Workflows, sleeping as long as the provider asked', async () => {
    await using instance = await introspectWorkflowInstance(workflow, 'godaddy-mocked')
    await instance.modify(async m => {
      await m.disableSleeps()
      await m.mockStepResult({ name: 'stage feed' }, { pages: 1 })
      await m.mockStepResult({ name: 'start run' }, 1)
      await m.mockStepResult(
        { name: 'sync pages, segment 1' },
        { done: false, runId: 1, wait: { code: 'godaddy_rate_limited', milliseconds: 1_000 } }
      )
      await m.mockStepResult({ name: 'sync pages, segment 1, retry 1' }, { done: true, summary })
      await m.mockStepResult({ name: 'delete staged pages' }, { deleted: 1 })
    })
    await workflow.create({ id: 'godaddy-mocked', params: { provider: 'godaddy' } })
    await instance.waitForStatus('complete')
    expect(await instance.getOutput()).toEqual(summary)
  })

  it('ends the instance without retries on a final sync error', async () => {
    await using instance = await introspectWorkflowInstance(workflow, 'godaddy-unstaged')
    // Nothing is staged, so the first page is missing: a final verdict, not a retry.
    await instance.modify(async m => {
      await m.mockStepResult({ name: 'stage feed' }, { pages: 0 })
    })
    await workflow.create({ id: 'godaddy-unstaged', params: { provider: 'godaddy' } })
    await instance.waitForStatus('errored')
    expect((await instance.getError()).message).toBe('godaddy_missing_page')
    const [run] = await testDatabase()
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.provider, 'godaddy'))
    expect(run).toMatchObject({ status: 'failed', errorCode: 'godaddy_missing_page' })
  })

  it('refuses an instance without a provider', async () => {
    await using instance = await introspectWorkflowInstance(workflow, 'no-provider')
    await workflow.create({ id: 'no-provider' })
    await instance.waitForStatus('errored')
    expect((await instance.getError()).message).toBe('sync_unknown_provider')
  })

  it('starts one instance per provider for a Cron Trigger firing', async () => {
    const create = vi.fn(async () => ({}) as WorkflowInstance)
    await worker.scheduled(
      createScheduledController({ scheduledTime: new Date('2026-07-13T15:30:00.000Z') }),
      { PROVIDER_SYNC: { create } as unknown as Workflow<ProviderSyncParams> } as SyncWorkerEnv
    )
    expect(create.mock.calls.map(([options]) => options)).toEqual([
      { id: 'dynadot-20260713T1530', params: { provider: 'dynadot' } },
      { id: 'godaddy-20260713T1530', params: { provider: 'godaddy' } },
      { id: 'namecheap-20260713T1530', params: { provider: 'namecheap' } }
    ])
  })
})
