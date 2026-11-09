interface TickerLine {
  text: string;
  hot?: boolean;
}

const SOURCE_LINES: TickerLine[] = [
  { text: "export function stepParticles(dt) {", hot: true },
  { text: "for (let i = 0; i < particles.length; i++) {", hot: true },
  { text: "particles[i].x += lerp(a, b, dt);", hot: true },
  { text: "const endpoint = \"https://licensing.acme.dev/v2/verify\";" },
  { text: "export async function verifyLicense(token) {" },
  { text: "const salt = \"unpeek_prod_hmac_v2_99481a\";" },
  { text: "return check(key, salt, endpoint);" },
];

const PROTECTED_LINES: TickerLine[] = [
  { text: "export function stepParticles(dt) {", hot: true },
  { text: "for (let i = 0; i < particles.length; i++) {", hot: true },
  { text: "particles[i].x += lerp(a, b, dt);", hot: true },
  { text: "const _q1=_a4f[0];" },
  { text: "export async function verifyLicense($k0){" },
  { text: "const $m2=_a4f[1];" },
  { text: "return check($k0,$m2,_q1);}" },
];

function Track({ lines, tone }: { lines: TickerLine[]; tone: "paper" | "carbon" }) {
  const repeated = [...lines, ...lines];
  return (
    <div
      className={`flex w-max ${
        tone === "carbon" ? "ticker-track ticker-track-reverse" : "ticker-track"
      }`}
    >
      {repeated.map((line, index) => (
        <span
          key={`${line.text}-${index}`}
          className={`flex items-center gap-2 whitespace-nowrap pr-10 font-mono text-[11px] leading-none ${
            tone === "carbon" ? "text-carbon-text/75" : "text-ink-2"
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 shrink-0 ${
              line.hot ? "bg-signal" : tone === "carbon" ? "bg-carbon-text/25" : "bg-ink-3/40"
            }`}
            aria-hidden="true"
          />
          {line.text}
        </span>
      ))}
    </div>
  );
}

interface SourceTickerProps {
  sourceLabel: string;
  protectedLabel: string;
}

export function SourceTicker({ sourceLabel, protectedLabel }: SourceTickerProps) {
  return (
    <div className="border-t border-rule">
      <div className="flex items-stretch border-b border-rule">
        <div className="hidden w-[112px] shrink-0 items-center border-r border-rule px-4 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3 sm:flex">
          {sourceLabel}
        </div>
        <div className="ticker min-w-0 flex-1 overflow-hidden bg-paper-2 py-3">
          <Track lines={SOURCE_LINES} tone="paper" />
        </div>
      </div>

      <div className="flex items-stretch">
        <div className="hidden w-[112px] shrink-0 items-center border-r border-carbon-rule bg-carbon px-4 font-mono text-[10px] uppercase tracking-[0.08em] text-carbon-text/50 sm:flex">
          {protectedLabel}
        </div>
        <div className="ticker min-w-0 flex-1 overflow-hidden bg-carbon py-3">
          <Track lines={PROTECTED_LINES} tone="carbon" />
        </div>
      </div>
    </div>
  );
}
