/**
 * The Kindred marks, in whichever ink suits the current theme.
 *
 * There are two artwork pairs — forest ink for light chrome, cream for dark —
 * and the rule is to swap the asset rather than recolour it at runtime. Both
 * are rendered and CSS hides the wrong one, so the right mark is painted on
 * the first frame with no flash and no JavaScript.
 *
 * The older `/kindred-icon.svg` and `/kindred-wordmark.svg` predate the
 * redesign: they carry a light plate behind the mark and dark ink, so on the
 * near-black chrome they read as an illegible smudge.
 */
export function BrandMark({ className, size = 48 }: { className?: string; size?: number }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" width={size} height={size}
        className={className} data-mark-theme="light" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-light.svg" alt="" width={size} height={size}
        className={className} data-mark-theme="dark" />
    </>
  );
}

export function BrandWordmark({ className, alt = "Kindred" }: { className?: string; alt?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/wordmark.svg" alt={alt} className={className} data-mark-theme="light" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/wordmark-light.svg" alt={alt} className={className} data-mark-theme="dark" />
    </>
  );
}
