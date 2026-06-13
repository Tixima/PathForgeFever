import { useMemo, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { GitCompare, Trophy } from 'lucide-react'
import type { NetworkExport } from '../../types/network'
import { buildLineExplorerDetails } from '../../lib/lines/lineExplorer'
import { buildLineSpeedProfile, compareLines } from '../../lib/lines/lineCompare'

interface LineCompareViewProps {
  network: NetworkExport
  lineAId: number
  lineBId: number
  onLineAChange: (id: number) => void
  onLineBChange: (id: number) => void
}

export function LineCompareView({
  network,
  lineAId,
  lineBId,
  onLineAChange,
  onLineBChange,
}: LineCompareViewProps) {
  const lines = useMemo(() => buildLineExplorerDetails(network), [network])
  const lineA = lines.find((l) => l.id === lineAId) ?? lines[0]
  const lineB = lines.find((l) => l.id === lineBId) ?? lines[1]

  const metrics = useMemo(() => {
    if (!lineA || !lineB) return []
    return compareLines(lineA, lineB)
  }, [lineA, lineB])

  const speedA = useMemo(
    () => buildLineSpeedProfile(network.segments as Parameters<typeof buildLineSpeedProfile>[0], lineA?.id ?? 0),
    [network.segments, lineA],
  )
  const speedB = useMemo(
    () => buildLineSpeedProfile(network.segments as Parameters<typeof buildLineSpeedProfile>[0], lineB?.id ?? 0),
    [network.segments, lineB],
  )

  const maxSpeed = Math.max(
    ...speedA.map((s) => s.kmh),
    ...speedB.map((s) => s.kmh),
    1,
  )

  if (!lineA || !lineB) return null

  return (
    <div className="line-compare">
      <header className="line-compare__header">
        <GitCompare size={20} />
        <h3>Linien-Duell</h3>
      </header>

      <div className="line-compare__pickers">
        <LinePicker label="Linie A" lines={lines} value={lineA.id} onChange={onLineAChange} accent={lineA.color} />
        <span className="line-compare__vs">VS</span>
        <LinePicker label="Linie B" lines={lines} value={lineB.id} onChange={onLineBChange} accent={lineB.color} />
      </div>

      <div className="line-compare__table-wrap">
        <table className="line-compare__table">
          <thead>
            <tr>
              <th>Metrik</th>
              <th style={{ color: lineA.color }}>{lineA.name}</th>
              <th style={{ color: lineB.color }}>{lineB.name}</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.id}>
                <td>{m.label}</td>
                <td className={m.winner === 'a' ? 'line-compare__winner' : ''}>
                  {m.a}
                  {m.winner === 'a' && <Trophy size={12} />}
                </td>
                <td className={m.winner === 'b' ? 'line-compare__winner' : ''}>
                  {m.b}
                  {m.winner === 'b' && <Trophy size={12} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="line-compare__speed">
        <h4>Geschwindigkeitsprofil (km/h)</h4>
        <div className="line-compare__speed-grid">
          <SpeedBars label={lineA.name} color={lineA.color} segments={speedA} max={maxSpeed} />
          <SpeedBars label={lineB.name} color={lineB.color} segments={speedB} max={maxSpeed} />
        </div>
      </div>
    </div>
  )
}

function LinePicker({
  label,
  lines,
  value,
  onChange,
  accent,
}: {
  label: string
  lines: ReturnType<typeof buildLineExplorerDetails>
  value: number
  onChange: (id: number) => void
  accent: string
}) {
  return (
    <label className="line-compare__picker" style={{ '--picker-accent': accent } as CSSProperties}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {lines.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function SpeedBars({
  label,
  color,
  segments,
  max,
}: {
  label: string
  color: string
  segments: Array<{ from: string; to: string; kmh: number }>
  max: number
}) {
  return (
    <div className="line-compare__speed-col">
      <span className="line-compare__speed-label" style={{ color }}>{label}</span>
      <div className="line-compare__bars">
        {segments.map((seg, i) => (
          <motion.div
            key={`${seg.from}-${seg.to}`}
            className="line-compare__bar"
            title={`${seg.from} → ${seg.to}: ${seg.kmh} km/h`}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: i * 0.02 }}
            style={{
              width: `${(seg.kmh / max) * 100}%`,
              backgroundColor: color,
            }}
          >
            <small>{seg.kmh}</small>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
