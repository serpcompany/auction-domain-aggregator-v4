import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { countRejection, parseField } from './normalize'
import type { RejectionReasons } from './types'

function reasonFor(reject: () => unknown) {
  const reasons: RejectionReasons = {}
  try {
    reject()
  } catch (error) {
    countRejection(reasons, error)
  }
  return reasons
}

describe('rejection reasons', () => {
  it('names the schema field, or the record when the issue has no path', () => {
    const schema = z.object({ price: z.string() })
    expect(reasonFor(() => schema.parse({ price: 1 }))).toEqual({ 'price: invalid_type': 1 })
    expect(reasonFor(() => schema.parse(null))).toEqual({ 'record: invalid_type': 1 })
  })

  it('names the field parseField was given, keeping only fixed-code messages', () => {
    const fail = (thrown: unknown) => () =>
      parseField('link', () => {
        throw thrown
      })
    expect(reasonFor(fail(new Error('invalid_link')))).toEqual({ 'link: invalid_link': 1 })
    expect(reasonFor(fail(new TypeError('Invalid URL: https://x.example')))).toEqual({
      'link: invalid': 1
    })
    expect(reasonFor(fail('not an error'))).toEqual({ 'link: invalid': 1 })
  })

  it('counts any other error against the record', () => {
    const reasons: RejectionReasons = {}
    countRejection(reasons, new Error('unexpected'))
    countRejection(reasons, new Error('unexpected'))
    expect(reasons).toEqual({ 'record: invalid': 2 })
  })
})
