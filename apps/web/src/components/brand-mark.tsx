interface BrandMarkProps {
  className?: string;
  title?: string;
  /** Color of the open path that runs through the block. Defaults to the signal accent. */
  band?: string;
}

/**
 * A sealed block with one open path cut straight through it.
 * The mass is closed; the path enters and leaves untouched.
 * That is the mechanic: cold code is sealed, the hot path runs as written.
 */
export function BrandMark({ className = "", title, band = "#FF3300" }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
      fill="none"
    >
      <path d="M2 2h15l5 5v15H2V2Z" fill="currentColor" />
      <rect x="0" y="10.5" width="24" height="3" fill={band} />
    </svg>
  );
}
