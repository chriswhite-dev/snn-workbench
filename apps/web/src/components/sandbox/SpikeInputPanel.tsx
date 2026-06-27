interface Props {
  inputIds:        number[]
  displayTimestep: number
  displayIds:      number[]
  onToggle:        (id: number) => void
  onAll:           () => void
  onNone:          () => void
}

export default function SpikeInputPanel({
  inputIds, displayTimestep, displayIds,
  onToggle, onAll, onNone,
}: Props) {
  if (inputIds.length === 0) return null

  const selected = new Set(displayIds)

  return (
    <div className="border-x border-t border-border">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-2xs text-text-muted tracking-widest uppercase">
            Input Schedule
          </span>
          <span className="font-mono text-2xs text-text-secondary" title="Current timestep">
            t = {displayTimestep}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-2xs text-text-muted" title={`${selected.size} of ${inputIds.length} input neurons will fire`}>
            {selected.size}/{inputIds.length} firing
          </span>
          <button onClick={onAll} className="font-mono text-2xs text-text-muted hover:text-text-secondary transition-colors">all</button>
          <button onClick={onNone} className="font-mono text-2xs text-text-muted hover:text-text-secondary transition-colors">none</button>
        </div>
      </div>

      {/* Toggle chips */}
      <div className="p-2 pb-1">
        <div className="flex flex-wrap gap-1">
          {inputIds.map((id) => (
            <button
              key={id}
              onClick={() => onToggle(id)}
              title={
                selected.has(id)
                  ? `Neuron ${id} — will fire at t=${displayTimestep} (click to remove)`
                  : `Neuron ${id} — will NOT fire at t=${displayTimestep} (click to schedule)`
              }
              className={`px-1.5 h-5 font-mono text-2xs border transition-colors ${
                selected.has(id)
                  ? 'bg-accent border-accent text-bg'
                  : 'border-border text-text-muted hover:border-text-muted hover:text-text-secondary'
              }`}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

    </div>
  )
}
