import { sql } from 'drizzle-orm'

import { getDb } from '@/server/db/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const db = getDb()
    await db.run(sql`SELECT 1`)

    return Response.json({ status: 'ok', database: 'ok' })
  } catch {
    return Response.json({ status: 'unhealthy', database: 'unavailable' }, { status: 503 })
  }
}
