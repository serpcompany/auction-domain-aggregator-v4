import { createScheduledController, introspectWorkflowInstance } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { ingestionRuns } from '../db/schema'
import type { DomainRatingBackfillParams } from '../enrichment/domain-rating-backfill'
import { testDatabase } from '../test-database'
import { listing, STARTED_AT } from '../test-listings'
import { createD1IngestionStorage } from './d1-storage'
import type { ProviderSyncParams, SyncWorkerEnv } from './provider-sync-workflow'
import worker, { DomainRatingWorkflow } from './sync-worker'

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

  it('starts one instance per provider and the DR backfill for a Cron Trigger firing', async () => {
    const create = vi.fn(
      async (_options: WorkflowInstanceCreateOptions<ProviderSyncParams>) =>
        ({}) as WorkflowInstance
    )
    const createBackfill = vi.fn(
      async (_options: WorkflowInstanceCreateOptions<DomainRatingBackfillParams>) =>
        ({}) as WorkflowInstance
    )
    await worker.scheduled(
      createScheduledController({ scheduledTime: new Date('2026-07-13T15:30:00.000Z') }),
      scheduledEnv(create, createBackfill)
    )
    expect(create.mock.calls.map(([options]) => options)).toEqual([
      { id: 'dynadot-20260713T1530', params: { provider: 'dynadot' } },
      { id: 'godaddy-20260713T1530', params: { provider: 'godaddy' } },
      { id: 'namecheap-20260713T1530', params: { provider: 'namecheap' } },
      { id: 'namesilo-20260713T1530', params: { provider: 'namesilo' } }
    ])
    expect(createBackfill.mock.calls.map(([options]) => options)).toEqual([
      { id: 'domain-rating-20260713T1530', params: { startDelayMs: 3_600_000 } }
    ])
  })

  it('schedules the syncs and the backfill independently', async () => {
    const started = vi.fn(async () => ({}) as WorkflowInstance)
    const refused = vi.fn(async () => {
      throw new Error('instance_exists')
    })
    const controller = createScheduledController({ scheduledTime: Date.now() })

    await expect(worker.scheduled(controller, scheduledEnv(started, refused))).rejects.toThrow(
      'domain_rating_schedule_failed'
    )
    expect(started).toHaveBeenCalledTimes(4)

    const backfill = vi.fn(async () => ({}) as WorkflowInstance)
    await expect(worker.scheduled(controller, scheduledEnv(refused, backfill))).rejects.toThrow(
      'sync_schedule_failed'
    )
    expect(backfill).toHaveBeenCalledTimes(1)
  })
})

function scheduledEnv(
  create: (options: never) => Promise<WorkflowInstance>,
  createBackfill: (options: never) => Promise<WorkflowInstance>
) {
  return {
    PROVIDER_SYNC: { create } as unknown as Workflow<ProviderSyncParams>,
    DOMAIN_RATING: { create: createBackfill } as unknown as Workflow<DomainRatingBackfillParams>
  } as SyncWorkerEnv
}

// The Workflow class with a fake step runner, so the tests decide the key and Ahrefs' answer
// whatever `.dev.vars` holds.
describe('Domain Rating backfill Workflow', () => {
  const sleeps: Array<[string, number]> = []
  const step = {
    do: (_name: string, _config: unknown, callback: () => Promise<unknown>) => callback(),
    sleep: async (name: string, milliseconds: number) => {
      sleeps.push([name, milliseconds])
    }
  }
  // Workerd will not construct an entrypoint in a test, and `run` reads only `this.env`.
  const backfill = (apiKey: string | undefined) => ({
    run: (workflowEvent: never, runner: never) =>
      DomainRatingWorkflow.prototype.run.call(
        { env: { ...(env as unknown as SyncWorkerEnv), AHREFS_API_KEY: apiKey } } as never,
        workflowEvent,
        runner
      )
  })
  // Open at the real current time, which the Workflow reads.
  const tomorrow = () => new Date(Date.now() + 86_400_000)
  const event = (payload?: DomainRatingBackfillParams) =>
    ({ payload, instanceId: 'domain-rating-test', timestamp: new Date() }) as never

  it('ends the run without retries when Ahrefs rejects the key', async () => {
    const storage = createD1IngestionStorage(testDatabase(), 'dynadot')
    await storage.upsertListings(await storage.startRun(STARTED_AT), [
      { ...listing('dr-rejected', 'dr-rejected.integration.test', 100), endsAt: tomorrow() }
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 }))
    )
    try {
      await expect(backfill('rejected-key').run(event(), step as never)).rejects.toThrow(
        'ahrefs_unauthorized'
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('fails at once without an Ahrefs key', async () => {
    await expect(backfill(undefined).run(event(), step as never)).rejects.toThrow(
      'ahrefs_missing_credentials'
    )
  })

  it('rates the open listings with the stored key', async () => {
    sleeps.length = 0
    const storage = createD1IngestionStorage(testDatabase(), 'dynadot')
    await storage.upsertListings(await storage.startRun(STARTED_AT), [
      { ...listing('dr-backfill', 'dr-backfill.integration.test', 100), endsAt: tomorrow() }
    ])
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-key')
      return Response.json({
        domain_rating: {
          targets: [{ target: 'dr-backfill.integration.test', domain_rating: 33 }]
        }
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const summary = await backfill('test-key').run(event({ startDelayMs: 5 }), step as never)
      expect(summary).toEqual({
        status: 'succeeded',
        calls: 1,
        requested: 1,
        stored: 1,
        complete: true
      })
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleeps[0]).toEqual(['wait for the provider syncs', 5])
  })
})
