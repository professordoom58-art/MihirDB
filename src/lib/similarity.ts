/** Fuzzy title matching for "Find on my shelf". */

function norm(s: string) {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip accents (any combining mark)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Sørensen–Dice similarity over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const x = norm(a)
  const y = norm(b)
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return 0
  const grams = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1)
    return m
  }
  const gx = grams(x)
  const gy = grams(y)
  let inter = 0
  gx.forEach((n, g) => (inter += Math.min(n, gy.get(g) ?? 0)))
  return (2 * inter) / (x.length - 1 + (y.length - 1))
}
