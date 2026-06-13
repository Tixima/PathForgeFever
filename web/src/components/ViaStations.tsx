import { GitBranchPlus, Plus, X } from 'lucide-react'
import { StationAutocomplete } from './StationAutocomplete'
import type { StationOption } from '../lib/routing/types'

const MAX_VIAS = 5

interface ViaStationsProps {
  stations: StationOption[]
  vias: (StationOption | null)[]
  fromId?: number
  toId?: number
  onChange: (vias: (StationOption | null)[]) => void
}

export function ViaStations({ stations, vias, fromId, toId, onChange }: ViaStationsProps) {
  function addVia() {
    if (vias.length >= MAX_VIAS) return
    onChange([...vias, null])
  }

  function removeVia(index: number) {
    onChange(vias.filter((_, i) => i !== index))
  }

  function updateVia(index: number, station: StationOption | null) {
    const next = [...vias]
    next[index] = station
    onChange(next)
  }

  function excludeIdsFor(index: number): number[] {
    const ids: number[] = []
    if (fromId) ids.push(fromId)
    if (toId) ids.push(toId)
    vias.forEach((v, i) => {
      if (i !== index && v) ids.push(v.id)
    })
    return ids
  }

  return (
    <div className="via-stations">
      <div className="via-stations__header">
        <GitBranchPlus size={16} />
        <div>
          <span className="via-stations__title">Über Bahnhöfe</span>
          <span className="via-stations__hint">Route muss diese Stationen in Reihenfolge durchfahren</span>
        </div>
        {vias.length < MAX_VIAS && (
          <button type="button" className="via-stations__add" onClick={addVia}>
            <Plus size={14} />
            Hinzufügen
          </button>
        )}
      </div>

      {vias.length > 0 && (
        <div className="via-stations__list">
          {vias.map((via, index) => (
            <div key={index} className="via-stations__item">
              <span className="via-stations__index">{index + 1}</span>
              <StationAutocomplete
                label={`Über ${index + 1}`}
                placeholder="Zwischenbahnhof wählen"
                stations={stations}
                value={via}
                onChange={(s) => updateVia(index, s)}
                excludeIds={excludeIdsFor(index)}
              />
              <button
                type="button"
                className="via-stations__remove"
                onClick={() => removeVia(index)}
                aria-label={`Über-Bahnhof ${index + 1} entfernen`}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {vias.length === 0 && (
        <button type="button" className="via-stations__empty" onClick={addVia}>
          <Plus size={14} />
          Zwischenhalt festlegen (z. B. über Berlin, dann München)
        </button>
      )}
    </div>
  )
}
