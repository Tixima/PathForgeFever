import type { NetworkExport } from '../../types/network'
import {
  buildAdjacency,
  canReach,
  countIncomingEdges,
  countOutgoingEdges,
  expandRoutingEdges,
} from './expandRoutingEdges'

export function buildRouteSearchError(
  network: NetworkExport,
  fromId: number,
  toId: number,
  viaNames: string[] = [],
  options: { accessible?: boolean; accessibleStrict?: boolean } = {},
): string {
  const from = network.routing_nodes.find((n) => n.id === fromId)
  const to = network.routing_nodes.find((n) => n.id === toId)
  const viaLabel = viaNames.length ? ` über ${viaNames.join(' → ')}` : ''

  if (!from || !to) {
    return `Start oder Ziel existiert nicht im geladenen Netzwerk.`
  }

  const edges = expandRoutingEdges(network.routing_edges)
  const adjacency = buildAdjacency(edges)

  if (canReach(adjacency, fromId, toId)) {
    if (options.accessibleStrict) {
      return (
        `Keine gleiswechselfreie Verbindung zwischen „${from.name}" und „${to.name}"${viaLabel} — ` +
        `weder über Umwege noch mit Sitzenbleiben.`
      )
    }
    if (options.accessible) {
      return (
        `Keine barrierefreie Verbindung zwischen „${from.name}" und „${to.name}"${viaLabel} gefunden.`
      )
    }
    return `Keine Route gefunden — bitte erneut suchen.`
  }

  const incomingTo = countIncomingEdges(edges, toId)
  const outgoingTo = countOutgoingEdges(edges, toId)

  if (incomingTo === 0 && outgoingTo > 0) {
    return (
      `„${to.name}" ist im Export nur als Linienstart erfasst (Abfahrt möglich, Ankunft nicht). ` +
      `Prüfe im Spiel, ob die Linie dorthin zurückfährt, und lade den Export neu.`
    )
  }

  if (outgoingTo === 0 && incomingTo > 0) {
    return (
      `„${to.name}" ist im Export nur als Linienende erfasst — Ankunft ohne Weiterfahrt.`
    )
  }

  if (!canReach(adjacency, fromId, toId)) {
    const fromReachable = network.routing_nodes.filter(
      (n) => n.id !== fromId && canReach(adjacency, fromId, n.id),
    ).length

    if (fromReachable === 0) {
      return `Von „${from.name}" führt keine Strecke ins Netz — Station evtl. isoliert.`
    }

    return (
      `Zwischen „${from.name}" und „${to.name}"${viaLabel} gibt es im aktuellen Netz keine Verbindung ` +
      `(mit Umstieg). Die Stationen liegen in getrennten Netzteilen oder der Export ist unvollständig.`
    )
  }

  return `Zwischen „${from.name}" und „${to.name}"${viaLabel} wurde keine Route berechnet.`
}
