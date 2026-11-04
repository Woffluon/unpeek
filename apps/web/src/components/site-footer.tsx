import Link from "next/link";
import type { Dictionary } from "@/content/i18n";
import { BrandMark } from "@/components/brand-mark";

export function SiteFooter({ dict }: { dict: Dictionary }) {
  return (
    <footer className="border-t border-rule">
      <div className="shell flex flex-col gap-8 py-12 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <BrandMark className="text-ink" />
            <span className="text-[15px] font-medium leading-none tracking-[-0.02em]">
              unpeek
            </span>
            <span className="font-mono text-[11px] text-ink-3">{dict.meta.version}</span>
          </div>
          <p className="max-w-[42ch] text-[13px] leading-6 text-ink-2">{dict.footer.tagline}</p>
        </div>

        <nav className="flex flex-wrap items-center gap-x-7 gap-y-3" aria-label="Footer">
          <Link
            href="/docs"
            className="text-[13px] text-ink-2 transition-colors duration-150 hover:text-ink"
          >
            {dict.footer.links.docs}
          </Link>
          <a
            href="https://github.com/Woffluon/unpeek"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-ink-2 transition-colors duration-150 hover:text-ink"
          >
            {dict.footer.links.github}
          </a>
          <a
            href="https://www.npmjs.com/package/unpeek"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-ink-2 transition-colors duration-150 hover:text-ink"
          >
            {dict.footer.links.npm}
          </a>
        </nav>
      </div>

      <div className="border-t border-rule">
        <div className="shell flex flex-col gap-2 py-4 font-mono text-[11px] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <span>{dict.footer.license}</span>
          <span>hot path untouched</span>
        </div>
      </div>
    </footer>
  );
}
