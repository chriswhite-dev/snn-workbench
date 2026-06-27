import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'

// Parameter details from wasm/framework-open/src/risp.cpp. Type codes: D=68, I=73, B=66, S=string.

interface ParamRow {
  key: string
  type: string
  description: string
  values: string
}

interface Slide {
  title: string
  subtitle: string
  params: ParamRow[]
}

const SLIDES: Slide[] = [
  {
    title: 'Configuration',
    subtitle: 'Top-level processor settings · stored in Associated_Data',
    params: [
      {
        key: 'proc_name',
        type: 'S',
        description: 'Identifies which processor the framework loads',
        values: '"risp" (fixed)',
      },
      {
        key: 'sim_time',
        type: 'I',
        description: 'How many timesteps to run before playback auto-stops',
        values: 'Positive integer',
      },
      {
        key: 'discrete',
        type: 'B',
        description: 'When true, all weights, thresholds, and potentials must be whole numbers. Also switches the Threshold and Weight property type from D (68) to I (73)',
        values: 'true | false',
      },
      {
        key: 'leak_mode',
        type: 'S',
        description: '"none": charge carries over between ticks. "all": charge resets to 0 at the start of each tick. "configurable": each node has its own Leak boolean property',
        values: '"none" | "all" | "configurable"',
      },
    ],
  },
  {
    title: 'Threshold',
    subtitle: 'Node property · index 0 · one value per neuron · type depends on discrete',
    params: [
      {
        key: 'min_threshold',
        type: 'D/I',
        description: 'Lower bound for neuron threshold. Stored as Nodes[n].values[0]',
        values: 'Any number ≤ max_threshold. Must be integer when discrete=true',
      },
      {
        key: 'max_threshold',
        type: 'D/I',
        description: 'Upper bound for neuron threshold. A neuron fires when charge ≥ threshold (threshold_inclusive=true by default), then charge resets to 0',
        values: 'Any number ≥ min_threshold. Must be integer when discrete=true',
      },
      {
        key: 'property type',
        type: '73|68',
        description: 'I (73) when discrete=true, D (68) otherwise',
        values: '73 if discrete · 68 if continuous',
      },
    ],
  },
  {
    title: 'Weight',
    subtitle: 'Edge property · index 0 · one value per synapse · type depends on discrete',
    params: [
      {
        key: 'min_weight',
        type: 'D/I',
        description: 'Stored as Edges[e].values[0]. Weight is added to the target neuron\'s charge after the synapse\'s delay',
        values: 'Any number. Must be integer when discrete=true',
      },
      {
        key: 'max_weight',
        type: 'D/I',
        description: 'Upper bound for synapse weight. Also the default charge per input spike (spike_value_factor) unless overridden',
        values: 'Any number ≥ min_weight. Must be integer when discrete=true',
      },
      {
        key: 'property type',
        type: '73|68',
        description: 'I (73) when discrete=true, D (68) otherwise',
        values: '73 if discrete · 68 if continuous',
      },
    ],
  },
  {
    title: 'Delay',
    subtitle: 'Edge property · index 1 · always type I (73) · one integer per synapse',
    params: [
      {
        key: 'min_delay',
        type: 'I',
        description: 'Hardcoded to 1 in the processor, not settable from JSON. delay=1 means charge arrives one timestep after the neuron fires',
        values: '1 (fixed)',
      },
      {
        key: 'max_delay',
        type: 'I',
        description: 'Upper bound for synapse delay. Stored as Edges[e].values[1]',
        values: 'Positive integer ≥ 1',
      },
      {
        key: 'property type',
        type: '73',
        description: 'Always I (73). Delay is a count of timesteps, so it\'s always integer regardless of discrete mode',
        values: 'always 73 (I)',
      },
    ],
  },
  {
    title: 'Potential',
    subtitle: 'proc_params field · type D · charge floor applied every tick',
    params: [
      {
        key: 'min_potential',
        type: 'D',
        description: 'Charge is clamped to this value every tick. If charge drops below min_potential it is set back to min_potential. Must be ≤ 0',
        values: 'Any number ≤ 0',
      },
    ],
  },
]

interface SimStep {
  step: number
  title: string
  body: string
}

