import { useCallback, useEffect, useRef, useState } from 'react'
import type { RispNetwork } from '@shared/types'
import { getRispModule, type RispModule } from '../lib/risp'

export interface SpikeEntry {
  timestep: number
  nodes: number[]
}

export interface SpikeTransit {
  edgeId: string
  fromNode: number
  toNode: number
  launchedAt: number  // currentT before the step that caused the spike
  arrivesAt: number   // launchedAt + delay
  progress: number    // (displayT - launchedAt) / delay, clamped to 0..1
}

export interface SimState {
  loaded: boolean
  running: boolean
  timestep: number
  simTime: number | undefined
  potentials: Record<string, number>
  spikes: number[]
  history: SpikeEntry[]
  transits: SpikeTransit[]
  error: string | null
  completed: boolean
}

const initial: SimState = {
  loaded: false,
  running: false,
  timestep: 0,
  simTime: undefined,
  potentials: {},
  spikes: [],
  history: [],
  transits: [],
  error: null,
  completed: false,
}

type ParsedState = {
  timestep: number
  potentials: Record<string, number>
  spikes: number[]
}

function readWasmState(mod: RispModule): ParsedState | null {
  try {
    const raw = mod.ccall('get_state', 'string', [], []) as string
    return JSON.parse(raw) as ParsedState
  } catch {
    return null
  }
}

type OutEdge = { edgeId: string; to: number; delay: number }

function buildAdjacency(edges: RispNetwork['Edges']): Map<number, OutEdge[]> {
  const adj = new Map<number, OutEdge[]>()
  for (const edge of edges) {
    let list = adj.get(edge.from)
    if (!list) { list = []; adj.set(edge.from, list) }
    list.push({ edgeId: `${edge.from}->${edge.to}`, to: edge.to, delay: Math.max(1, Math.round(edge.values[1] ?? 1)) })
  }
  return adj
}

// arrivesAt >= newT keeps delay-1 spikes visible for exactly one frame at progress=1.
function computeTransits(
  prev: SpikeTransit[],
  spikingNodes: number[],
  currentT: number,
  newT: number,
  outEdges: Map<number, OutEdge[]>,
): SpikeTransit[] {
  const next: SpikeTransit[] = []

  for (const tr of prev) {
    if (tr.arrivesAt >= newT) {
      const elapsed  = newT - tr.launchedAt
      const duration = tr.arrivesAt - tr.launchedAt
      next.push({ ...tr, progress: elapsed / duration })
    }
  }

  for (const nodeId of spikingNodes) {
    const outs = outEdges.get(nodeId)
    if (!outs) continue
    for (const { edgeId, to, delay } of outs) {
      const arrivesAt = currentT + delay
      if (arrivesAt >= newT) {
        next.push({
          edgeId,
          fromNode: nodeId,
          toNode:   to,
          launchedAt: currentT,
          arrivesAt,
          progress: (newT - currentT) / delay,
        })
      }
    }
  }

  return next
}

