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
  "Nodes": [
    { "id": 0, "values": [1], "name": "in" },
    { "id": 1, "values": [1] }
  ],
  "Edges": [{ "from": 0, "to": 1, "values": [1, 1] }],
  "Inputs": [0],
  "Outputs": [1],
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

const processorRows: [string, string][] = [
  ['Neuron model', 'Integrate-and-fire'],
  ['Time', 'Discrete timesteps'],
  ['Leak modes', 'none · all · configurable'],
  ['Node values', '[threshold] or [threshold, leak]'],
  ['Edge values', '[weight, delay], delay ≥ 1'],
  ['State', 'membrane potential + spike history'],
  ['Threshold type', 'I (73) when discrete · D (68) otherwise'],
  ['Default config', 'RISP-127: integer weights/thresholds, max delay 127'],
]

const platformRows: [string, string][] = [
  ['Frontend', 'React 18 · TypeScript · Vite · Tailwind CSS'],
  ['Animation', 'Framer Motion · @xyflow/react v12'],
  ['Backend', 'Node.js · Express · TypeScript'],
  ['Database', 'PostgreSQL via Drizzle ORM'],
  ['Validation', 'Zod (network schema)'],
  ['Storage', 'Cloudflare R2 · local disk fallback'],
  ['Simulation', 'RISP C++ → Emscripten → WebAssembly'],
  ['Monorepo', 'npm workspaces'],
]

const wasmFunctions: [string, string, string][] = [
  ['load_network', '(json: string): void', 'Parse network JSON and load into RISP processor'],
  ['step',         '(): void',             'Advance one timestep; tracks input spikes for raster'],
  ['apply_spikes', '(json: string): void', 'Inject spikes into input neurons (array of node IDs)'],
  ['reset',        '(): void',             'Clear all neuron activity and return to t = 0'],
  ['get_state',    '(): string',           '{ timestep, spikes: number[], potentials: Record<string, number> }'],
  ['get_error',    '(): string',           'Last error from load_network — empty string on success'],
]

export default function About() {
  return (
    <div className="max-w-[1600px] mx-auto px-6">
      <div className="py-4 border-b border-border">
        <span className="font-mono text-sm font-medium text-text-primary">About</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-0 py-10">
        <div className="lg:pr-12 lg:border-r lg:border-border space-y-10">

          <section>
            <p className="font-mono text-xs text-text-muted tracking-widest uppercase mb-4">
              Overview
            </p>
            <p className="text-text-secondary text-sm leading-relaxed mb-3">
              A web platform for designing, simulating, and sharing RISP (Reconfigurable
              Integrate-and-Spike Processor) spiking neural networks. Built on the{' '}
              <a
                href="https://github.com/TENNLab-UTK/framework-open"
                className="text-text-primary underline underline-offset-2 decoration-border hover:decoration-text-muted transition-colors"
                target="_blank"
                rel="noopener noreferrer"
              >
                TENNLab framework-open
              </a>
              , a neuromorphic computing framework from the University of Tennessee.
            </p>
            <p className="text-text-secondary text-sm leading-relaxed mb-3">
              Networks can be built from scratch on an interactive visual canvas — add neurons,
              draw synapses, configure thresholds and weights — or loaded from a JSON file or the
              community library. Edits export as valid framework-native RISP JSON.
            </p>
            <p className="text-text-secondary text-sm leading-relaxed">
              The C++ RISP processor is compiled to WebAssembly via Emscripten and runs entirely
              in-browser on the main thread. No server-side compute; no round-trips.
            </p>
          </section>

          <section>
            <p className="font-mono text-xs text-text-muted tracking-widest uppercase mb-4">
              RISP Processor
            </p>
            <p className="text-text-secondary text-sm leading-relaxed mb-4">
              RISP is a discrete-time integrate-and-fire model. Each timestep runs three ordered
              phases sourced from{' '}
              <span className="font-mono text-xs text-text-muted">risp.cpp</span>:
            </p>
            <div className="space-y-3 mb-6">
              {([
                ['Leak & clamp', 'Charge carries forward or resets based on leak_mode, then is raised to min_potential if it fell below the floor.'],
                ['Accumulate & fire', 'Scheduled events (synapse weights and input spikes) sum into each neuron\'s potential. Any neuron at or above threshold fires and resets to zero.'],
                ['Propagate', 'Each firing neuron schedules a weight delivery at a future timestep — current tick plus the synapse delay — into the processor\'s event queue.'],
              ] as [string, string][]).map(([phase, desc]) => (
                <div key={phase} className="grid grid-cols-[10rem_1fr] gap-4 text-sm">
                  <span className="font-mono text-xs text-text-muted pt-0.5">{phase}</span>
                  <span className="text-text-secondary leading-relaxed">{desc}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              {processorRows.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[10rem_1fr] gap-4 font-mono text-xs">
                  <span className="text-text-muted">{k}</span>
                  <span className="text-text-secondary">{v}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <p className="font-mono text-xs text-text-muted tracking-widest uppercase mb-4">
              Platform Stack
            </p>
            <div className="space-y-1.5">
              {platformRows.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[10rem_1fr] gap-4 font-mono text-xs">
                  <span className="text-text-muted">{k}</span>
                  <span className="text-text-secondary">{v}</span>
                </div>
              ))}
            </div>
          </section>

        </div>

        <div className="lg:pl-12 pt-10 lg:pt-0 space-y-10">

          <section>
            <p className="font-mono text-xs text-text-muted tracking-widest uppercase mb-1">
              Network Format
            </p>
            <p className="font-mono text-2xs text-text-muted mb-4" style={{ opacity: 0.4 }}>
              framework-native · uppercase keys · RISP-127 defaults
            </p>
            <pre className="font-mono text-xs text-text-secondary leading-relaxed overflow-x-auto">
              {networkJson}
            </pre>
          </section>

          <section className="border-t border-border pt-8">
            <p className="font-mono text-xs text-text-muted tracking-widest uppercase mb-4">
              WASM API
            </p>
            <div className="space-y-3">
              {wasmFunctions.map(([fn, sig, desc]) => (
                <div key={fn}>
                  <div className="font-mono text-xs">
                    <span className="text-text-secondary">{fn}</span>
                    <span className="text-text-muted">{sig}</span>
                  </div>
                  <p className="font-mono text-2xs text-text-muted mt-0.5" style={{ opacity: 0.5 }}>
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
