import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Search, X } from 'lucide-react'
import type { StationOption } from '../lib/routing/types'

interface StationAutocompleteProps {
  label: string
  placeholder: string
  stations: StationOption[]
  value: StationOption | null
  onChange: (station: StationOption | null) => void
  excludeId?: number
  excludeIds?: number[]
}

export function StationAutocomplete({
  label,
  placeholder,
  stations,
  value,
  onChange,
  excludeId,
  excludeIds = [],
}: StationAutocompleteProps) {
  const [query, setQuery] = useState(value?.name ?? '')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(value?.name ?? '')
  }, [value])

  const excluded = useMemo(() => {
    const set = new Set(excludeIds)
    if (excludeId) set.add(excludeId)
    return set
  }, [excludeId, excludeIds])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return stations
      .filter((s) => !excluded.has(s.id))
      .filter((s) => !q || s.name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [stations, query, excluded])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function selectStation(station: StationOption) {
    onChange(station)
    setQuery(station.name)
    setOpen(false)
  }

  function clear() {
    onChange(null)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="station-field" ref={containerRef}>
      <label className="station-field__label">{label}</label>
      <div className={`station-field__input-wrap ${open ? 'is-open' : ''}`}>
        <MapPin className="station-field__icon" size={18} />
        <input
          className="station-field__input"
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setHighlight(0)
            if (!e.target.value) onChange(null)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open || filtered.length === 0) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlight((h) => (h + 1) % filtered.length)
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => (h - 1 + filtered.length) % filtered.length)
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              selectStation(filtered[highlight])
            }
            if (e.key === 'Escape') setOpen(false)
          }}
        />
        {query && (
          <button type="button" className="station-field__clear" onClick={clear} aria-label="Löschen">
            <X size={16} />
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <ul className="station-field__dropdown" role="listbox">
          {filtered.map((station, index) => (
            <li key={station.id}>
              <button
                type="button"
                className={`station-field__option ${index === highlight ? 'is-highlighted' : ''}`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => selectStation(station)}
              >
                <span className="station-field__option-name">{station.name}</span>
                <span className="station-field__option-meta">
                  {station.interchange && <span className="badge badge--interchange">Umsteigebahnhof</span>}
                  <span className="station-field__lines">
                    {station.lineColors.slice(0, 4).map((color, i) => (
                      <span key={i} className="line-dot" style={{ backgroundColor: color }} />
                    ))}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && query && filtered.length === 0 && (
        <div className="station-field__empty">
          <Search size={16} />
          Keine Station gefunden
        </div>
      )}
    </div>
  )
}
