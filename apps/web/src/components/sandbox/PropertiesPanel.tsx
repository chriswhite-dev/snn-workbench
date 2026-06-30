import { useEffect, useRef, useState } from 'react'
import type { RispNetwork, RispProcParams } from '@shared/types'
import type { SpikeTransit } from '../../hooks/useSimulation'

const RISP_127: RispProcParams = {
  discrete: true,
  max_delay: 127,
  min_threshold: 1,
  max_threshold: 127,
  min_weight: -127,
  max_weight: 127,
  min_potential: -127,
}

interface Props {
  network: RispNetwork | null
  potentials?: Record<string, number>
  nodeNames?: Record<number, string>
  spikeTransits?: SpikeTransit[]
  timestep?: number
  onProcParamsChange?: (params: RispProcParams, simTime?: number) => void
}

const editInputCls = 'w-20 px-2 py-0.5 font-mono text-xs bg-bg border border-border text-text-primary focus:outline-none focus:border-text-muted transition-colors text-right'

function DraftInput({ value, isInt, onChange }: {
  value: number | undefined
  isInt?: boolean
  onChange: (v: number | undefined) => void
}) {
  const [draft, setDraft] = useState(value !== undefined ? String(value) : '')
  const savedRef = useRef(value)

  useEffect(() => {
    setDraft(value !== undefined ? String(value) : '')
  }, [value])

  function commit(str: string) {
    const raw = isInt ? Math.round(parseFloat(str)) : parseFloat(str)
    if (str.trim() === '' || isNaN(raw)) {
      const prev = savedRef.current
      setDraft(prev !== undefined ? String(prev) : '')
      onChange(prev)
    } else {
      setDraft(String(raw))
      onChange(raw)
    }
  }

  return (
    <input
      type="text"
      inputMode={isInt ? 'numeric' : 'decimal'}
      value={draft}
      className={editInputCls}
      onFocus={() => { savedRef.current = value }}
      onChange={e => setDraft(e.target.value)}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => {
        const el = e.target as HTMLInputElement
        if (e.key === 'Enter')  { commit(el.value); el.blur() }
        if (e.key === 'Escape') {
          const prev = savedRef.current
          setDraft(prev !== undefined ? String(prev) : '')
          onChange(prev)
          el.blur()
        }
      }}
    />
  )
}

function EditRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
      <span className="font-mono text-2xs text-text-muted">{label}</span>
      {children}
    </div>
  )
}

