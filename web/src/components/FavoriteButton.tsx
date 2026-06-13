import { Star } from 'lucide-react'

interface FavoriteButtonProps {
  active: boolean
  onToggle: () => void
  label?: string
  size?: number
}

export function FavoriteButton({ active, onToggle, label, size = 16 }: FavoriteButtonProps) {
  return (
    <button
      type="button"
      className={`favorite-btn ${active ? 'is-active' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      title={active ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
      aria-label={label ?? (active ? 'Favorit entfernen' : 'Favorit setzen')}
      aria-pressed={active}
    >
      <Star size={size} fill={active ? 'currentColor' : 'none'} />
    </button>
  )
}
