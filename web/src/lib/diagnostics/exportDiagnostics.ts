import type { NetworkExport, QualityReportEntry } from '../../types/network'

export type DiagnosticSeverity = 'ok' | 'info' | 'warn' | 'error' | 'unknown'

export interface DiagnosticLogEntry {
  level: string
  message: string
  category: string
}

export interface CapabilityCard {
  key: string
  label: string
  available: boolean
  detail?: string
}

export interface ExperimentalFeatureCard {
  id: string
  label: string
  enabled: boolean
  origin: string
  note?: string
  provides: string[]
  missing: string[]
}

export interface ExportDiagnosticsIndex {
  generatedAt: Date
  generatedBy: string
  schemaVersion: string
  healthScore: number
  healthLabel: string
  counts: Record<string, number>
  qualityReport: QualityReportEntry[]
  qualityByLevel: Record<string, number>
  capabilities: CapabilityCard[]
  experimentalWarning: string | null
  experimentalFeatures: ExperimentalFeatureCard[]
  timeEstimation: {
    nativeTimesAvailable: boolean
    formula: string | null
    note: string | null
    speeds: Array<{ mode: string; kmh: number }>
    penalties: Array<{ label: string; seconds: number }>
  }
  networkStats: {
    stationCount: number
    lineCount: number
    hubCount: number
    transferCount: number
    endpointCount: number
    topHubs: Array<{ name: string; degree: number; lineCount: number }>
    endpoints: Array<{ name: string; degree: number }>
  } | null
  terminalScan: {
    appliedToStops: number
    lineStopHits: number
    entryCount: number
    origin: string
  } | null
  dataOriginLegend: Array<{ key: string; description: string }>
  diagnosticsLog: DiagnosticLogEntry[]
  logLevelCounts: Record<string, number>
  insights: string[]
}

const CAPABILITY_LABELS: Record<string, string> = {
  backend_ready: 'Backend-ready Export',
  computed_routing_graph: 'Routing-Graph (berechnet)',
  native_terminal_scan: 'Native Terminal-Scan',
  native_terminal_track_data: 'Native Gleis-Daten',
  virtual_platform_assignments: 'Virtuelle Gleis-Zuweisung',
  computed_segments: 'Berechnete Segmente v3',
  native_segment_travel_times: 'Native Fahrzeiten',
  live_vehicle_positions: 'Live-Fahrzeugpositionen',
  live_delays: 'Live-Verspätungen',
  geojson_export: 'GeoJSON-Export',
  render_package: 'Render-Paket',
  computed_network_map_metadata: 'Karten-Metadaten',
  best_effort_vehicle_scan: 'Fahrzeug-Scan (Best Effort)',
  station_positions: 'Stationen-Positionen',
  topology: 'Topologie',
}

function categorizeMessage(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('terminal') || m.includes('gleis') || m.includes('platform')) return 'Gleise'
  if (m.includes('line') || m.includes('linie')) return 'Linien'
  if (m.includes('native') || m.includes('api')) return 'TF2-API'
  if (m.includes('vehicle') || m.includes('fahrzeug')) return 'Fahrzeuge'
  if (m.includes('export') || m.includes('scan')) return 'Export'
  if (m.includes('routing') || m.includes('segment')) return 'Routing'
  return 'Allgemein'
}

function formatFeatureLabel(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/\bv(\d+)\b/gi, 'v$1')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function computeHealthScore(
  quality: QualityReportEntry[],
  capabilities: CapabilityCard[],
  nativeTimes: boolean,
): number {
  let score = 72
  for (const q of quality) {
    if (q.level === 'ok') score += 2
    if (q.level === 'warn' || q.level === 'warning') score -= 4
    if (q.level === 'error') score -= 10
  }
  const availableRatio =
    capabilities.length > 0
      ? capabilities.filter((c) => c.available).length / capabilities.length
      : 0.5
  score += Math.round(availableRatio * 18)
  if (nativeTimes) score += 8
  return Math.max(0, Math.min(100, score))
}

function healthLabel(score: number): string {
  if (score >= 90) return 'Exzellent'
  if (score >= 75) return 'Gut'
  if (score >= 60) return 'Solide'
  return 'Experimentell'
}

