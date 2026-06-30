interface Props {
  loaded: boolean
  running: boolean
  timestep: number
  simTime: number | undefined
  completed: boolean
  onStep: () => void
  onBack: () => void
  onPlay: () => void
  onPause: () => void
  onReset: () => void
  onRewind?: () => void
  onSeek?: (t: number) => void
}

export default function SimControls({
  loaded,
  running,
  timestep,
  simTime,
  completed,
  onStep,
  onBack,
  onPlay,
  onPause,
  onReset,
  onRewind,
  onSeek,
}: Props) {
  const done = completed
  const progress = simTime !== undefined && simTime > 0 ? Math.min(timestep / simTime, 1) : null

  function handleSeekClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onSeek || simTime === undefined) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = Math.round(((e.clientX - rect.left) / rect.width) * simTime)
    onSeek(Math.max(0, Math.min(t, simTime)))
  }

  return (
    <div className="border border-border">
      {/* Control row */}
      <div className="flex items-stretch">
        <button
          onClick={onReset}
          disabled={!loaded}
          title="Clear all neuron state and return to timestep 0 — also clears the spike history"
          className="px-4 py-2 font-mono text-xs text-text-muted border-r border-border hover:text-text-secondary hover:bg-raised transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        >
          ◀◀ Reset
        </button>
        {onRewind && (
          <button
            onClick={onRewind}
            disabled={!loaded || running || timestep === 0}
            title="Return to timestep 0 — spike schedule is preserved (use Reset to also clear the schedule)"
            className="px-4 py-2 font-mono text-xs text-text-muted border-r border-border hover:text-text-secondary hover:bg-raised transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
          >
            ⏮ Rewind
          </button>
        )}
        <button
          onClick={onBack}
          disabled={!loaded || running || timestep === 0}
          title="Seek back one timestep by replaying the stored input schedule from t=0"
          className="px-4 py-2 font-mono text-xs text-text-muted border-r border-border hover:text-text-secondary hover:bg-raised transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        >
          ◀ Back
        </button>
        <button
          onClick={onStep}
          disabled={!loaded || running}
          title="Advance the simulation by one timestep — fires any inputs scheduled for this step"
          className="px-4 py-2 font-mono text-xs text-text-secondary border-r border-border hover:text-text-primary hover:bg-raised transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        >
          ▶ Step
        </button>
        {running ? (
          <button
            onClick={onPause}
            title="Pause continuous playback"
            className="px-4 py-2 font-mono text-xs text-accent border-r border-border hover:bg-raised transition-colors"
          >
            ⏸ Pause
          </button>
        ) : (
          <button
            onClick={onPlay}
            disabled={!loaded || done}
            title={done ? 'Simulation complete — Reset to run again' : 'Run all timesteps automatically at 10 steps/sec'}
            className="px-4 py-2 font-mono text-xs text-text-muted border-r border-border hover:text-text-secondary hover:bg-raised transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
          >
            ▶▶ Play
          </button>
        )}
        <div className="flex items-center gap-4 ml-auto px-4">
          <span className="font-mono text-xs text-text-secondary" title="Current timestep / total simulation timesteps">
            {simTime !== undefined
              ? timestep === 0 ? `Init / ${simTime - 1}` : `t = ${timestep - 1} / ${simTime - 1}`
              : timestep === 0 ? 'Init' : `t = ${timestep - 1}`}
          </span>
          {!loaded && (
            <span className="font-mono text-2xs text-text-muted border-l border-border pl-4">
              load a network above to begin
            </span>
          )}
        </div>
      </div>
      {/* Seekbar — click or drag to jump to any timestep */}
      {progress !== null && (
        <div
          className="h-1.5 bg-border relative cursor-pointer group"
          onClick={handleSeekClick}
          title={`Seek bar — click anywhere to jump to that timestep · currently ${timestep === 0 ? 'Init' : `t=${timestep - 1}`} / ${simTime! - 1}`}
        >
          <div
            className="absolute inset-y-0 left-0 bg-accent transition-all duration-100"
            style={{ width: `${progress * 100}%` }}
          />
          <div
            className="absolute inset-y-0 w-px bg-accent opacity-0 group-hover:opacity-40 transition-opacity pointer-events-none"
            style={{ left: `${progress * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
