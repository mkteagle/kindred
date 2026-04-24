export function FoxMark({ size = 80 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      fill="none"
      aria-label="Kindling Signal"
    >
      {/* Signal arcs */}
      <path d="M 84,32 Q 100,18 116,32" stroke="#00a8c8" strokeWidth="2.5" fill="none" opacity="0.55" strokeLinecap="round" />
      <path d="M 74,24 Q 100,8 126,24" stroke="#00a8c8" strokeWidth="2.2" fill="none" opacity="0.42" strokeLinecap="round" />
      <path d="M 60,18 Q 100,0 140,18" stroke="#00a8c8" strokeWidth="2" fill="none" opacity="0.32" strokeLinecap="round" />
      <path d="M 40,14 Q 100,-8 160,14" stroke="#00a8c8" strokeWidth="1.6" fill="none" opacity="0.22" strokeLinecap="round" />
      <path d="M 22,10 Q 100,-14 178,10" stroke="#00a8c8" strokeWidth="1.2" fill="none" opacity="0.14" strokeLinecap="round" />
      {/* Ears */}
      <polygon points="50,90 30,18 75,60" fill="#23606a" />
      <polygon points="150,90 170,18 125,60" fill="#23606a" />
      <polygon points="42,55 30,18 60,50" fill="#1a1a2e" opacity="0.7" />
      <polygon points="158,55 170,18 140,50" fill="#1a1a2e" opacity="0.7" />
      {/* Face */}
      <polygon points="50,90 75,60 100,115 60,140" fill="#23606a" opacity="0.88" />
      <polygon points="150,90 125,60 100,115 140,140" fill="#23606a" opacity="0.88" />
      <polygon points="75,60 125,60 100,115" fill="#23606a" />
      {/* Chin */}
      <polygon points="60,140 100,115 140,140 100,172" fill="#00a8c8" opacity="0.82" />
      {/* Nose + eyes */}
      <polygon points="92,142 108,142 100,156" fill="#1a1a2e" />
      <circle cx="82" cy="96" r="4" fill="#1a1a2e" />
      <circle cx="118" cy="96" r="4" fill="#1a1a2e" />
    </svg>
  );
}

export function KindlingFooter() {
  return (
    <footer className="ks-footer">
      <div className="ks-footer-inner">
        <div className="ks-footer-brand">
          <div className="ks-brand-badge">
            <img src="/kindred-icon.png" alt="" className="ks-brand-icon" />
          </div>
          <div className="ks-footer-info">
            <span className="ks-footer-label">By Kindling Signal</span>
            <h3 className="ks-footer-title">Kindred</h3>
            <p className="ks-footer-tagline">A calmer home for family photos.</p>
          </div>
        </div>

        <div className="ks-footer-body">
          <p>
            Kindred helps a household find the people, places, and moments that matter
            without turning the photo library into a technical project.
          </p>
          <p>
            Kindling Signal builds useful software with character: warm enough for real homes,
            sharp enough to hold up in real use.
          </p>
        </div>

        <div className="ks-footer-links">
          <a href="https://bykindling.com" target="_blank" rel="noopener noreferrer">
            bykindling.com
          </a>
          <a href="https://github.com/mkteagle" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a href="mailto:sayhello@bykindling.com">
            sayhello@bykindling.com
          </a>
        </div>
      </div>
    </footer>
  );
}
