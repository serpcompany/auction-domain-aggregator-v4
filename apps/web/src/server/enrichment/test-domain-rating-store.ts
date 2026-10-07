import type { AhrefsRequestRecord, DomainRatingResult, DomainRatingStore } from './domain-rating'

type Row = Omit<DomainRatingResult, 'domainName' | 'status'> & {
  status: DomainRatingResult['status'] | 'pending'
}

// An in-memory DomainRatingStore with the D1 store's rules, for unit tests.
// The integration proof checks the same rules against D1.
export function createMemoryDomainRatingStore(activeDomains: string[]) {
  const active = new Set(activeDomains)
  const rows = new Map<string, Row>()
  const requests: AhrefsRequestRecord[] = []

  const store: DomainRatingStore = {
    async coolDownUntil(now) {
      const times = requests
        .map(request => request.coolDownUntil?.getTime() ?? 0)
        .filter(time => time > now.getTime())
      return times.length === 0 ? null : new Date(Math.max(...times))
    },

    async claim(domains, now, until) {
      return [...new Set(domains)].filter(domainName => {
        if (!active.has(domainName)) return false
        const row = rows.get(domainName)
        if (
          row &&
          !(
            (row.status === 'omitted' || row.status === 'pending') &&
            (row.retryAfter?.getTime() ?? 0) <= now.getTime()
          )
        ) {
          return false
        }
        rows.set(domainName, { status: 'pending', value: null, retryAfter: until })
        return true
      })
    },

    async release(domains, until) {
      for (const domainName of domains) {
        const row = rows.get(domainName)
        if (row?.status === 'pending' && row.retryAfter?.getTime() === until.getTime()) {
          rows.delete(domainName)
        }
      }
    },

    async record(request, results) {
      requests.push(request)
      let stored = 0
      for (const { domainName, ...result } of results) {
        const row = rows.get(domainName)
        if (row && row.status !== 'omitted' && row.status !== 'pending') continue
        rows.set(domainName, result)
        stored += 1
      }
      return stored
    }
  }
  return { store, rows, requests }
}