function SpikeTrainsTab({
  transits,
  nodeNames,
}: {
  transits: SpikeTransit[]
  nodeNames?: Record<number, string>
}) {
  if (transits.length === 0) {
    return (
      <span className="font-mono text-2xs text-text-muted opacity-70">no spikes in transit</span>
    )
  }

  const byEdge = new Map<string, SpikeTransit[]>()
  for (const tr of transits) {
    const list = byEdge.get(tr.edgeId) ?? []
    list.push(tr)
    byEdge.set(tr.edgeId, list)
  }

  const nodeName = (id: number) => {
    const name = nodeNames?.[id]
    return name ? `${id} (${name})` : String(id)
  }

  return (
    <div className="space-y-2">
      {[...byEdge.entries()].map(([edgeId, trs]) => (
        <div key={edgeId}>
          <div className="grid grid-cols-[1fr_auto] gap-2 font-mono text-2xs">
            <span className="text-text-muted truncate">
              {nodeName(trs[0].fromNode)} → {nodeName(trs[0].toNode)}
            </span>
            <span className="text-text-secondary">×{trs.length}</span>
          </div>
          {trs.map(tr => (
            <div key={`${tr.edgeId}-${tr.launchedAt}`} className="font-mono text-2xs opacity-50 pl-2" style={{ color: '#d4622a' }}>
              arrives t={tr.arrivesAt}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function PropertiesPanel({ network, potentials, nodeNames, spikeTransits, timestep, onProcParamsChange }: Props) {
  const [activeTab, setActiveTab] = useState<'potentials' | 'spike-trains'>('potentials')
  const [editMode, setEditMode] = useState(false)
  const [draftParams, setDraftParams] = useState<RispProcParams>(RISP_127)
  const [draftSimTime, setDraftSimTime] = useState<number | undefined>(undefined)

  // Re-seed draft when the network changes from outside while the form is open — external change wins.
  useEffect(() => {
    if (!editMode || !network) return
    setDraftParams(network.Associated_Data.proc_params ?? RISP_127)
    setDraftSimTime(network.Associated_Data.other?.sim_time)
  }, [network, editMode])

  if (!network) {
    return (
      <div className="border border-border px-3 py-2 font-mono text-xs text-text-muted">
        No network loaded
      </div>
    )
  }

  const proc = network.Associated_Data?.proc_params ?? RISP_127
  const usingDefault = !network.Associated_Data?.proc_params

  const simTime = network.Associated_Data?.other?.sim_time
  const procRows: [string, string][] = [
    ...(simTime !== undefined ? [['sim_time', String(simTime)] as [string, string]] : []),
    ['discrete', String(proc.discrete)],
    ['leak_mode', proc.leak_mode ?? 'none'],
    ['weights', proc.weights
      ? `[${proc.weights.join(', ')}]`
      : `[${proc.min_weight ?? '?'}, ${proc.max_weight ?? '?'}]`],
    ['threshold', `[${proc.min_threshold}, ${proc.max_threshold}]`],
    ['max_delay', String(proc.max_delay)],
    ['min_potential', String(proc.min_potential)],
  ]

  const hasWeightsArray = (draftParams.weights?.length ?? 0) > 0
  const switchingToDiscrete = editMode && draftParams.discrete && !(proc.discrete)

  const validationErrors: string[] = []
  if (editMode) {
    if (draftParams.min_threshold > draftParams.max_threshold)
      validationErrors.push('min_threshold must be ≤ max_threshold')
    if (!hasWeightsArray && (draftParams.min_weight ?? 0) > (draftParams.max_weight ?? 0))
      validationErrors.push('min_weight must be ≤ max_weight')
    if (draftParams.max_delay < 1)
      validationErrors.push('max_delay must be ≥ 1')
    if (draftParams.min_potential > 0)
      validationErrors.push('min_potential must be ≤ 0')
    if (draftSimTime !== undefined && draftSimTime < 1)
      validationErrors.push('sim_time must be ≥ 1')
    if (draftParams.discrete) {
      if (!Number.isInteger(draftParams.min_threshold))
        validationErrors.push('min_threshold must be an integer when discrete')
      if (!Number.isInteger(draftParams.max_threshold))
        validationErrors.push('max_threshold must be an integer when discrete')
      if (!Number.isInteger(draftParams.min_potential))
        validationErrors.push('min_potential must be an integer when discrete')
      if (!hasWeightsArray) {
        if (!Number.isInteger(draftParams.min_weight ?? 0))
          validationErrors.push('min_weight must be an integer when discrete')
        if (!Number.isInteger(draftParams.max_weight ?? 0))
          validationErrors.push('max_weight must be an integer when discrete')
      }
    }
  }

  const handleSave = () => {
    if (!onProcParamsChange || validationErrors.length > 0) return
    onProcParamsChange(draftParams, draftSimTime)
    setEditMode(false)
  }

  const nodeProps = network.Properties?.node_properties ?? []
  const edgeProps = network.Properties?.edge_properties ?? []

  return (
    <div className="border border-border flex flex-col overflow-hidden h-full">

      {/* Proc params */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between flex-shrink-0">
        <span
          className="font-mono text-2xs text-text-muted tracking-widest uppercase"
          title="RISP processor configuration — defines valid weight, threshold, delay, and potential ranges for this network"
        >
          Processor Params
        </span>
        <div className="flex items-center gap-3">
          {usingDefault && !editMode && (
            <span className="font-mono text-2xs text-text-muted opacity-80" title="No proc_params in JSON — using RISP-127 defaults">
              RISP-127 default
            </span>
          )}
          {onProcParamsChange && (
            <button
              onClick={() => setEditMode(v => !v)}
              className="font-mono text-2xs text-text-muted hover:text-text-secondary transition-colors"
            >
              {editMode ? 'cancel' : 'edit →'}
            </button>
          )}
        </div>
      </div>

      {editMode ? (
        <div className="p-3 space-y-2 flex-shrink-0">

          <EditRow label="sim_time">
            <DraftInput
              value={draftSimTime}
              isInt
              onChange={v => setDraftSimTime(v)}
            />
          </EditRow>

          <EditRow label="discrete">
            <button
              onClick={() => setDraftParams(p => ({ ...p, discrete: !p.discrete }))}
              className={`px-3 py-0.5 font-mono text-xs border transition-colors ${
                draftParams.discrete
                  ? 'border-text-secondary text-text-secondary'
                  : 'border-border text-text-muted hover:border-text-muted'
              }`}
            >
              {draftParams.discrete ? 'true' : 'false'}
            </button>
          </EditRow>

          <EditRow label="leak_mode">
            <select
              value={draftParams.leak_mode ?? 'none'}
              className={editInputCls}
              onChange={e => setDraftParams(p => ({ ...p, leak_mode: e.target.value as RispProcParams['leak_mode'] }))}
            >
              <option value="none">none</option>
              <option value="all">all</option>
              <option value="configurable">configurable</option>
            </select>
          </EditRow>

          <EditRow label="min_threshold">
            <DraftInput value={draftParams.min_threshold} isInt={draftParams.discrete}
              onChange={v => { if (v !== undefined) setDraftParams(p => ({ ...p, min_threshold: v })) }} />
          </EditRow>
          <EditRow label="max_threshold">
            <DraftInput value={draftParams.max_threshold} isInt={draftParams.discrete}
              onChange={v => { if (v !== undefined) setDraftParams(p => ({ ...p, max_threshold: v })) }} />
          </EditRow>

          {hasWeightsArray ? (
            <EditRow label="weight range">
              <span className="font-mono text-2xs text-text-muted opacity-60">weights array</span>
            </EditRow>
          ) : (
            <>
              <EditRow label="min_weight">
                <DraftInput value={draftParams.min_weight ?? undefined} isInt={draftParams.discrete}
                  onChange={v => { if (v !== undefined) setDraftParams(p => ({ ...p, min_weight: v })) }} />
              </EditRow>
              <EditRow label="max_weight">
                <DraftInput value={draftParams.max_weight ?? undefined} isInt={draftParams.discrete}
                  onChange={v => { if (v !== undefined) setDraftParams(p => ({ ...p, max_weight: v })) }} />
              </EditRow>
            </>
          )}

          <EditRow label="max_delay">
            <DraftInput value={draftParams.max_delay} isInt
              onChange={v => { if (v !== undefined) setDraftParams(p => ({ ...p, max_delay: v })) }} />
          </EditRow>

          <EditRow label="min_potential">
            <DraftInput value={draftParams.min_potential}
              onChange={v => { if (v !== undefined) setDraftParams(p => ({ ...p, min_potential: v })) }} />
          </EditRow>

          {switchingToDiscrete && (
            <p className="font-mono text-2xs text-text-muted">
              Switching to discrete mode will round all threshold, weight, and potential values to integers.
            </p>
          )}

          {validationErrors.map((err, i) => (
            <p key={i} className="font-mono text-2xs" style={{ color: '#d4622a' }}>{err}</p>
          ))}

          <button
            onClick={handleSave}
            disabled={validationErrors.length > 0}
            className="font-mono text-xs text-text-muted border border-border px-3 py-1 hover:border-text-muted hover:text-text-secondary transition-colors disabled:opacity-30"
          >
            Save →
          </button>

        </div>
      ) : (
        <div className="p-3 space-y-1.5 flex-shrink-0">
          {procRows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[1fr_auto] gap-3 font-mono text-xs">
              <span className="text-text-muted">{k}</span>
              <span className="text-text-secondary">{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* Property definitions */}
      {(nodeProps.length > 0 || edgeProps.length > 0) && (
        <div className="border-t border-border flex-shrink-0">
          <div className="px-3 py-1.5 border-b border-border">
            <span className="font-mono text-2xs text-text-muted tracking-widest uppercase">
              Properties
            </span>
          </div>
          <div className="p-3 space-y-1">
            {nodeProps.map((p) => (
              <div key={p.name} className="grid grid-cols-[1fr_auto] gap-2 font-mono text-2xs">
                <span className="text-text-muted">node · {p.name}</span>
                <span className="text-text-secondary">[{p.min_value}, {p.max_value}]</span>
              </div>
            ))}
            {edgeProps.map((p) => (
              <div key={p.name} className="grid grid-cols-[1fr_auto] gap-2 font-mono text-2xs">
                <span className="text-text-muted">edge · {p.name}</span>
                <span className="text-text-secondary">[{p.min_value}, {p.max_value}]</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Potentials / Spike Trains tabbed section */}
      <div className="border-t border-border flex flex-col flex-1 min-h-0">
        <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setActiveTab('potentials')}
            title="Membrane potential (charge) for each neuron at the current timestep — non-zero values shown in orange"
            className={`font-mono text-2xs tracking-widest uppercase transition-colors ${
              activeTab === 'potentials' ? 'text-text-secondary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            Potentials
          </button>
          <span className="font-mono text-2xs text-text-muted">·</span>
          <button
            onClick={() => setActiveTab('spike-trains')}
            title="Spikes currently in transit — shows which synapses are carrying a spike and when it will arrive"
            className={`font-mono text-2xs tracking-widest uppercase transition-colors ${
              activeTab === 'spike-trains' ? 'text-text-secondary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            Spike Trains
          </button>
          {activeTab === 'spike-trains' && timestep !== undefined && (
            <span className="font-mono text-2xs text-text-muted opacity-40 ml-auto">t={timestep}</span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {activeTab === 'potentials' ? (
            potentials && Object.keys(potentials).length > 0 ? (
              Object.entries(potentials)
                .sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([id, charge]) => {
                  const name = nodeNames?.[Number(id)]
                  const label = name ? `${id} (${name})` : String(id)
                  return (
                    <div key={id} className="grid grid-cols-[1fr_auto] gap-2 font-mono text-2xs">
                      <span className="text-text-muted">{label}</span>
                      <span
                        className="text-right"
                        style={{ color: Math.abs(charge) > 0.01 ? '#d4622a' : '#9e8f7e' }}
                      >
                        {typeof charge === 'number' ? charge.toFixed(3) : String(charge)}
                      </span>
                    </div>
                  )
                })
            ) : (
              <span className="font-mono text-2xs text-text-muted opacity-70">no data</span>
            )
          ) : (
            <SpikeTrainsTab transits={spikeTransits ?? []} nodeNames={nodeNames} />
          )}
        </div>
      </div>

      {/* Footer stats */}
      <div className="px-3 py-2.5 border-t border-border grid grid-cols-3 gap-2 flex-shrink-0 mt-auto">
        {[
          ['nodes', network.Nodes.length],
          ['edges', network.Edges.length],
          ['i/o', `${network.Inputs.length}/${network.Outputs.length}`],
        ].map(([label, value]) => (
          <div key={label as string}>
            <span className="font-mono text-2xs text-text-muted block mb-0.5">{label}</span>
            <span className="font-mono text-xs text-text-primary">{value}</span>
          </div>
        ))}
      </div>

    </div>
  )
}
