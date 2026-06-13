import type { RoutingEdge } from '../../types/network'

function edgeKey(lineId: number, from: number, to: number): string {
  return `${lineId}:${from}>${to}`
}

/**
 * Der Export liefert routing_edges oft nur in Fahrtrichtung entlang der Haltefolge.
 * Fehlt die Gegenrichtung auf derselben Linie (z. B. Stralsund→Bergen), ist ein
 * Linienendpunkt nicht erreichbar — obwohl die Strecke physisch bidirektional ist.
 */
export function expandRoutingEdges(edges: RoutingEdge[]): RoutingEdge[] {
  const present = new Set(edges.map((e) => edgeKey(e.line_id, e.from, e.to)))
  const expanded: RoutingEdge[] = [...edges]

  for (const edge of edges) {
    const reverseKey = edgeKey(edge.line_id, edge.to, edge.from)
    if (present.has(reverseKey)) continue

    present.add(reverseKey)
    expanded.push({
      ...edge,
      id: `${edge.id}|rev`,
      from: edge.to,
      to: edge.from,
      from_name: edge.to_name,
      to_name: edge.from_name,
    })
  }

  return expanded
}

export function buildAdjacency(
  edges: RoutingEdge[],
): Map<number, RoutingEdge[]> {
  const adjacency = new Map<number, RoutingEdge[]>()

  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? []
    list.push(edge)
    adjacency.set(edge.from, list)
  }

  return adjacency
}

export function canReach(adjacency: Map<number, RoutingEdge[]>, fromId: number, toId: number): boolean {
  if (fromId === toId) return true

  const queue = [fromId]
  const seen = new Set<number>([fromId])

  while (queue.length > 0) {
    const node = queue.shift()!
    if (node === toId) return true

    for (const edge of adjacency.get(node) ?? []) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to)
        queue.push(edge.to)
      }
    }
  }

  return false
}

export function countIncomingEdges(edges: RoutingEdge[], stationId: number): number {
  return edges.filter((e) => e.to === stationId).length
}

export function countOutgoingEdges(edges: RoutingEdge[], stationId: number): number {
  return edges.filter((e) => e.from === stationId).length
}