const SIM_STEPS: SimStep[] = [
  {
    step: 1,
    title: 'Leak and clamp',
    body: 'If leak is not none: at the start of each tick, charge is managed before any new events arrive. Depending on the network\'s leak mode, a neuron\'s charge either carries forward unchanged from the previous tick or resets to zero entirely. After leak is applied, any neuron whose charge has fallen below the minimum potential floor is raised back up to that floor. This prevents inhibitory inputs from pushing charge arbitrarily negative.',
  },
  {
    step: 2,
    title: 'Integrate and fire',
    body: 'All events scheduled to arrive this tick are processed: each synapse delivers its weight directly to the target neuron\'s charge. Input spikes injected for this timestep also arrive here, each adding a fixed amount of charge to the designated input neuron. Once every arriving event has been summed, each neuron is checked against its threshold. Any neuron whose charge meets or exceeds that threshold fires immediately and its charge resets to zero.',
  },
  {
    step: 3,
    title: 'Propagate',
    body: 'Every neuron that fired during this tick sends signals forward through all of its outgoing synapses. Each synapse schedules a weight-delivery event at a future timestep: the current tick number plus that synapse\'s delay. A delay of one means the charge arrives at the very next tick; longer delays push it further ahead. These queued events sit in the processor\'s event queue until their target timestep, at which point they become inputs that the next accumulation phase will process.',
  },
]

const GC = {
  bg:     '#161411',
  node:   '#1f1d19',
  border: '#3a3728',
  muted:  '#9e8f7e',
  charge: '#4a3a24',
  accent: '#d4622a',
}

// A small feed-forward RISP network: 2 inputs → 3 hidden → 1 output.
// Spike wave propagates every 5s. Purely decorative — not simulation-accurate.

function HeroGraphic() {
  const LOOP = '5s'

  // Node radii
  const rI = 15, rH = 17, rO = 21

  // Node centers: viewBox 0 0 360 208
  const iNodes = [{ cx: 38, cy: 68 }, { cx: 38, cy: 140 }]
  const hNodes = [{ cx: 178, cy: 48 }, { cx: 178, cy: 104 }, { cx: 178, cy: 160 }]
  const oNode = { cx: 318, cy: 104 }

  // Edges: from outer rim of source to outer rim of target
  // Precomputed to avoid floating-point drift in SVG
  const iEdges = [
    { x1: 53, y1: 66, x2: 161, y2: 50, path: 'M53,66 L161,50' }, // i0→h0
    { x1: 53, y1: 72, x2: 162, y2: 100, path: 'M53,72 L162,100' }, // i0→h1
    { x1: 53, y1: 136, x2: 162, y2: 108, path: 'M53,136 L162,108' }, // i1→h1
    { x1: 53, y1: 142, x2: 161, y2: 158, path: 'M53,142 L161,158' }, // i1→h2
  ]
  const hEdges = [
    { x1: 194, y1: 54, x2: 299, y2: 96, path: 'M194,54 L299,96' },   // h0→o
    { x1: 195, y1: 104, x2: 297, y2: 104, path: 'M195,104 L297,104' }, // h1→o
    { x1: 194, y1: 154, x2: 299, y2: 112, path: 'M194,154 L299,112' }, // h2→o
  ]

  // Timing (normalized 0–1 over LOOP)
  const iDotS = 0.05, iDotE = 0.35
  const hDotS = 0.41, hDotE = 0.67
  const iGlowS = 0.00, iGlowE = 0.14
  const hGlowS = 0.36, hGlowE = 0.52
  const oGlowS = 0.69, oGlowE = 0.84

  const dotOpacityKT = (s: number, e: number) =>
    `0;${s};${s + 0.01};${e};${e + 0.01};1`
  const dotMotionKT = (s: number, e: number) => `0;${s};${e};1`
  const glowKT = (s: number, e: number) =>
    `0;${s};${s + 0.02};${e};${e + 0.06};1`
  const glowVals =
    `${GC.border};${GC.border};${GC.accent};${GC.accent};${GC.border};${GC.border}`

  return (
    <svg viewBox="0 0 360 208" fill="none" aria-hidden className="w-full">
      {/* Edges */}
      {[...iEdges, ...hEdges].map((e, i) => (
        <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          stroke={GC.border} strokeWidth="0.75" opacity={0.6} />
      ))}

      {/* Spike dots: inputs → hidden */}
      {iEdges.map((e, i) => (
        <circle key={i} cx={0} cy={0} r={3} fill={GC.accent}>
          <animate attributeName="opacity"
            values={`0;0;0.8;0.8;0;0`}
            keyTimes={dotOpacityKT(iDotS, iDotE)}
            dur={LOOP} repeatCount="indefinite" />
          <animateMotion path={e.path} keyPoints="0;0;1;1"
            keyTimes={dotMotionKT(iDotS, iDotE)}
            calcMode="linear" dur={LOOP} repeatCount="indefinite" />
        </circle>
      ))}

      {/* Spike dots: hidden → output */}
      {hEdges.map((e, i) => (
        <circle key={i} cx={0} cy={0} r={3.5} fill={GC.accent}>
          <animate attributeName="opacity"
            values={`0;0;0.85;0.85;0;0`}
            keyTimes={dotOpacityKT(hDotS, hDotE)}
            dur={LOOP} repeatCount="indefinite" />
          <animateMotion path={e.path} keyPoints="0;0;1;1"
            keyTimes={dotMotionKT(hDotS, hDotE)}
            calcMode="linear" dur={LOOP} repeatCount="indefinite" />
        </circle>
      ))}

      {/* Input nodes */}
      {iNodes.map((n, i) => (
        <circle key={i} cx={n.cx} cy={n.cy} r={rI} fill={GC.node} strokeWidth="1.5">
          <animate attributeName="stroke"
            values={glowVals} keyTimes={glowKT(iGlowS, iGlowE)}
            dur={LOOP} repeatCount="indefinite" />
        </circle>
      ))}

      {/* Hidden nodes */}
      {hNodes.map((n, i) => (
        <circle key={i} cx={n.cx} cy={n.cy} r={rH} fill={GC.node} strokeWidth="1.5">
          <animate attributeName="stroke"
            values={glowVals} keyTimes={glowKT(hGlowS, hGlowE)}
            dur={LOOP} repeatCount="indefinite" />
        </circle>
      ))}

      {/* Output node */}
      <circle cx={oNode.cx} cy={oNode.cy} r={rO} fill={GC.node} strokeWidth="1.5">
        <animate attributeName="stroke"
          values={glowVals} keyTimes={glowKT(oGlowS, oGlowE)}
          dur={LOOP} repeatCount="indefinite" />
      </circle>
    </svg>
  )
}

