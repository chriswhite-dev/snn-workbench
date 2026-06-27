interface Props {
  entries:       { t: number; ids: number[] }[]
  draftTimestep: number | null
  scheduleText:  string
  scheduleError: string | null
  onEdit:        (t: number) => void
  onDelete:      (t: number) => void
  onTextChange:  (text: string) => void
  onTextApply:   () => void
  onTextCancel:  () => void
}

export default function ScheduleList({
  entries, draftTimestep, scheduleText, scheduleError,
  onEdit, onDelete, onTextChange, onTextApply, onTextCancel,
}: Props) {
  const hasText = scheduleText.trim().length > 0

  return (
    <div className="border-x border-b border-border">
      {/* Manual text entry */}
      <div className="px-3 py-2 border-b border-border flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={scheduleText}
            onChange={e => onTextChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onTextApply(); if (e.key === 'Escape') onTextCancel() }}
            placeholder='t, t1-t2, ...: id1, id2, "name" ...'
            title={'Schedule format:\n  Single: 5: id1, id2\n  Range: 0-5: id1, id2\n  Mixed: 0-5, 8: id1, id2\n\nNeurons can be numeric IDs or quoted names.\nExample: 0-3, 7: 0, "input_a"'}
            className={`flex-1 font-mono text-xs bg-bg text-text-primary border px-2 py-1 focus:outline-none placeholder:text-text-muted placeholder:opacity-40 transition-colors ${
              scheduleError ? 'border-accent' : 'border-border focus:border-text-muted'
            }`}
          />
          {hasText && (
            <>
              <button
                onClick={onTextApply}
                className="px-2 py-1 font-mono text-2xs border border-accent text-accent hover:bg-accent hover:text-bg transition-colors flex-shrink-0"
              >
                Apply
              </button>
              <button
                onClick={onTextCancel}
                className="font-mono text-2xs text-text-muted hover:text-text-secondary transition-colors flex-shrink-0"
              >
                ✕
              </button>
            </>
          )}
        </div>
        {scheduleError && (
          <span className="font-mono text-2xs" style={{ color: '#d4622a' }}>{scheduleError}</span>
        )}
      </div>

      {/* Schedule header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="font-mono text-2xs text-text-muted tracking-widest uppercase">
          Schedule
        </span>
        {entries.length > 0 && (
          <span className="font-mono text-2xs text-text-muted">{entries.length} timestep{entries.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="px-3 py-3 font-mono text-2xs text-text-muted opacity-50">
          no neurons scheduled — toggle neurons above or type an entry
        </div>
      ) : (
        <div className="max-h-36 overflow-y-auto">
          {entries.map(({ t, ids }) => {
            const preview = ids.join(', ')
            const isEditing = draftTimestep === t
            return (
              <div
                key={t}
                className={`flex items-center justify-between px-3 py-1.5 border-b border-border last:border-b-0 group ${
                  isEditing ? 'bg-raised' : 'hover:bg-raised'
                }`}
              >
                <button
                  onClick={() => onEdit(t)}
                  className="flex-1 text-left flex items-center gap-2 font-mono text-2xs"
                  title={`Edit schedule for t=${t} — neurons: ${ids.join(', ')}`}
                >
                  <span className={isEditing ? 'text-text-secondary' : 'text-text-muted'}>
                    t={t}
                  </span>
                  <span className="text-text-muted opacity-50">·</span>
                  <span className="text-text-muted truncate">{preview}</span>
                  {isEditing && (
                    <span className="text-accent opacity-70 ml-1">editing</span>
                  )}
                </button>
                <button
                  onClick={() => onDelete(t)}
                  title={`Delete schedule for t=${t}`}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 font-mono text-2xs text-text-muted hover:text-accent transition-all ml-2 flex-shrink-0"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
