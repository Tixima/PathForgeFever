import { useRef } from 'react'
import { CheckCircle2, RefreshCw, Upload } from 'lucide-react'

interface NetworkReloadPanelProps {
  onReload: () => void
  onImportFile?: (file: File) => void | Promise<void>
  reloading: boolean
  importing?: boolean
  showSuccess?: boolean
  compact?: boolean
  sourceLabel?: string
}

export function NetworkReloadPanel({
  onReload,
  onImportFile,
  reloading,
  importing = false,
  showSuccess = false,
  compact = false,
  sourceLabel,
}: NetworkReloadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = reloading || importing

  return (
    <div className={`network-reload ${compact ? 'network-reload--compact' : ''}`}>
      {sourceLabel && !compact && (
        <p className="network-reload__source">
          Quelle: <strong>{sourceLabel}</strong>
        </p>
      )}

      <div className="network-reload__actions">
        <button
          type="button"
          className={`network-reload__btn ${reloading ? 'is-loading' : ''}`}
          onClick={onReload}
          disabled={busy}
          title="Lädt tpf2_network_export.json vom Server neu"
        >
          <RefreshCw size={16} className={reloading ? 'network-reload__spin' : ''} />
          {reloading ? 'Wird eingelesen…' : 'Neu laden'}
        </button>

        {onImportFile && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".json,application/json"
              className="network-reload__file-input"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void onImportFile(file)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className="network-reload__btn network-reload__btn--upload"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <Upload size={16} />
              {importing ? 'Import…' : 'JSON hochladen'}
            </button>
          </>
        )}
      </div>

      {showSuccess && !busy && (
        <p className="network-reload__success">
          <CheckCircle2 size={14} />
          Netzwerk aktualisiert
        </p>
      )}

      {!compact && (
        <p className="network-reload__hint">
          <Upload size={13} />
          Neuen TF2-Export per Upload ersetzen oder Server-Datei neu einlesen.
        </p>
      )}
    </div>
  )
}
