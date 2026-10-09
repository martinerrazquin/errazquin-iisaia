import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPIRY_MINUTES, EXPIRY_PRESETS, parseCustomMinutes } from './expiry'

describe('expiry presets', () => {
  it('matches the spec presets', () => {
    expect(EXPIRY_PRESETS.map((p) => [p.label, p.minutes])).toEqual([
      ['10 minutos', 10],
      ['1 hora', 60],
      ['1 día', 1440],
      ['7 días', 10080],
      ['15 días', 21600],
      ['30 días', 43200],
    ])
    expect(DEFAULT_EXPIRY_MINUTES).toBe(60)
  })

  it.each([
    ['90', 90],
    [' 15 ', 15],
    ['0', null],
    ['-5', null],
    ['1.5', null],
    ['abc', null],
    ['', null],
  ])('parses custom minutes %j', (raw, expected) => {
    expect(parseCustomMinutes(raw)).toBe(expected)
  })
})
