import { Activity, Gauge, Map, Train, Users } from 'lucide-react'
import type { NetworkExport } from '../types/network'
import type { ScaleSettings } from '../lib/scale'
import { formatTimestamp } from '../lib/format'
import { NetworkReloadPanel } from './NetworkReloadPanel'

interface NetworkOverviewProps {
  network: NetworkExport
  scale: ScaleSettings
  onReload: () => void
  onImportFile?: (file: File) => void | Promise<void>
  importing?: boolean
  reloading: boolean
  reloadSuccess?: boolean
  sourceLabel?: string
}

export function NetworkOverview({
  network,
  scale,
  onReload,
  onImportFile,
  importing = false,
  reloading,
  reloadSuccess = false,
  sourceLabel,
}: NetworkOverviewProps) {
  const stats = [
    {
      icon: Map,
      label: 'Stationen',
      value: network.counts.station_groups ?? network.station_groups.length,
    },
    {
      icon: Train,
      label: 'Linien',
      value: network.counts.lines ?? network.lines.length,
    },
    {
      icon: Activity,
      label: 'Segmente',
      value: network.counts.segments ?? network.segments.length,
    },
    {
      icon: Users,
      label: 'Umsteigepunkte',
      value: network.transfers.length,
    },
  ]

  return (
    <aside className="network-overview">
      <h2 className="network-overview__title">Dein Netz</h2>

      <NetworkReloadPanel
        onReload={onReload}
        onImportFile={onImportFile}
        importing={importing}
        reloading={reloading}
        showSuccess={reloadSuccess}
        sourceLabel={sourceLabel}
      />

      <div className="network-overview__scale">
        <Gauge size={16} />
        <div>
          <strong>Realzeit-Faktor</strong>
          <span>
            Strecke ×{scale.distanceMultiplier} · Zeit ×{scale.timeMultiplier}
          </span>
        </div>
      </div>

      <div className="network-overview__grid">
        {stats.map((stat) => (
          <div key={stat.label} className="network-overview__stat">
            <stat.icon size={18} />
            <div>
              <span className="network-overview__value">{stat.value}</span>
              <span className="network-overview__label">{stat.label}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="network-overview__lines">
        <h3>Linien im Netz</h3>
        <ul>
          {network.lines.map((line) => (
            <li key={line.id}>
              <span
                className="line-dot line-dot--lg"
                style={{ backgroundColor: line.display_color?.hex ?? '#3B82F6' }}
              />
              <span>{line.name}</span>
              <span className="network-overview__stops">
                {line.stops?.length ?? line.stop_names_preview?.length ?? 0} Halte
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="network-overview__meta">
        Export: {formatTimestamp(network.generated_at_unix)}
        <br />
        {network.generated_by}
      </p>
    </aside>
  )
}
