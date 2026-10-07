/* eslint-disable @next/next/no-img-element */

/**
 * Trigon brand mark: two interlaced triangles (the trigon) joined by a single ribbon.
 * Artwork lives in /public/brand (transparent mark) and /public/icons (app-icon tiles).
 *   variant="mark" — bare symbol, works on light and dark backgrounds
 *   variant="tile" — app-icon tile (navy)
 */
export function LogoMark({ size = 32, variant = 'mark', className = '' }: { size?: number; variant?: 'mark' | 'tile'; className?: string }) {
  return (
    <img
      src={variant === 'tile' ? '/icons/icon.svg' : '/brand/trigon-mark.svg'}
      width={size}
      height={size}
      alt="Trigon"
      className={`shrink-0 select-none ${className}`}
      draggable={false}
    />
  );
}

/** Mark + wordmark lockup, optionally with the "Collaborative workspace" tagline. */
export function Logo({ size = 32, tagline = false, className = '' }: { size?: number; tagline?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span className="leading-none">
        <span className="block font-brand font-bold tracking-[0.06em] text-ink" style={{ fontSize: size * 0.62 }}>
          TRIGON
        </span>
        {tagline && (
          <span className="mt-1 block font-brand font-medium uppercase tracking-[0.22em] text-ink-3" style={{ fontSize: Math.max(8, size * 0.22) }}>
            Collaborative workspace
          </span>
        )}
      </span>
    </span>
  );
}