export function buildExportDiagnostics(network: NetworkExport): ExportDiagnosticsIndex {
  const raw = network as NetworkExport & Record<string, unknown>
  const qualityReport = network.quality_report ?? []
  const qualityByLevel: Record<string, number> = {}
  for (const q of qualityReport) {
    qualityByLevel[q.level] = (qualityByLevel[q.level] ?? 0) + 1
  }

  const capabilitiesRaw = raw.export_capabilities as Record<string, boolean> | undefined
  const capabilities: CapabilityCard[] = Object.entries(capabilitiesRaw ?? {})
    .map(([key, available]) => ({
      key,
      label: CAPABILITY_LABELS[key] ?? key.replace(/_/g, ' '),
      available: Boolean(available),
    }))
    .sort((a, b) => Number(b.available) - Number(a.available) || a.label.localeCompare(b.label, 'de'))

  const experimental = raw.experimental as
    | {
        warning?: string
        features?: Record<
          string,
          {
            enabled?: boolean
            origin?: string
            note?: string
            provides?: string[]
            does_not_provide?: string[]
          }
        >
      }
    | undefined

  const experimentalFeatures: ExperimentalFeatureCard[] = Object.entries(
    experimental?.features ?? {},
  ).map(([id, feat]) => ({
    id,
    label: formatFeatureLabel(id),
    enabled: feat.enabled !== false,
    origin: feat.origin ?? 'unknown',
    note: feat.note,
    provides: feat.provides ?? [],
    missing: feat.does_not_provide ?? [],
  }))

  const timeRaw = raw.time_estimation as
    | {
        native_tf2_segment_times_available?: boolean
        formula?: string
        _origin?: { note?: string }
        speed_profile?: Record<string, unknown>
      }
    | undefined

  const speedProfile = timeRaw?.speed_profile ?? {}
  const speeds = ['rail', 'road', 'tram', 'ship', 'aircraft', 'default']
    .map((mode) => ({
      mode,
      kmh: Number(speedProfile[`${mode}_kmh`] ?? speedProfile.default_kmh ?? 0),
    }))
    .filter((s) => s.kmh > 0)

  const penalties = [
    { label: 'Umstieg', seconds: Number(speedProfile.transfer_penalty_seconds ?? 0) },
    {
      label: 'Terminal-Wechsel',
      seconds: Number(speedProfile.terminal_transfer_penalty_seconds ?? 0),
    },
    {
      label: 'Haltestellen-Aufenthalt',
      seconds: Number(speedProfile.dwell_seconds_per_intermediate_stop ?? 0),
    },
  ].filter((p) => p.seconds > 0)

  const statsRaw = raw.network_statistics as
    | {
        station_count?: number
        line_count?: number
        hub_count?: number
        transfer_count?: number
        endpoint_count?: number
        top_hubs?: Array<{
          name: string
          degree: number
          served_by_line_count?: number
        }>
        endpoints?: Array<{ name: string; degree: number }>
      }
    | undefined

  const terminalRaw = raw.native_terminal_scan as
    | {
        applied_to_stops?: number
        line_stop_hits?: number
        entries?: unknown[]
        origin?: string
      }
    | undefined

  const legendRaw = raw.data_origin_legend as Record<string, string> | undefined
  const dataOriginLegend = Object.entries(legendRaw ?? {}).map(([key, description]) => ({
    key,
    description,
  }))

  const diagnosticsLog: DiagnosticLogEntry[] = (network.diagnostics ?? []).map((d) => ({
    level: d.level,
    message: d.message,
    category: categorizeMessage(d.message),
  }))

  const logLevelCounts: Record<string, number> = {}
  for (const d of diagnosticsLog) {
    logLevelCounts[d.level] = (logLevelCounts[d.level] ?? 0) + 1
  }

  const nativeTimes = Boolean(timeRaw?.native_tf2_segment_times_available)
  const healthScore = computeHealthScore(qualityReport, capabilities, nativeTimes)

  const insights: string[] = []
  if (!nativeTimes) {
    insights.push(
      'Fahrzeiten stammen aus Schätzungen (Distanz × Profil) — kein natives TF2-Fahrplan-Backend.',
    )
  }
  if ((network.counts?.vehicles ?? 0) === 0) {
    insights.push('Fahrzeug-Scan lieferte 0 Fahrzeuge — Linien könnten ohne aktive Flotte exportiert sein.')
  }
  if (terminalRaw?.applied_to_stops) {
    insights.push(
      `Terminal-Scan deckte ${terminalRaw.applied_to_stops} Haltestellen ab — Gleis-Anzeigen nutzen echte TF2-Terminals wo möglich.`,
    )
  }
  if (experimental?.warning) {
    insights.push(experimental.warning)
  }

  return {
    generatedAt: new Date(network.generated_at_unix * 1000),
    generatedBy: network.generated_by,
    schemaVersion: network.schema_version,
    healthScore,
    healthLabel: healthLabel(healthScore),
    counts: network.counts ?? {},
    qualityReport,
    qualityByLevel,
    capabilities,
    experimentalWarning: experimental?.warning ?? null,
    experimentalFeatures,
    timeEstimation: {
      nativeTimesAvailable: nativeTimes,
      formula: timeRaw?.formula ?? null,
      note: timeRaw?._origin?.note ?? null,
      speeds,
      penalties,
    },
    networkStats: statsRaw
      ? {
          stationCount: statsRaw.station_count ?? network.routing_nodes.length,
          lineCount: statsRaw.line_count ?? network.lines.length,
          hubCount: statsRaw.hub_count ?? 0,
          transferCount: statsRaw.transfer_count ?? network.transfers.length,
          endpointCount: statsRaw.endpoint_count ?? 0,
          topHubs: (statsRaw.top_hubs ?? []).slice(0, 8).map((h) => ({
            name: h.name,
            degree: h.degree,
            lineCount: h.served_by_line_count ?? 0,
          })),
          endpoints: (statsRaw.endpoints ?? []).slice(0, 6).map((e) => ({
            name: e.name,
            degree: e.degree,
          })),
        }
      : null,
    terminalScan: terminalRaw
      ? {
          appliedToStops: terminalRaw.applied_to_stops ?? 0,
          lineStopHits: terminalRaw.line_stop_hits ?? 0,
          entryCount: terminalRaw.entries?.length ?? 0,
          origin: terminalRaw.origin ?? 'unknown',
        }
      : null,
    dataOriginLegend,
    diagnosticsLog,
    logLevelCounts,
    insights,
  }
}

export function severityClass(level: string): DiagnosticSeverity {
  switch (level.toLowerCase()) {
    case 'ok':
    case 'success':
      return 'ok'
    case 'warn':
    case 'warning':
      return 'warn'
    case 'error':
    case 'critical':
      return 'error'
    case 'info':
      return 'info'
    default:
      return 'unknown'
  }
}
