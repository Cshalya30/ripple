// Pure helpers for the Risk and Finance screens (no React, so they are unit-tested).

/** 1, 2 or 5 times a power of ten, so the axis reads ₹50k, ₹1L, ₹1.5L rather than ₹62.5k. */
export function niceStep(raw: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))))
  const unit = raw / power
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power
}

export function parseYield(text: string): { ok: true; bp: number } | { ok: false; error: string } {
  const cleaned = text.trim().replace('%', '')
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(cleaned)) return { ok: false, error: 'Use a percentage like 6.5.' }
  const value = Number(cleaned)
  if (value > 30) return { ok: false, error: 'A yearly return above 30% is not realistic; use 30 or less.' }
  return { ok: true, bp: Math.round(value * 100) }
}

