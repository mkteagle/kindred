export function FoxMark({ size = 80 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      fill="none"
      aria-label="Kindling Signal"
    >
      {/* Signal arcs — ember/gold tones */}
      <path d="M 84,32 Q 100,18 116,32" stroke="#e9b85d" strokeWidth="2.5" fill="none" opacity="0.55" strokeLinecap="round" />
      <path d="M 74,24 Q 100,8 126,24" stroke="#e9b85d" strokeWidth="2.2" fill="none" opacity="0.42" strokeLinecap="round" />
      <path d="M 60,18 Q 100,0 140,18" stroke="#e9b85d" strokeWidth="2" fill="none" opacity="0.32" strokeLinecap="round" />
      <path d="M 40,14 Q 100,-8 160,14" stroke="#e9b85d" strokeWidth="1.6" fill="none" opacity="0.22" strokeLinecap="round" />
      <path d="M 22,10 Q 100,-14 178,10" stroke="#e9b85d" strokeWidth="1.2" fill="none" opacity="0.14" strokeLinecap="round" />
      {/* Ears */}
      <polygon points="50,90 30,18 75,60" fill="#c9551c" />
      <polygon points="150,90 170,18 125,60" fill="#c9551c" />
      <polygon points="42,55 30,18 60,50" fill="#6d3c24" opacity="0.7" />
      <polygon points="158,55 170,18 140,50" fill="#6d3c24" opacity="0.7" />
      {/* Face */}
      <polygon points="50,90 75,60 100,115 60,140" fill="#c9551c" opacity="0.88" />
      <polygon points="150,90 125,60 100,115 140,140" fill="#c9551c" opacity="0.88" />
      <polygon points="75,60 125,60 100,115" fill="#c9551c" />
      {/* Chin */}
      <polygon points="60,140 100,115 140,140 100,172" fill="#e9b85d" opacity="0.82" />
      {/* Nose + eyes */}
      <polygon points="92,142 108,142 100,156" fill="#2a201b" />
      <circle cx="82" cy="96" r="4" fill="#2a201b" />
      <circle cx="118" cy="96" r="4" fill="#2a201b" />
    </svg>
  );
}

export function KindlingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="ks-footer">
      <div className="ks-footer-inner">
        <div className="ks-footer-top">
          <div className="ks-footer-brand">
            <FoxMark size={48} />
            <div className="ks-footer-info">
              <span className="ks-footer-label">By Kindling Signal</span>
              <p className="ks-footer-tagline">
                Useful software with character — warm enough for real homes,
                sharp enough to hold up in real use.
              </p>
            </div>
          </div>
        </div>

        <div className="ks-footer-mid">
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
          <div className="ks-footer-legal-links">
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
          </div>
        </div>

        <div className="ks-footer-bottom">
          <p className="ks-footer-copyright">
            &copy; {year} Kindling Signal. All rights reserved.
          </p>
          <p className="ks-footer-copyright">
            Kindred Photos is a product of Kindling Signal. Licensed under AGPL-3.0.
          </p>
        </div>
      </div>
    </footer>
  );
}
