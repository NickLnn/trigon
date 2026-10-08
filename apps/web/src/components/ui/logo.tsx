/* eslint-disable @next/next/no-img-element */

/**
 * Trigon brand mark, rendered from the master artwork (brand-src/trigon-logo-original.png via
 * scripts/generate-icons.mjs). On light surfaces it sits on its navy tile, as in the original design;
 * on dark surfaces the transparent cut-out is used. The switch is pure CSS (.brand-on-light/-dark).
 */
export function LogoMark({ size = 32, variant = 'auto', className = '' }: { size?: number; variant?: 'auto' | 'tile' | 'onDark'; className?: string }) {
  const tile = (
    <img src="/icons/icon-192.png" width={size} height={size} alt="Trigon" draggable={false} className={`shrink-0 select-none ${className}`} />
  );
  if (variant === 'tile') return tile;
  if (variant === 'onDark') {
    return <img src="/brand/trigon-mark.png" width={size} height={size} alt="Trigon" draggable={false} className={`shrink-0 select-none ${className}`} />;
  }
  return (
    <>
      <span className="brand-on-light inline-flex">{tile}</span>
      <img
        src="/brand/trigon-mark.png"
        width={size}
        height={size}
        alt="Trigon"
        draggable={false}
        className={`brand-on-dark shrink-0 select-none ${className}`}
      />
    </>
  );
}

/** Mark + wordmark lockup, optionally with the "Collaborative workspace" tagline. */
export function Logo({ size = 32, tagline = false, onDark = false, className = '' }: { size?: number; tagline?: boolean; onDark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} variant={onDark ? 'onDark' : 'auto'} />
      <span className="leading-none">
        <span className={`block font-brand font-bold tracking-[0.06em] ${onDark ? 'text-white' : 'text-ink'}`} style={{ fontSize: size * 0.62 }}>
          TRIGON
        </span>
        {tagline && (
          <span className={`mt-1 block font-brand font-medium uppercase tracking-[0.22em] ${onDark ? 'text-navy-ink-3' : 'text-ink-3'}`} style={{ fontSize: Math.max(8, size * 0.22) }}>
            Collaborative workspace
          </span>
        )}
      </span>
    </span>
  );
}