function SimGraphic({ step }: { step: number }) {
  const MF = '"JetBrains Mono",monospace'

  if (step === 1) {
    // viewBox matches step 3 (255×78) so all three slides render at the same height.
    // clipR = r - sw/2: fill stops at the inner edge of the stroke, not overlapping it.
    const r = 28, cx = 127, cy = 39, sw = 1.5
    const clipR = r - sw / 2   // 27.25 — flush with inner border
    const bot = cy + r          // 67
    const h62 = Math.round(r * 2 * 0.62)  // 35
    const y62 = bot - h62       // 32

    return (
      <svg viewBox="0 0 255 78" className="w-full" fill="none" aria-hidden>
        <defs>
          <clipPath id="s1-c"><circle cx={cx} cy={cy} r={clipR}/></clipPath>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill={GC.node} stroke={GC.border} strokeWidth={sw}/>
        <rect x={cx - r} y={y62} width={r * 2} height={h62}
          clipPath="url(#s1-c)" fill={GC.charge}>
          <animate attributeName="y"
            values={`${y62};${bot - 1};${bot - 1};${y62};${y62}`}
            keyTimes="0;0.37;0.70;0.80;1" dur="3.5s" repeatCount="indefinite"
            calcMode="spline" keySplines="0.42 0 0.58 1;0 0 1 1;0.42 0 0.58 1;0 0 1 1"/>
          <animate attributeName="height"
            values={`${h62};1;1;${h62};${h62}`}
            keyTimes="0;0.37;0.70;0.80;1" dur="3.5s" repeatCount="indefinite"
            calcMode="spline" keySplines="0.42 0 0.58 1;0 0 1 1;0.42 0 0.58 1;0 0 1 1"/>
        </rect>
      </svg>
    )
  }

  if (step === 2) {
    // Spread content across 255×78 viewBox (matches step 3 aspect ratio).
    // clipR = nr - sw/2 so the charge fill is flush with the inner border.
    const inputs: [number, number][] = [[25, 15], [25, 39], [25, 63]]
    const ncx = 205, ncy = 39, nr = 26, sw = 1.5
    const clipR = nr - sw / 2  // 25.25 — flush with inner border
    const bot = ncy + nr        // 65
    const threshY = ncy - 8     // 31
    const threshHW = Math.floor(Math.sqrt(nr * nr - (threshY - ncy) ** 2)) - 2
    // = floor(sqrt(676 - 64)) - 2 = floor(24.74) - 2 = 22

    const LOOP = '8s'
    const fires: [number, number][] = [[0.09, 0.16], [0.29, 0.36], [0.49, 0.56]]

    const kt  = '0;0.17;0.20;0.36;0.39;0.56;0.59;0.61;0.74;1'
    const yVs = [bot,bot,bot-14,bot-14,bot-28,bot-28,bot-40,bot-40,bot,bot].join(';')
    const hVs = [0,  0,  14,    14,    28,    28,    40,    40,    0,  0 ].join(';')

    return (
      <svg viewBox="0 0 255 78" className="w-full" fill="none" aria-hidden>
        <defs>
          <clipPath id="s2-cn"><circle cx={ncx} cy={ncy} r={clipR}/></clipPath>
        </defs>
        {inputs.map(([x, y], i) => (
          <line key={i} x1={x + 10} y1={y} x2={ncx - nr - 2} y2={ncy}
            stroke={GC.border} strokeWidth="0.75" opacity={0.4}/>
        ))}
        {inputs.map(([x, y], i) => {
          const [t0, t1] = fires[i]
          const path = `M${x + 10},${y} L${ncx - nr - 2},${ncy}`
          return (
            <g key={i}>
              <motion.circle cx={x} cy={y} r={10} fill={GC.node} strokeWidth="1.5"
                initial={{ stroke: GC.border }}
                animate={{ stroke: [GC.border, GC.border, GC.muted, GC.border, GC.border] }}
                transition={{ duration: 8, repeat: Infinity, times: [0, t0, t0 + 0.04, t0 + 0.10, 1] }}
              />
              <circle cx={0} cy={0} r={3.5} fill={GC.accent}>
                <animate attributeName="opacity"
                  values={`0;0;0.85;0.85;0;0`}
                  keyTimes={`0;${t0};${t0 + 0.01};${t1};${t1 + 0.02};1`}
                  dur={LOOP} repeatCount="indefinite"/>
                <animateMotion path={path} keyPoints="0;0;1;1"
                  keyTimes={`0;${t0};${t1};1`} calcMode="linear"
                  dur={LOOP} repeatCount="indefinite"/>
              </circle>
            </g>
          )
        })}
        <motion.circle cx={ncx} cy={ncy} r={nr} fill={GC.node} strokeWidth="1.5"
          initial={{ stroke: GC.border }}
          animate={{ stroke: [GC.border, GC.border, GC.accent, GC.accent, GC.border] }}
          transition={{ duration: 8, repeat: Infinity, times: [0, 0.60, 0.62, 0.72, 0.82] }}
        />
        <rect x={ncx - nr} y={bot} width={nr * 2} height={0}
          clipPath="url(#s2-cn)" fill={GC.charge}>
          <animate attributeName="y"      values={yVs} keyTimes={kt} dur={LOOP} repeatCount="indefinite" calcMode="linear"/>
          <animate attributeName="height" values={hVs} keyTimes={kt} dur={LOOP} repeatCount="indefinite" calcMode="linear"/>
        </rect>
        <line x1={ncx - threshHW} y1={threshY} x2={ncx + threshHW} y2={threshY}
          stroke={GC.accent} strokeWidth="0.75" strokeDasharray="2,1.5" opacity={0.5}/>
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 255 78" className="w-full" fill="none" aria-hidden>
      <defs>
        <marker id="s3-arr" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L6,3 L0,6 Z" fill={GC.border}/>
        </marker>
      </defs>
      <line x1={57} y1={32} x2={159} y2={20} stroke={GC.border} strokeWidth="1.25" markerEnd="url(#s3-arr)"/>
      <text x={108} y={19} fill={GC.muted} fontSize="6.5" fontFamily={MF} textAnchor="middle" dominantBaseline="auto" opacity={0.38}>d = 1</text>
      <line x1={57} y1={46} x2={159} y2={58} stroke={GC.border} strokeWidth="1.25" markerEnd="url(#s3-arr)"/>
      <text x={108} y={64} fill={GC.muted} fontSize="6.5" fontFamily={MF} textAnchor="middle" dominantBaseline="auto" opacity={0.38}>d = 3</text>
      <motion.circle r={4} fill={GC.accent}
        initial={{ cx: 57, cy: 32, opacity: 0 }}
        animate={{ cx: [57, 57, 159, 159], cy: [32, 32, 20, 20], opacity: [0, 0.9, 0.9, 0] }}
        transition={{ duration: 3.5, repeat: Infinity, times: [0, 0.14, 0.50, 0.58], ease: 'easeInOut' }}
      />
      <motion.circle r={4} fill={GC.accent}
        initial={{ cx: 57, cy: 46, opacity: 0 }}
        animate={{ cx: [57, 57, 159, 159], cy: [46, 46, 58, 58], opacity: [0, 0.9, 0.9, 0] }}
        transition={{ duration: 3.5, repeat: Infinity, times: [0, 0.14, 0.86, 0.91], ease: 'easeInOut' }}
      />
      <motion.circle cx={36} cy={39} r={21} fill={GC.node} strokeWidth="1.5"
        animate={{ stroke: [GC.accent, GC.border, GC.border, GC.accent] }}
        transition={{ duration: 3.5, repeat: Infinity, times: [0, 0.13, 0.93, 1] }}
      />
      <motion.circle cx={178} cy={18} r={17} fill={GC.node} strokeWidth="1.5"
        initial={{ stroke: GC.border }}
        animate={{ stroke: [GC.border, GC.border, GC.accent, GC.border] }}
        transition={{ duration: 3.5, repeat: Infinity, times: [0, 0.47, 0.57, 0.70] }}
      />
      <text x={178} y={18} fill={GC.muted} fontSize="7" fontFamily={MF} textAnchor="middle" dominantBaseline="central" opacity={0.45}>t+1</text>
      <motion.circle cx={178} cy={60} r={17} fill={GC.node} strokeWidth="1.5"
        initial={{ stroke: GC.border }}
        animate={{ stroke: [GC.border, GC.border, GC.accent, GC.border] }}
        transition={{ duration: 3.5, repeat: Infinity, times: [0, 0.83, 0.90, 0.96] }}
      />
      <text x={178} y={60} fill={GC.muted} fontSize="7" fontFamily={MF} textAnchor="middle" dominantBaseline="central" opacity={0.45}>t+3</text>
    </svg>
  )
}

function Carousel({ slides, showTypeLegend = false }: { slides: Slide[]; showTypeLegend?: boolean }) {
  const [idx, setIdx] = useState(0)
  const [dir, setDir] = useState(1)

  function go(next: number) {
    setDir(next > idx ? 1 : -1)
    setIdx(next)
  }

  const slide = slides[idx]

  return (
    <div className="flex flex-col" style={{ height: '36rem' }}>
      {showTypeLegend && (
        <p className="font-mono text-2xs opacity-60 mb-5 flex-shrink-0" style={{ color: '#9e8f7e' }}>
          D=68 double · I=73 integer · B=66 boolean · S string
        </p>
      )}

      {/* Fixed-height content area — nav never shifts */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence initial={false} mode="wait" custom={dir}>
          <motion.div
            key={idx}
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: d * 24, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit:  (d: number) => ({ x: d * -24, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.18, ease: 'easeInOut' }}
          >
            <div className="mb-4 pb-3 border-b border-border">
              <p className="font-mono text-sm text-text-primary font-medium mb-1">{slide.title}</p>
              <p className="font-mono text-2xs text-text-secondary opacity-70 leading-relaxed">{slide.subtitle}</p>
            </div>
            <div className="space-y-4">
              {slide.params.map(p => (
                <div key={p.key}>
                  <div className="flex items-baseline justify-between mb-0.5">
                    <span className="font-mono text-xs text-text-muted">{p.key}</span>
                    {p.type !== '—' && (
                      <span className="font-mono text-2xs ml-3 flex-shrink-0" style={{ color: '#9e8f7e', opacity: 0.6 }}>
                        {p.type}
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-2xs text-text-muted leading-relaxed" style={{ opacity: 0.55 }}>
                    {p.description}
                  </p>
                  <p className="font-mono text-2xs mt-0.5" style={{ color: '#9e8f7e', opacity: 0.5 }}>
                    {p.values}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Nav pinned to bottom of fixed container */}
      <div className="flex items-center gap-3 mt-auto pt-4 border-t border-border flex-shrink-0">
        <button onClick={() => go(Math.max(0, idx - 1))} disabled={idx === 0}
          className="font-mono text-xs text-text-muted hover:text-text-secondary disabled:opacity-20 transition-colors">←</button>
        <div className="flex items-center gap-1.5">
          {slides.map((s, i) => (
            <button key={i} onClick={() => go(i)} title={s.title} className="transition-all"
              style={{ width: i === idx ? 16 : 8, height: 5, borderRadius: 2, background: i === idx ? '#9e8f7e' : '#3a3728' }} />
          ))}
        </div>
        <button onClick={() => go(Math.min(slides.length - 1, idx + 1))} disabled={idx === slides.length - 1}
          className="font-mono text-xs text-text-muted hover:text-text-secondary disabled:opacity-20 transition-colors">→</button>
        <span className="font-mono text-2xs text-text-muted opacity-50 ml-auto">{idx + 1} / {slides.length}</span>
      </div>
    </div>
  )
}

function SimCarousel() {
  const [idx, setIdx] = useState(0)
  const [dir, setDir] = useState(1)

  function go(next: number) {
    setDir(next > idx ? 1 : -1)
    setIdx(next)
  }

  const step = SIM_STEPS[idx]

  return (
    <div className="flex flex-col" style={{ height: '26rem' }}>
      {/* Fixed-height content area — overflow hidden so nav never shifts */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence initial={false} mode="wait" custom={dir}>
          <motion.div
            key={idx}
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: d * 24, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit:  (d: number) => ({ x: d * -24, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.18, ease: 'easeInOut' }}
          >
            <div className="mb-4 pb-3 border-b border-border flex items-baseline gap-3">
              <span className="font-mono text-2xs" style={{ color: '#9e8f7e', opacity: 0.4 }}>step {step.step}</span>
              <p className="font-mono text-sm text-text-primary font-medium">{step.title}</p>
            </div>
            <div className="my-4">
              <SimGraphic step={step.step} />
            </div>
            <p className="font-mono text-2xs text-text-muted leading-relaxed" style={{ opacity: 0.6 }}>
              {step.body}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Nav is always pinned to the bottom of the fixed container */}
      <div className="flex items-center gap-3 mt-auto pt-4 border-t border-border flex-shrink-0">
        <button onClick={() => go(Math.max(0, idx - 1))} disabled={idx === 0}
          className="font-mono text-xs text-text-muted hover:text-text-secondary disabled:opacity-20 transition-colors">←</button>
        <div className="flex items-center gap-1.5">
          {SIM_STEPS.map((s, i) => (
            <button key={i} onClick={() => go(i)} title={s.title} className="transition-all"
              style={{ width: i === idx ? 16 : 8, height: 5, borderRadius: 2, background: i === idx ? '#9e8f7e' : '#3a3728' }} />
          ))}
        </div>
        <button onClick={() => go(Math.min(SIM_STEPS.length - 1, idx + 1))} disabled={idx === SIM_STEPS.length - 1}
          className="font-mono text-xs text-text-muted hover:text-text-secondary disabled:opacity-20 transition-colors">→</button>
        <span className="font-mono text-2xs text-text-muted opacity-50 ml-auto">{idx + 1} / {SIM_STEPS.length}</span>
      </div>
    </div>
  )
}

function LeftPanel() {
  const [view, setView] = useState<'arch' | 'sim'>('arch')
  return (
    <div>
      <div className="flex items-center gap-5 mb-5 pb-3 border-b border-border">
        {(['arch', 'sim'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`font-mono text-xs tracking-widest uppercase transition-colors ${
              view === v ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {v === 'arch' ? 'Architecture' : 'Simulation'}
          </button>
        ))}
      </div>
      {view === 'arch' ? <Carousel slides={SLIDES} showTypeLegend /> : <SimCarousel />}
    </div>
  )
}

const networkJson = `{
  "Properties": {
    "node_properties": [{
      "name": "Threshold", "type": 73,
      "index": 0, "size": 1,
      "min_value": 1, "max_value": 127
    }],
    "edge_properties": [
      { "name": "Weight", "type": 73,
        "index": 0, "size": 1,
        "min_value": -127, "max_value": 127 },
      { "name": "Delay",  "type": 73,
        "index": 1, "size": 1,
        "min_value": 1,    "max_value": 127 }
    ],
    "network_properties": []
  },
  "Nodes": [{ "id": 0, "values": [1] }],
  "Edges": [{ "from": 0, "to": 1, "values": [1, 1] }],
  "Inputs": [0], "Outputs": [1],
  "Network_Values": [],
  "Associated_Data": {
    "proc_params": {
      "discrete": true,     "max_delay": 127,
      "min_threshold": 1,   "max_threshold": 127,
      "min_weight": -127,   "max_weight": 127,
      "min_potential": -127
    },
    "other": { "proc_name": "risp", "sim_time": 50 }
  }
}`

const capabilities = [
  {
    label: 'Design',
    body: 'Build any network from scratch on the interactive canvas. Place neurons, draw synapses, and dial in thresholds, weights, and delays — then export as valid RISP JSON.',
  },
  {
    label: 'Load & Edit',
    body: 'Drop a RISP JSON file or open one from the library. Every parameter is editable in the canvas and inspector, and you can re-export at any time.',
  },
  {
    label: 'Simulate',
    body: 'Step through timesteps one at a time or run continuously. Watch charge accumulate, neurons fire, and spikes travel — tracked live in the raster and potentials panel.',
  },
  {
    label: 'Share',
    body: 'Publish finished networks to the community library. Sort by run count or recency to discover what others have built and load their work directly into the sandbox.',
  },
]

export default function Landing() {
  return (
    <div className="max-w-[1600px] mx-auto px-6">

      {/* Hero — 2-col on lg+: text left, network animation right */}
      <div className="pt-16 pb-16 border-b border-border grid grid-cols-1 lg:grid-cols-[1fr_400px] xl:grid-cols-[1fr_460px] gap-10 lg:gap-16 items-center">
        <div>
          <h1 className="font-sans font-light text-5xl sm:text-6xl lg:text-7xl text-text-primary leading-[1.02] tracking-tight mb-5">
            Spiking neural networks,<br />
            <span style={{
              backgroundImage: 'linear-gradient(to right, #f7f3eb 0%, #cbbcac 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              running in your browser.
            </span>
          </h1>
          <p className="text-text-secondary text-sm leading-relaxed max-w-xl mb-8">
            Design networks on an interactive canvas, run them through a compiled RISP processor,
            and share with the community — without leaving your browser or installing anything.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <Link
              to="/sandbox"
              className="font-mono text-sm text-text-primary border border-border px-5 py-2.5 hover:border-text-secondary hover:bg-raised transition-colors"
            >
              Open sandbox →
            </Link>
            <Link
              to="/library"
              className="font-mono text-sm text-text-muted hover:text-text-secondary transition-colors"
            >
              Browse library
            </Link>
          </div>
        </div>

        <div className="hidden lg:block" style={{ opacity: 0.65 }}>
          <HeroGraphic />
        </div>
      </div>

      {/* Capabilities */}
      <div className="border-b border-border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
        {capabilities.map((cap, i) => (
          <div
            key={cap.label}
            className={`py-8 ${i === 0 ? 'sm:pr-6' : i === capabilities.length - 1 ? 'sm:pl-6' : 'sm:px-6'}`}
          >
            <p className="font-mono text-xs text-text-primary tracking-widest uppercase mb-3">
              {cap.label}
            </p>
            <p className="text-text-secondary text-sm leading-relaxed">{cap.body}</p>
          </div>
        ))}
      </div>

      {/* Architecture + Network Format */}
      <div className="py-10 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-0">
        <div className="lg:pr-10 lg:border-r lg:border-border">
          <LeftPanel />
        </div>
        <div className="lg:pl-10">
          <p className="font-mono text-xs text-text-muted tracking-widest uppercase mb-2">
            Network Format
          </p>
          <p className="font-mono text-2xs opacity-60 mb-5" style={{ color: '#9e8f7e' }}>
            framework-native · uppercase keys · type 73 = discrete RISP-127
          </p>
          <pre className="font-mono text-xs text-text-secondary leading-relaxed overflow-x-auto">
            {networkJson}
          </pre>
        </div>
      </div>

    </div>
  )
}