export function useSimulation(network: RispNetwork | null) {
  const [state, setState] = useState<SimState>(initial)
  const modRef = useRef<RispModule | null>(null)
  const pendingNetworkRef = useRef<RispNetwork | null>(null)
  const networkRef = useRef<RispNetwork | null>(network)
  const runningRef = useRef(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const simTimeRef = useRef<number | undefined>(undefined)
  const timestepRef = useRef<number>(0)
  const inputScheduleRef = useRef<number[][]>([])
  const networkJsonRef = useRef<string | null>(null)
  const transitsRef = useRef<SpikeTransit[]>([])
  const outEdgesRef = useRef<Map<number, OutEdge[]>>(new Map())
  const skipNextNetworkEffect = useRef(false)

  useEffect(() => { networkRef.current = network }, [network])

  function stopInterval() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  function loadNetworkIntoWasm(mod: RispModule, net: RispNetwork) {
    stopInterval()
    runningRef.current = false
    const simTime = net.Associated_Data?.other?.sim_time
    simTimeRef.current = simTime
    networkJsonRef.current = JSON.stringify(net)
    inputScheduleRef.current = []
    timestepRef.current = 0
    transitsRef.current = []
    outEdgesRef.current = buildAdjacency(net.Edges)
    try {
      mod.ccall('load_network', null, ['string'], [JSON.stringify(net)])
      const s = readWasmState(mod)
      if (!s || Object.keys(s).length === 0 || s.timestep === undefined) {
        const errMsg = mod.ccall('get_error', 'string', [], []) as string
        setState(prev => ({
          ...prev,
          loaded: false,
          error: errMsg || 'load_network failed (no error details)',
          completed: false,
        }))
        return
      }
      setState({
        loaded: true,
        running: false,
        timestep: 0,
        simTime,
        potentials: s.potentials ?? {},
        spikes: [],
        history: [],
        transits: [],
        error: null,
        completed: false,
      })
    } catch (e) {
      setState(prev => ({ ...prev, loaded: false, error: String(e), completed: false }))
    }
  }

  useEffect(() => {
    getRispModule()
      .then(mod => {
        modRef.current = mod
        if (pendingNetworkRef.current) {
          loadNetworkIntoWasm(mod, pendingNetworkRef.current)
          pendingNetworkRef.current = null
        }
      })
      .catch(e => {
        setState(prev => ({ ...prev, error: `WASM failed to load: ${e}` }))
      })
    return () => { stopInterval() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (skipNextNetworkEffect.current) {
      skipNextNetworkEffect.current = false
      return
    }
    if (!network) {
      setState(initial)
      simTimeRef.current = undefined
      timestepRef.current = 0
      networkJsonRef.current = null
      inputScheduleRef.current = []
      transitsRef.current = []
      return
    }
    if (!modRef.current) {
      pendingNetworkRef.current = network
      return
    }
    loadNetworkIntoWasm(modRef.current, network)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network])

  function doStep(mod: RispModule): number {
    const currentT = timestepRef.current
    const spikeIds = inputScheduleRef.current[currentT] ?? []
    if (spikeIds.length > 0) {
      mod.ccall('apply_spikes', null, ['string'], [JSON.stringify(spikeIds)])
    }
    mod.ccall('step', null, [], [])
    const s = readWasmState(mod)
    if (!s) return currentT
    const newT = s.timestep
    timestepRef.current = newT

    const simTime = simTimeRef.current
    const completed = simTime !== undefined && newT >= simTime

    const freshTransits = computeTransits(
      transitsRef.current,
      s.spikes ?? [],
      currentT,
      newT,
      outEdgesRef.current,
    )
    transitsRef.current = freshTransits

    setState(prev => ({
      ...prev,
      timestep: newT,
      completed,
      potentials: s.potentials ?? {},
      spikes: s.spikes ?? [],
      history: [...prev.history, { timestep: currentT, nodes: s.spikes ?? [] }],
      transits: freshTransits,
    }))
    return newT
  }

  const step = useCallback(() => {
    const mod = modRef.current
    if (!mod) return
    doStep(mod)
  }, [])

  const play = useCallback(() => {
    if (runningRef.current) return
    runningRef.current = true
    setState(prev => ({ ...prev, running: true }))

    intervalRef.current = setInterval(() => {
      const mod = modRef.current
      if (!mod) return
      const newT = doStep(mod)
      const st = simTimeRef.current
      if (st !== undefined && newT >= st) {
        runningRef.current = false
        stopInterval()
        setState(prev => ({ ...prev, running: false }))
      }
    }, 100)
  }, [])

  const pause = useCallback(() => {
    runningRef.current = false
    stopInterval()
    setState(prev => ({ ...prev, running: false }))
  }, [])

  const reset = useCallback(() => {
    pause()
    const mod = modRef.current
    if (!mod) return
    mod.ccall('reset', null, [], [])
    inputScheduleRef.current = []
    timestepRef.current = 0
    transitsRef.current = []
    setState(prev => ({
      ...prev,
      running: false,
      timestep: 0,
      completed: false,
      potentials: {},
      spikes: [],
      history: [],
      transits: [],
    }))
  }, [pause])

  const seek = useCallback((t: number) => {
    const mod = modRef.current
    if (!mod || !networkJsonRef.current) return
    stopInterval()
    runningRef.current = false

    mod.ccall('load_network', null, ['string'], [networkJsonRef.current])

    const schedule = inputScheduleRef.current
    const newHistory: SpikeEntry[] = []
    let transits: SpikeTransit[] = []

    for (let i = 0; i < t; i++) {
      const inputs = schedule[i] ?? []
      if (inputs.length > 0) {
        mod.ccall('apply_spikes', null, ['string'], [JSON.stringify(inputs)])
      }
      mod.ccall('step', null, [], [])
      const s = readWasmState(mod)
      if (s && s.timestep !== undefined) {
        transits = computeTransits(transits, s.spikes ?? [], i, s.timestep, outEdgesRef.current)
        newHistory.push({ timestep: i, nodes: s.spikes ?? [] })
      }
    }

    const finalState = readWasmState(mod)
    transitsRef.current = transits
    timestepRef.current = t
    const simTime = simTimeRef.current
    const completed = simTime !== undefined && t >= simTime
    setState(prev => ({
      ...prev,
      loaded: true,
      running: false,
      timestep: t,
      completed,
      potentials: finalState?.potentials ?? {},
      spikes: finalState?.spikes ?? [],
      history: newHistory,
      transits,
    }))
  }, [])

  const setScheduleAt = useCallback((t: number, ids: number[]) => {
    inputScheduleRef.current[t] = [...ids].sort((a, b) => a - b)
  }, [])

  const getScheduleAt = useCallback((t: number): number[] => {
    return inputScheduleRef.current[t] ?? []
  }, [])

  const applySpikes = useCallback((nodeIds: number[]) => {
    modRef.current?.ccall('apply_spikes', null, ['string'], [JSON.stringify(nodeIds)])
  }, [])

  // Reload WASM with an edited network without wiping simulation state or schedule.
  // Replays to the current timestep so history and potentials stay consistent.
  const softReload = useCallback((net: RispNetwork) => {
    if (!modRef.current) return
    skipNextNetworkEffect.current = true
    networkRef.current = net
    networkJsonRef.current = JSON.stringify(net)
    simTimeRef.current = net.Associated_Data?.other?.sim_time
    outEdgesRef.current = buildAdjacency(net.Edges)
    seek(timestepRef.current)
  }, [seek])

  // Update network refs without replaying — safe when the change cannot affect
  // existing simulation results (e.g. a neuron added with no new synapses).
  const silentNetworkUpdate = useCallback((net: RispNetwork) => {
    skipNextNetworkEffect.current = true
    networkRef.current = net
    networkJsonRef.current = JSON.stringify(net)
    simTimeRef.current = net.Associated_Data?.other?.sim_time
    outEdgesRef.current = buildAdjacency(net.Edges)
  }, [])

  return { ...state, step, play, pause, reset, seek, applySpikes, setScheduleAt, getScheduleAt, softReload, silentNetworkUpdate }
}
