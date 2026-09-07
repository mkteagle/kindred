import { BrandMark } from "@/components/brand-mark";

/**
 * What the web app shows on a phone.
 *
 * Kindred's mobile experience is the iOS and Android apps — they hold the
 * camera roll upload, background sync and offline cache the browser cannot.
 * Rather than ship a cramped mobile web library that is worse than both, the
 * narrow layout points at the apps.
 *
 * Deliberately CSS-driven, not JavaScript: rendering this on the server for
 * every visitor and letting a media query decide means no hydration mismatch,
 * no flash of the wrong screen, and correct behaviour before JS runs at all.
 *
 * Share links are NOT gated. They live outside this layout group, and a
 * shared album that told the recipient to install an app would defeat the
 * point of sharing.
 */
export function GetTheApp() {
  return (
    <div className="app-gate" role="region" aria-label="Kindred on mobile">
      <div className="app-gate-inner">
        <BrandMark className="app-gate-mark" size={56} />
        <p className="app-gate-eyebrow">KINDRED ON MOBILE</p>
        <h1 className="app-gate-title">Better in the app.</h1>
        <p className="app-gate-lede">
          The apps back up your camera roll on their own, keep recent photos
          available offline, and are built for a phone in a way a browser
          window is not.
        </p>
        <div className="app-gate-actions">
          <a className="button primary" href="https://apps.apple.com/app/kindred-photos/id0000000000">
            Get it for iPhone
          </a>
          <a className="button" href="https://play.google.com/store/apps/details?id=com.kindlingsignal.kindred">
            Get it for Android
          </a>
        </div>
        <p className="app-gate-note">
          Already have it? Open Kindred and scan the pairing code from Settings
          on a computer.
        </p>
        <p className="app-gate-note">
          On a laptop or desktop, the full library is right here — this only
          appears on a narrow screen.
        </p>
      </div>
    </div>
  );
}
