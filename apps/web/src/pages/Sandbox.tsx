import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { RispNetwork, NetworkMeta } from '@shared/types'
import { api } from '../lib/api'
import { useSimulation } from '../hooks/useSimulation'
import UploadZone from '../components/sandbox/UploadZone'
import NetworkCreator from '../components/sandbox/NetworkCreator'
import NetworkCanvas, { type NetworkCanvasHandle } from '../components/sandbox/NetworkCanvas'
import NetworkExplorer from '../components/sandbox/NetworkExplorer'
import SimControls from '../components/sandbox/SimControls'
import SpikeRaster from '../components/sandbox/SpikeRaster'
import SpikeInputPanel from '../components/sandbox/SpikeInputPanel'
import ScheduleList from '../components/sandbox/ScheduleList'
import PropertiesPanel from '../components/sandbox/PropertiesPanel'

interface UploadForm {
  name: string
  submitter_name: string
  description: string
  tags: string
}

export default function Sandbox() {
  const [searchParams] = useSearchParams()
  const networkId = searchParams.get('id')

  const [network, setNetwork] = useState<RispNetwork | null>(null)
  const [meta, setMeta] = useState<NetworkMeta | null>(null)
  const sim = useSimulation(network)
  const canvasRef = useRef<NetworkCanvasHandle>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [uploadForm, setUploadForm] = useState<UploadForm>({
    name: '', submitter_name: '', description: '', tags: '',
  })
  const [uploading, setUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  // Incremented when the schedule is edited — triggers re-read of sim.getScheduleAt
  const [scheduleVersion, setScheduleVersion] = useState(0)
  const [explorerSelNodeId, setExplorerSelNodeId] = useState<string | null>(null)
  const [explorerSelEdgeId, setExplorerSelEdgeId] = useState<string | null>(null)
  const [loadMode, setLoadMode] = useState<'upload' | 'create' | null>(null)
  const [bottomTab, setBottomTab] = useState<'raster' | 'explorer'>('raster')
  const [draftTimestep, setDraftTimestep] = useState<number | null>(null)
  const [scheduleText, setScheduleText] = useState('')
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  useEffect(() => {
    if (!networkId) return
    setLoading(true)
    api.getNetwork(networkId)
      .then(async (res) => {
        setMeta(res.data)
        const fileRes = await fetch(res.data.file_url)
        const json = await fileRes.json() as RispNetwork
        setNetwork(json)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [networkId])

  const nodeNames = useMemo<Record<number, string>>(() => {
    if (!network) return {}
    const map: Record<number, string> = {}
    for (const node of network.Nodes) {
      if (node.name) map[node.id] = node.name
    }
    return map
  }, [network])

  // Stable array — avoids SpikeRaster recomputing sortedIds on every sim tick
  const nodeIds = useMemo(() => network?.Nodes?.map(n => n.id) ?? [], [network])

  // Current timestep's scheduled inputs — re-computed when timestep or schedule changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const currentSchedule = useMemo(
    () => sim.getScheduleAt(sim.timestep),
    [sim.timestep, scheduleVersion] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const scheduledEntries = useMemo(() => {
    const max = sim.simTime ?? 50
    const result: { t: number; ids: number[] }[] = []
    for (let t = 0; t < max; t++) {
      const ids = sim.getScheduleAt(t)
      if (ids.length > 0) result.push({ t, ids })
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim.simTime, scheduleVersion])

  // Stable external selection object passed to NetworkCanvas; memoised to avoid spurious effects
  const externalSelection = useMemo(
    () => bottomTab === 'explorer' ? { nodeId: explorerSelNodeId, edgeId: explorerSelEdgeId } : null,
    [bottomTab, explorerSelNodeId, explorerSelEdgeId]
  )

  function handleFileLoad(parsed: RispNetwork, file: File) {
    setNetwork(parsed)
    setMeta(null)
    setPendingFile(file)
    setError(null)
    setUploadSuccess(false)
    setScheduleVersion(v => v + 1)
    setExplorerSelNodeId(null)
    setExplorerSelEdgeId(null)
    setDraftTimestep(null)
    setScheduleText('')
    setBottomTab('raster')
  }

  function handleToggle(id: number) {
    const cur = new Set(currentSchedule)
    if (cur.has(id)) cur.delete(id); else cur.add(id)
    sim.setScheduleAt(sim.timestep, Array.from(cur))
    setScheduleVersion(v => v + 1)
  }

  function handleAll() {
    sim.setScheduleAt(sim.timestep, [...(network?.Inputs ?? [])])
    setScheduleVersion(v => v + 1)
  }

  function handleNone() {
    sim.setScheduleAt(sim.timestep, [])
    setScheduleVersion(v => v + 1)
  }

  function handleOpenDraft(t: number) {
    const ids = sim.getScheduleAt(t)
    setDraftTimestep(t)
    setScheduleText(`${t}: ${ids.join(', ')}`)
  }

  function handleScheduleTextApply() {
    if (!network) return
    const colonIdx = scheduleText.indexOf(':')
    if (colonIdx === -1) return

    const tPart = scheduleText.slice(0, colonIdx).trim()
    const simTime = sim.simTime ?? 50

    const timesteps = new Set<number>()
    for (const segment of tPart.split(',')) {
      const seg = segment.trim()
      const rangeMatch = seg.match(/^(\d+)-(\d+)$/)
      if (rangeMatch) {
        const t1 = parseInt(rangeMatch[1], 10)
        const t2 = parseInt(rangeMatch[2], 10)
        if (t1 > t2) { setScheduleError(`Range ${seg}: start must be ≤ end`); return }
        if (t2 >= simTime) { setScheduleError(`Timestep ${t2} out of range (0–${simTime - 1})`); return }
        for (let t = t1; t <= t2; t++) timesteps.add(t)
      } else {
        const t = parseInt(seg, 10)
        if (isNaN(t) || t < 0) { setScheduleError('Timestep must be a non-negative integer'); return }
        if (t >= simTime) { setScheduleError(`Timestep ${t} out of range (0–${simTime - 1})`); return }
        timesteps.add(t)
      }
    }
    if (timesteps.size === 0) return

    const inputIds = new Set(network.Inputs ?? [])
    const nameToId = new Map<string, number>()
    for (const node of network.Nodes) {
      if (node.name && inputIds.has(node.id)) nameToId.set(node.name, node.id)
    }

    const validIds: number[] = []
    const invalidTokens: string[] = []
    for (const raw of scheduleText.slice(colonIdx + 1).split(',')) {
      const token = raw.trim()
      if (!token) continue
      if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
        const name = token.slice(1, -1)
        const id = nameToId.get(name)
        if (id !== undefined) validIds.push(id)
        else invalidTokens.push(token)
      } else {
        const n = parseInt(token, 10)
        if (!isNaN(n) && inputIds.has(n)) validIds.push(n)
        else invalidTokens.push(token)
      }
    }

    for (const t of timesteps) {
      sim.setScheduleAt(t, validIds)
    }
    setScheduleVersion(v => v + 1)
    if (invalidTokens.length > 0) {
      setScheduleError(`Unknown: ${invalidTokens.join(', ')}`)
    } else {
      setScheduleText('')
      setDraftTimestep(null)
      setScheduleError(null)
    }
    if (Math.min(...timesteps) < sim.timestep) sim.seek(sim.timestep)
  }

  function handleDeleteSchedule(t: number) {
    sim.setScheduleAt(t, [])
    setScheduleVersion(v => v + 1)
    if (draftTimestep === t) setDraftTimestep(null)
    if (t <= sim.timestep) sim.seek(t)
  }

  async function handleUploadToLibrary() {
    if (!network || !uploadForm.name || !uploadForm.submitter_name) return
    setUploading(true)
    const layoutMap = canvasRef.current?.getLayoutMap()
    const networkWithCoords: RispNetwork = layoutMap
      ? {
          ...network,
          Nodes: network.Nodes.map(n => {
            const pos = layoutMap.get(n.id)
            return pos ? { ...n, coords: pos } : n
          }),
        }
      : network
    const fd = new FormData()
    const blob = new Blob([JSON.stringify(networkWithCoords)], { type: 'application/json' })
    const filename = pendingFile?.name ?? 'network.json'
    fd.append('file', new File([blob], filename, { type: 'application/json' }))
    fd.append('name', uploadForm.name)
    fd.append('submitter_name', uploadForm.submitter_name)
    if (uploadForm.description) fd.append('description', uploadForm.description)
    if (uploadForm.tags) fd.append('tags', uploadForm.tags)
    try {
      await api.uploadNetwork(fd)
      setUploadSuccess(true)
      setShowUploadForm(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="px-4">
      <div className="flex items-center justify-between py-4 border-b border-border">
        <div className="flex items-center gap-5">
          <span className="font-mono text-sm font-medium text-text-primary">Sandbox</span>
          {network && (
            <>
              <span className="font-mono text-xs text-text-muted">
                {meta?.name ?? pendingFile?.name ?? 'Unnamed'}
              </span>
              {meta && (
                <span className="font-mono text-xs text-text-muted opacity-50">
                  by {meta.submitter_name}
                </span>
              )}
            </>
          )}
        </div>
        {network && (
          <button
            onClick={() => { setNetwork(null); setMeta(null); setPendingFile(null); setLoadMode(null) }}
            className="font-mono text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            ← Load different
          </button>
        )}
      </div>

      {(error || sim.error) && (
        <div className="mt-4 border border-border px-3 py-2 font-mono text-xs text-text-muted">
          Error: {error ?? sim.error}
        </div>
      )}

      {loading && (
        <div className="py-16 font-mono text-xs text-text-muted">Loading network...</div>
      )}

      {!loading && !network && (
        <div className="py-8">
          {/* Two equal-weight entry points — shown side by side before any mode is chosen */}
          {loadMode === null ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 border border-border divide-y sm:divide-y-0 sm:divide-x divide-border">
              <button
                onClick={() => setLoadMode('upload')}
                className="group flex flex-col items-start gap-3 px-8 py-10 text-left hover:bg-raised transition-colors"
              >
                <span className="font-mono text-xs text-text-muted tracking-widest uppercase group-hover:text-text-secondary transition-colors">
                  Upload file
                </span>
                <span className="font-mono text-xl text-text-primary leading-snug">
                  Load a RISP network<br />from a JSON file
                </span>
                <span className="font-mono text-xs text-text-muted mt-1 group-hover:text-text-secondary transition-colors">
                  Drop or browse → open →
                </span>
              </button>
              <button
                onClick={() => setLoadMode('create')}
                className="group flex flex-col items-start gap-3 px-8 py-10 text-left hover:bg-raised transition-colors"
              >
                <span className="font-mono text-xs text-text-muted tracking-widest uppercase group-hover:text-text-secondary transition-colors">
                  Create new
                </span>
                <span className="font-mono text-xl text-text-primary leading-snug">
                  Build a network<br />from scratch
                </span>
                <span className="font-mono text-xs text-text-muted mt-1 group-hover:text-text-secondary transition-colors">
                  Configure parameters → draw neurons →
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4 border-b border-border pb-3">
                {(['upload', 'create'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setLoadMode(mode)}
                    className={`font-mono text-xs transition-colors ${
                      loadMode === mode
                        ? 'text-text-primary underline underline-offset-[5px] decoration-text-muted decoration-1'
                        : 'text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    {mode === 'upload' ? 'Upload file' : 'Create new'}
                  </button>
                ))}
                <button
                  onClick={() => setLoadMode(null)}
                  className="ml-auto font-mono text-xs text-text-muted hover:text-text-secondary transition-colors"
                >
                  ← back
                </button>
              </div>
              {loadMode === 'upload' ? (
                <UploadZone onLoad={handleFileLoad} />
              ) : (
                <NetworkCreator onCreate={net => handleFileLoad(net, new File([''], 'new-network.json'))} />
              )}
            </div>
          )}
        </div>
      )}

      {network && (
        <div className="py-6 space-y-4">
          <div className="flex border border-border divide-x divide-border">
            {[
              ['Neurons', network.Nodes?.length ?? '?'],
              ['Synapses', network.Edges?.length ?? '?'],
              ['Inputs', network.Inputs?.length ?? '?'],
              ['Outputs', network.Outputs?.length ?? '?'],
            ].map(([label, value]) => (
              <div key={label as string} className="flex-1 px-4 py-2.5">
                <span className="font-mono text-2xs text-text-muted block mb-0.5">{label}</span>
                <span className="font-mono text-base font-medium text-text-primary">{value}</span>
              </div>
            ))}
          </div>

          <div className="flex relative">
            {/* Left column — its height defines the sidebar's bounds (canvas top → raster bottom) */}
            <div className="flex-1 min-w-0 space-y-4 pr-[20rem]">
              <NetworkCanvas
                ref={canvasRef}
                network={network}
                onChange={(net) => {
                  const onlyNodesAdded =
                    JSON.stringify(network.Edges) === JSON.stringify(net.Edges) &&
                    JSON.stringify(network.Inputs) === JSON.stringify(net.Inputs) &&
                    JSON.stringify(network.Outputs) === JSON.stringify(net.Outputs) &&
                    net.Nodes.length > network.Nodes.length
                  if (onlyNodesAdded) sim.silentNetworkUpdate(net)
                  else sim.softReload(net)
                  setNetwork(net)
                }}
                readOnly={sim.running}
                externalSelection={externalSelection}
                spikingNodeIds={sim.spikes}
                spikeTransits={sim.transits}
              />
              <SimControls
                loaded={sim.loaded}
                running={sim.running}
                timestep={sim.timestep}
                simTime={sim.simTime}
                completed={sim.completed}
                onStep={sim.step}
                onBack={() => sim.seek(Math.max(0, sim.timestep - 1))}
                onPlay={sim.play}
                onPause={sim.pause}
                onReset={() => {
                  sim.reset()
                  setScheduleVersion(v => v + 1)
                  setDraftTimestep(null)
                  setScheduleText('')
                  setScheduleError(null)
                }}
                onRewind={() => sim.seek(0)}
                onSeek={sim.seek}
              />

              {/* Schedule — always visible */}
              <div>
                <SpikeInputPanel
                  inputIds={network.Inputs ?? []}
                  displayTimestep={sim.timestep}
                  displayIds={currentSchedule}
                  onToggle={handleToggle}
                  onAll={handleAll}
                  onNone={handleNone}
                />
                <ScheduleList
                  entries={scheduledEntries}
                  draftTimestep={draftTimestep}
                  scheduleText={scheduleText}
                  scheduleError={scheduleError}
                  onEdit={handleOpenDraft}
                  onDelete={handleDeleteSchedule}
                  onTextChange={(text) => { setScheduleText(text); setScheduleError(null) }}
                  onTextApply={handleScheduleTextApply}
                  onTextCancel={() => { setScheduleText(''); setScheduleError(null); setDraftTimestep(null) }}
                />
              </div>

              {/* Explorer / Raster tabs */}
              <div>
                <div className="flex border border-border border-b-0">
                  {(['raster', 'explorer'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setBottomTab(tab)}
                      className={`px-4 py-2 font-mono text-2xs tracking-widest uppercase border-r last:border-r-0 border-border transition-colors ${
                        bottomTab === tab
                          ? 'text-text-secondary'
                          : 'text-text-muted hover:text-text-secondary'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className={bottomTab === 'explorer' ? '' : 'hidden'}>
                  <NetworkExplorer
                    network={network}
                    selNodeId={explorerSelNodeId}
                    selEdgeId={explorerSelEdgeId}
                    onSelectNode={(id) => { setExplorerSelNodeId(id); setExplorerSelEdgeId(null) }}
                    onSelectEdge={(id) => { setExplorerSelEdgeId(id); setExplorerSelNodeId(null) }}
                  />
                </div>

                <div className={bottomTab === 'raster' ? '' : 'hidden'}>
                  <SpikeRaster
                    history={sim.history}
                    nodeIds={nodeIds}
                    nodeNames={nodeNames}
                  />
                </div>
              </div>
            </div>

            {/* Right sidebar — absolutely positioned so left column alone determines row height;
                sidebar fills top→bottom of that height, PropertiesPanel scrolls internally */}
            <div className="absolute right-0 top-0 bottom-0 w-[19rem] flex flex-col">
              <PropertiesPanel
                network={network}
                potentials={sim.potentials}
                nodeNames={nodeNames}
                spikeTransits={sim.transits}
                timestep={sim.timestep}
              />
            </div>
          </div>

          {pendingFile && !uploadSuccess && (
            <div className="border border-border">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <span className="font-mono text-xs text-text-muted">Share with the community</span>
                <button
                  onClick={() => setShowUploadForm((v) => !v)}
                  className="font-mono text-xs text-text-muted hover:text-text-secondary transition-colors"
                >
                  {showUploadForm ? 'Cancel' : 'Upload to library →'}
                </button>
              </div>
              {showUploadForm && (
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    placeholder="Network name *"
                    value={uploadForm.name}
                    onChange={(e) => setUploadForm((f) => ({ ...f, name: e.target.value }))}
                    className="px-3 py-2 font-mono text-xs bg-bg border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-muted transition-colors"
                  />
                  <input
                    placeholder="Your name *"
                    value={uploadForm.submitter_name}
                    onChange={(e) => setUploadForm((f) => ({ ...f, submitter_name: e.target.value }))}
                    className="px-3 py-2 font-mono text-xs bg-bg border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-muted transition-colors"
                  />
                  <input
                    placeholder="Tags (comma-separated)"
                    value={uploadForm.tags}
                    onChange={(e) => setUploadForm((f) => ({ ...f, tags: e.target.value }))}
                    className="px-3 py-2 font-mono text-xs bg-bg border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-muted transition-colors"
                  />
                  <textarea
                    placeholder="Description (optional)"
                    value={uploadForm.description}
                    onChange={(e) => setUploadForm((f) => ({ ...f, description: e.target.value }))}
                    rows={1}
                    className="px-3 py-2 font-mono text-xs bg-bg border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-muted transition-colors resize-none"
                  />
                  <div className="sm:col-span-2">
                    <button
                      onClick={handleUploadToLibrary}
                      disabled={uploading || !uploadForm.name || !uploadForm.submitter_name}
                      className="font-mono text-xs text-text-muted border border-border px-4 py-2 hover:border-text-muted hover:text-text-secondary transition-colors disabled:opacity-30"
                    >
                      {uploading ? 'Uploading...' : 'Submit to library →'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {uploadSuccess && (
            <div className="border border-border px-4 py-3 font-mono text-xs text-text-secondary">
              Network uploaded. It will appear in the library shortly.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
