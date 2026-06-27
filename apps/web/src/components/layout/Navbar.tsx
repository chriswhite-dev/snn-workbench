import { Link, useLocation } from 'react-router-dom'

const links = [
  { to: '/library', label: 'Library' },
  { to: '/sandbox', label: 'Sandbox' },
  { to: '/about', label: 'About' },
]

export default function Navbar() {
  const { pathname } = useLocation()

  return (
    <nav className="border-b border-border bg-bg sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-6 h-11 flex items-center justify-between">
        <Link to="/" className="font-mono text-sm font-medium text-text-primary tracking-tight">
          RISP<span className="text-text-muted mx-0.5">·</span>SNN
        </Link>
        <div className="flex items-center gap-7">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`font-mono text-xs tracking-wide transition-colors ${
                pathname === to
                  ? 'text-text-primary underline underline-offset-[7px] decoration-accent decoration-1'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}
