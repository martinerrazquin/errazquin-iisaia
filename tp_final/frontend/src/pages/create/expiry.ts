export const EXPIRY_PRESETS = [
  { label: '10 minutos', minutes: 10 },
  { label: '1 hora', minutes: 60 },
  { label: '1 día', minutes: 1440 },
  { label: '7 días', minutes: 10080 },
  { label: '15 días', minutes: 21600 },
  { label: '30 días', minutes: 43200 },
] as const

export const DEFAULT_EXPIRY_MINUTES = 60
export const CUSTOM_EXPIRY = 'custom'

/** Positive integer minutes, or null. Range limits are enforced by the backend. */
export function parseCustomMinutes(raw: string): number | null {
  const value = raw.trim()
  if (!/^\d+$/.test(value)) return null
  const minutes = Number(value)
  return minutes > 0 ? minutes : null
}
