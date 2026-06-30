export default function Footer() {
  return (
    <footer className="border-t border-border mt-auto">
      <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
        <span className="font-mono text-2xs text-text-muted">RISP/SNN Platform · v1.1.1</span>
        <a
          href="https://github.com/TENNLab-UTK/framework-open"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-2xs text-text-muted hover:text-text-secondary transition-colors"
        >
          TENNLab framework-open ↗
        </a>
      </div>
    </footer>
  )
}
