import { useEffect, useRef, useState } from 'react'
import type { RispNetwork, RispProcParams } from '@shared/types'

interface FormState {
  sim_time: number
  discrete: boolean
  leak_mode: 'none' | 'all' | 'configurable'
  min_threshold: number
  max_threshold: number
  min_weight: number
  max_weight: number
  max_delay: number
  min_potential: number
}

const DEFAULTS: FormState = {
  sim_time: 50,
  discrete: true,
  leak_mode: 'none',
  min_threshold: 1,
  max_threshold: 127,
  min_weight: -127,
  max_weight: 127,
  max_delay: 127,
  min_potential: -127,
}

// ASCII type codes: 68='D' (double), 73='I' (integer). Delay is always I; min_delay is hardcoded to 1.
const T_DOUBLE = 68
const T_INT = 73

function buildNetwork(f: FormState): RispNetwork {
  const proc: RispProcParams = {
    discrete: f.discrete,
    min_threshold: f.min_threshold,
    max_threshold: f.max_threshold,
    min_weight: f.min_weight,
    max_weight: f.max_weight,
    max_delay: f.max_delay,
    min_potential: f.min_potential,
    ...(f.leak_mode !== 'none' ? { leak_mode: f.leak_mode } : {}),
  }
  const numType = f.discrete ? T_INT : T_DOUBLE
  return {
    Properties: {
      node_properties: [
        { name: 'Threshold', type: numType, index: 0, size: 1, min_value: f.min_threshold, max_value: f.max_threshold },
      ],
      edge_properties: [
        { name: 'Weight', type: numType, index: 0, size: 1, min_value: f.min_weight, max_value: f.max_weight },
        { name: 'Delay',  type: T_INT,   index: 1, size: 1, min_value: 1,            max_value: f.max_delay },
      ],
      network_properties: [],
    },
    Nodes: [],
    Edges: [],
    Inputs: [],
    Outputs: [],
    Network_Values: [],
    Associated_Data: {
      proc_params: proc,
      other: { proc_name: 'risp', sim_time: f.sim_time },
    },
  }
}

const inputCls = 'w-full px-2 py-1 font-mono text-xs bg-bg border border-border text-text-primary focus:outline-none focus:border-text-muted transition-colors'

function SectionHeader({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="col-span-full pt-2 pb-0.5 border-b border-border">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs text-text-muted tracking-widest uppercase">{label}</span>
        {detail && <span className="font-mono text-2xs text-text-muted opacity-30">{detail}</span>}
      </div>
    </div>
  )
}

function TypeBadge({ code }: { code: string }) {
  return (
    <span className="font-mono text-2xs opacity-30 ml-1.5">{code}</span>
  )
}

function NumField({
  label, typeBadge, value, isInt, onChange,
}: {
  label: string
  typeBadge?: string
  value: number
  isInt?: boolean
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const savedRef = useRef(value)

  useEffect(() => { setDraft(String(value)) }, [value])

  function commit(str: string) {
    const raw = isInt ? Math.round(parseFloat(str)) : parseFloat(str)
    if (str.trim() === '' || isNaN(raw)) {
      setDraft(String(savedRef.current)); onChange(savedRef.current)
    } else {
      setDraft(String(raw)); onChange(raw)
    }
  }

  return (
    <div>
      <label className="font-mono text-2xs text-text-muted block mb-1">
        {label}{typeBadge && <TypeBadge code={typeBadge} />}
      </label>
      <input
        type="text"
        inputMode={isInt ? 'numeric' : 'decimal'}
        value={draft}
        className={inputCls}
        onFocus={() => { savedRef.current = value }}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => {
          const el = e.target as HTMLInputElement
          if (e.key === 'Enter')  { commit(el.value); el.blur() }
          if (e.key === 'Escape') { setDraft(String(savedRef.current)); onChange(savedRef.current); el.blur() }
        }}
      />
    </div>
  )
}

interface Props {
  onCreate: (network: RispNetwork) => void
}

export default function NetworkCreator({ onCreate }: Props) {
  const [f, setF] = useState<FormState>(DEFAULTS)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF(prev => ({ ...prev, [k]: v }))

  const valType = f.discrete ? 'I' : 'D'

  return (
    <div className="border border-border">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="font-mono text-xs text-text-muted tracking-widest uppercase">New Network</span>
        <span className="font-mono text-2xs text-text-muted opacity-40">RISP processor</span>
      </div>

      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">

        <SectionHeader label="Simulation" />
        <NumField label="sim_time" typeBadge="I" value={f.sim_time} isInt onChange={v => set('sim_time', v)} />

        <SectionHeader label="Mode" />
        <div>
          <label className="font-mono text-2xs text-text-muted block mb-1">discrete</label>
          <button
            onClick={() => set('discrete', !f.discrete)}
            className={`px-3 py-1 font-mono text-xs border transition-colors ${f.discrete ? 'border-text-secondary text-text-secondary' : 'border-border text-text-muted hover:border-text-muted'}`}
          >
            {f.discrete ? 'true' : 'false'}
          </button>
        </div>
        <div>
          <label className="font-mono text-2xs text-text-muted block mb-1">leak_mode</label>
          <select
            value={f.leak_mode}
            onChange={e => set('leak_mode', e.target.value as FormState['leak_mode'])}
            className={inputCls}
          >
            <option value="none">none — charge carries over</option>
            <option value="all">all — charge resets each tick</option>
            <option value="configurable">configurable — per neuron</option>
          </select>
        </div>

        <SectionHeader label="Threshold" detail={`node property · type ${valType}`} />
        <NumField label="min_threshold" typeBadge={valType} value={f.min_threshold} isInt={f.discrete} onChange={v => set('min_threshold', v)} />
        <NumField label="max_threshold" typeBadge={valType} value={f.max_threshold} isInt={f.discrete} onChange={v => set('max_threshold', v)} />

        <SectionHeader label="Weight" detail={`edge property · type ${valType}`} />
        <NumField label="min_weight" typeBadge={valType} value={f.min_weight} isInt={f.discrete} onChange={v => set('min_weight', v)} />
        <NumField label="max_weight" typeBadge={valType} value={f.max_weight} isInt={f.discrete} onChange={v => set('max_weight', v)} />

        <SectionHeader label="Delay" detail="edge property · always integer · min is always 1" />
        <NumField label="max_delay" typeBadge="I" value={f.max_delay} isInt onChange={v => set('max_delay', v)} />

        <SectionHeader label="Potential" detail="proc param · charge floor · must be ≤ 0" />
        <NumField label="min_potential" typeBadge="D" value={f.min_potential} onChange={v => set('min_potential', v)} />

        <div className="col-span-full flex justify-end pt-2 border-t border-border mt-1">
          <button
            onClick={() => onCreate(buildNetwork(f))}
            className="font-mono text-xs text-text-muted border border-border px-4 py-2 hover:border-text-muted hover:text-text-secondary transition-colors"
          >
            Create network →
          </button>
        </div>
      </div>
    </div>
  )
}
