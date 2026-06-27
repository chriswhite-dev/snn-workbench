import { useState, useEffect, useCallback } from 'react'
import type { NetworkMeta } from '@shared/types'
import { api } from '../lib/api'
import LibraryGrid from '../components/library/LibraryGrid'

export default function Library() {
  const [networks, setNetworks] = useState<NetworkMeta[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'created_at' | 'run_count' | 'vote_count'>('created_at')
  const [page, setPage] = useState(1)

  const limit = 20

  const fetchNetworks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getNetworks({ search, sort, page, limit })
      setNetworks(res.data)
      setTotal(res.total)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [search, sort, page])

  useEffect(() => { fetchNetworks() }, [fetchNetworks])
  useEffect(() => { setPage(1) }, [search, sort])

  const totalPages = Math.max(1, Math.ceil(total / limit))
  const start = total === 0 ? 0 : (page - 1) * limit + 1
  const end = Math.min(page * limit, total)

  return (
    <div className="max-w-[1600px] mx-auto px-6">
      <div className="flex items-center justify-between py-4 border-b border-border">
        <div className="flex items-center gap-5">
          <span className="font-mono text-sm font-medium text-text-primary">Network Library</span>
          {!loading && (
            <span className="font-mono text-xs text-text-muted">{total} networks</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-44 px-3 py-1.5 font-mono text-xs bg-surface border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-muted transition-colors"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="px-3 py-1.5 font-mono text-xs bg-surface border border-border text-text-primary focus:outline-none cursor-pointer"
          >
            <option value="created_at">Newest</option>
            <option value="run_count">Most run</option>
            <option value="vote_count">Most voted</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mt-4 font-mono text-xs text-text-muted border border-border px-3 py-2">
          Error: {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 font-mono text-xs text-text-muted">Loading...</div>
      ) : (
        <>
          <LibraryGrid networks={networks} onVote={fetchNetworks} />
          {totalPages > 1 && (
            <div className="border-t border-border py-4 flex items-center justify-between">
              <span className="font-mono text-xs text-text-muted">
                {start}–{end} of {total}
              </span>
              <div className="flex items-center gap-5">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="font-mono text-xs text-text-muted hover:text-text-secondary disabled:opacity-30 transition-colors"
                >
                  ← Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="font-mono text-xs text-text-muted hover:text-text-secondary disabled:opacity-30 transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
