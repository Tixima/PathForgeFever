/**
 * Schnelltest für Linienform-Erkennung (Schema v22 Muster).
 * Ausführen: node scripts/test-line-topology.mjs
 */

function isReverseReturn(outCore, inCore) {
  if (inCore.length < 2) return false
  const reversed = [...outCore].reverse()
  let matched = 0, j = 0
  for (let i = 0; i < reversed.length && j < inCore.length; i++) {
    if (reversed[i] === inCore[j]) { matched++; j++ }
  }
  return matched >= Math.max(2, Math.floor(inCore.length * 0.7))
}

function detectPingPongPivot(stopIds) {
  for (let pivot = stopIds.length - 1; pivot >= 1; pivot--) {
    const outbound = stopIds.slice(0, pivot + 1)
    const inbound = stopIds.slice(pivot)
    if (inbound[0] !== outbound[outbound.length - 1]) continue
    const outCore = outbound.slice(0, -1)
    const inCore = inbound.slice(1)
    if (isReverseReturn(outCore, inCore)) return pivot
  }
  return null
}

function classify(names) {
  const stopIds = names.map((_, i) => i)
  const stopCount = stopIds.length
  if (stopIds[0] === stopIds[stopCount - 1]) {
    const body = stopIds.slice(0, -1)
    if (new Set(body).size === body.length) return 'ring'
    const pivot = detectPingPongPivot(stopIds)
    if (pivot != null) {
      const outCore = stopIds.slice(0, pivot)
      const inCore = stopIds.slice(pivot + 1, -1)
      return inCore.length / outCore.length >= 0.85 ? 'pingpong' : 'partial_return'
    }
  }
  if (detectPingPongPivot(stopIds) != null) return 'pingpong'
  return 'linear'
}

const cases = [
  { names: ['A', 'B', 'C', 'D', 'A'], expect: 'ring' },
  { names: ['A', 'B', 'C', 'D', 'C', 'B', 'A'], expect: 'pingpong' },
  { names: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'C', 'B', 'A'], expect: 'partial_return' },
  { names: ['A', 'B', 'C', 'D', 'C', 'B'], expect: 'pingpong' },
]

let ok = 0
for (const c of cases) {
  const got = classify(c.names)
  const pass = got === c.expect
  if (pass) ok++
  console.log(pass ? '✓' : '✗', c.names.join(';'), '→', got, `(expected ${c.expect})`)
}
console.log(ok, '/', cases.length, 'passed')
process.exit(ok === cases.length ? 0 : 1)
