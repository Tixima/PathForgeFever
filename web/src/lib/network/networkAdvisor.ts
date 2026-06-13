import type { NetworkExport } from '../../types/network'

export type AdvisorSeverity = 'critical' | 'warning' | 'info' | 'success'

export interface AdvisorFinding {
  id: string
  severity: AdvisorSeverity
  title: string
  detail: string
  action?: string
  stationId?: number
  lineId?: number
}

export function buildNetworkAdvisorFindings(network: NetworkExport): AdvisorFinding[] {
  const findings: AdvisorFinding[] = []

  const connected = new Set<number>()
  for (const edge of network.routing_edges) {
    connected.add(edge.from)
    connected.add(edge.to)
  }

  for (const node of network.routing_nodes) {
    if (!connected.has(node.id)) {
      findings.push({
        id: `isolated-${node.id}`,
        severity: 'critical',
        title: `Isolierte Station: ${node.name}`,
        detail: 'Keine Routing-Kante — von/nach hier ist keine Verbindung möglich.',
        action: 'Linie verlängern oder neue Verbindung bauen',
        stationId: node.id,
      })
    } else if (node.degree === 1) {
      findings.push({
        id: `dead-end-${node.id}`,
        severity: 'warning',
        title: `Sackgasse: ${node.name}`,
        detail: 'Nur eine Verbindung — Endpunkt ohne Umsteigemöglichkeit.',
        action: 'Weitere Linie anbinden oder Hub schaffen',
        stationId: node.id,
      })
    }
  }

  for (const line of network.lines) {
    const edgeCount = network.routing_edges.filter((e) => e.line_id === line.id).length
    if (edgeCount === 0) {
      findings.push({
        id: `no-edges-${line.id}`,
        severity: 'critical',
        title: `${line.name} ohne Routing`,
        detail: 'Die Linie hat Haltestellen, aber keine berechneten Fahrkanten.',
        action: 'Export neu generieren oder Linienstrecke prüfen',
        lineId: line.id,
      })
    }

    const summary = network.line_summaries.find((s) => s.line_id === line.id) as
      | { vehicle_count_best_effort?: number }
      | undefined
    if (summary?.vehicle_count_best_effort === 0) {
      findings.push({
        id: `no-vehicles-${line.id}`,
        severity: 'warning',
        title: `${line.name}: Keine Fahrzeuge`,
        detail: 'Vehicle-Scan lieferte 0 Fahrzeuge — Linie fährt evtl. nicht oder Scan fehlgeschlagen.',
        action: 'Fahrzeuge der Linie zuweisen und Export erneuern',
        lineId: line.id,
      })
    }
  }

  const lowDegreeHubs = network.routing_nodes.filter((n) => n.interchange && n.degree < 3)
  for (const hub of lowDegreeHubs) {
    findings.push({
      id: `weak-hub-${hub.id}`,
      severity: 'info',
      title: `Schwacher Hub: ${hub.name}`,
      detail: `Nur ${hub.degree} Verbindungen trotz Umsteige-Flag — Potenzial für mehr Linien.`,
      action: 'Weitere Linien durchführen lassen',
      stationId: hub.id,
    })
  }

  const segmentCounts = new Map<number, number>()
  for (const seg of network.segments) {
    segmentCounts.set(seg.line_id, (segmentCounts.get(seg.line_id) ?? 0) + 1)
  }
  for (const line of network.lines) {
    const stops = line.stops?.length ?? 0
    const segs = segmentCounts.get(line.id) ?? 0
    if (stops > 2 && segs === 0) {
      findings.push({
        id: `no-segments-${line.id}`,
        severity: 'warning',
        title: `${line.name}: Keine Segmente`,
        detail: `${stops} Haltestellen, aber 0 berechnete Teilstrecken.`,
        lineId: line.id,
      })
    }
  }

  for (const entry of network.quality_report ?? []) {
    if (entry.level === 'error' || entry.level === 'warn') {
      findings.push({
        id: `quality-${entry.code}`,
        severity: entry.level === 'error' ? 'critical' : 'warning',
        title: entry.code,
        detail: entry.message,
      })
    }
  }

  if (findings.length === 0) {
    findings.push({
      id: 'all-good',
      severity: 'success',
      title: 'Netz sieht gesund aus',
      detail: 'Keine kritischen Schwachstellen erkannt — Routing, Segmente und Verbindungen sind konsistent.',
    })
  }

  const order: Record<AdvisorSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
    success: 3,
  }

  return findings.sort((a, b) => order[a.severity] - order[b.severity])
}
