import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import type { NetworkMeta } from '@shared/types'
import { api } from '../../lib/api'

interface Props {
  network: NetworkMeta
  onVote?: () => void
}

export default function NetworkCard({ network, onVote }: Props) {
  const navigate = useNavigate()
  const [voting, setVoting] = useState(false)
  const [voted, setVoted] = useState(network.user_voted)
  const [displayCount, setDisplayCount] = useState(network.vote_count)

  async function handleVote(e: React.MouseEvent) {
    e.stopPropagation()
    setVoting(true)
    try {
      if (voted) {
        await api.unvote(network.id)
        setVoted(false)
        setDisplayCount((c) => c - 1)
      } else {
        await api.vote(network.id)
        setVoted(true)
        setDisplayCount((c) => c + 1)
      }
      onVote?.()
    } catch (err) {
      console.error(err)
    } finally {
      setVoting(false)
    }
  }

  const date = new Date(network.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })

  return (
    <tr
      onClick={() => navigate(`/sandbox?id=${network.id}`)}
      title={`Open "${network.name}" in the sandbox`}
      className="border-t border-border hover:bg-raised cursor-pointer transition-colors group"
    >
      <td className="py-2.5 pr-6">
        <div className="font-mono text-sm text-text-primary group-hover:text-accent transition-colors">
          {network.name}
        </div>
        {network.description && (
          <div className="text-xs text-text-muted mt-0.5 truncate max-w-sm">
            {network.description}
          </div>
        )}
        <div className="font-mono text-2xs text-text-muted opacity-0 group-hover:opacity-40 transition-opacity mt-0.5">
          open in sandbox →
        </div>
      </td>
      <td className="py-2.5 pr-6 font-mono text-xs text-text-muted hidden sm:table-cell whitespace-nowrap">
        {network.submitter_name}
      </td>
      <td
        className="py-2.5 pr-6 font-mono text-xs text-text-muted hidden md:table-cell whitespace-nowrap"
        title={`${network.neuron_count} neurons · ${network.synapse_count} synapses`}
      >
        {network.neuron_count}n · {network.synapse_count}s
      </td>
      <td className="py-2.5 pr-6 hidden lg:table-cell">
        <div className="flex flex-wrap gap-1">
          {network.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="font-mono text-2xs text-text-muted border border-border px-1.5 py-0.5"
            >
              {tag}
            </span>
          ))}
        </div>
      </td>
      <td className="py-2.5 pr-4 font-mono text-xs text-text-muted hidden sm:table-cell whitespace-nowrap text-right">
        {network.run_count} runs
      </td>
      <td className="py-2.5 pr-4 font-mono text-xs text-text-muted hidden md:table-cell whitespace-nowrap text-right">
        {date}
      </td>
      <td className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={handleVote}
          disabled={voting}
          title={voted ? 'Remove vote' : 'Upvote'}
          className={`font-mono text-xs px-3 py-1.5 border transition-colors disabled:opacity-40 inline-flex items-center gap-1.5 ${
            voted
              ? 'border-accent text-accent hover:opacity-60'
              : 'border-border text-text-muted hover:border-text-muted hover:text-text-secondary'
          }`}
        >
          <span>{voted ? '▲' : '△'}</span>
          <span>{displayCount}</span>
        </button>
      </td>
    </tr>
  )
}
