/**
 * SERP URL trailing-slash standard, applied by the Worker entry (`worker.ts`) before OpenNext.
 *
 * A page path without its slash, or a file path with one, gets one 308 to the canonical form.
 * `/api`, `/_next`, and `/.well-known` paths are served exactly as requested. The query string
 * is kept and the `Location` is relative, so the response does not depend on the host.
 *
 * Next.js's own slash redirect is off (`skipTrailingSlashRedirect`): it has no `/api` exception,
 * and Next 16's Node `proxy.ts` cannot run under OpenNext. `next dev` therefore serves both forms.
 */
const PASS_THROUGH = /^\/(?:api|_next|\.well-known)(?:\/|$)/
const FILE_SEGMENT = /\.[a-z0-9]+$/i

export function trailingSlashRedirect(url: URL): Response | null {
  const location = canonicalPath(url)
  return location === null ? null : new Response(null, { status: 308, headers: { location } })
}

/**
 * The canonical path and query for `url`, or null when it is already canonical. The host redirect
 * (`deployment.ts`) uses it too, so a non-canonical host and slash take one hop together.
 */
export function canonicalPath(url: URL): string | null {
  const { pathname, search } = url
  if (pathname === '/' || PASS_THROUGH.test(pathname)) return null

  const slashed = pathname.endsWith('/')
  const path = slashed ? pathname.slice(0, -1) : pathname
  const lastSegment = path.slice(path.lastIndexOf('/') + 1)
  const isFile = FILE_SEGMENT.test(lastSegment)

  if (isFile && slashed) return `${pathname.slice(0, -1)}${search}`
  if (!isFile && !slashed) return `${pathname}/${search}`
  return null
}
