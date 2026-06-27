import { Link } from 'react-router-dom'
import type { NetworkMeta } from '@shared/types'
import NetworkCard from './NetworkCard'

interface Props {
  networks: NetworkMeta[]
  onVote?: () => void
}

export default function LibraryGrid({ networks, onVote }: Props) {
  if (networks.length === 0) {
    return (
      <div className="border-t border-border py-16 flex flex-wrap items-center gap-6">
        <p className="font-mono text-xs text-text-muted">No networks found.</p>
        <Link
          to="/sandbox"
          className="font-mono text-xs text-text-muted border border-border px-3 py-1.5 hover:border-text-muted hover:text-text-secondary transition-colors"
        >
          Create one in the sandbox →
        </Link>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th className="pb-3 pt-1 text-left font-mono text-2xs text-text-muted tracking-widest uppercase">
              Name
            </th>
            <th className="pb-3 pt-1 text-left font-mono text-2xs text-text-muted tracking-widest uppercase hidden sm:table-cell">
              Author
            </th>
            <th className="pb-3 pt-1 text-left font-mono text-2xs text-text-muted tracking-widest uppercase hidden md:table-cell">
              Size
            </th>
            <th className="pb-3 pt-1 text-left font-mono text-2xs text-text-muted tracking-widest uppercase hidden lg:table-cell">
              Tags
            </th>
            <th className="pb-3 pt-1 text-right font-mono text-2xs text-text-muted tracking-widest uppercase hidden sm:table-cell">
              Runs
            </th>
            <th className="pb-3 pt-1 text-right font-mono text-2xs text-text-muted tracking-widest uppercase hidden md:table-cell">
              Date
            </th>
            <th className="pb-3 pt-1" />
          </tr>
        </thead>
        <tbody>
          {networks.map((n) => (
            <NetworkCard key={n.id} network={n} onVote={onVote} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
