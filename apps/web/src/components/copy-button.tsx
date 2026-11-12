"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface CopyButtonProps {
  text: string;
  copyLabel: string;
  copiedLabel: string;
  className?: string;
}

export function CopyButton({ text, copyLabel, copiedLabel, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [text]);

  return (
    <button type="button" onClick={handleCopy} className={className}>
      {copied ? copiedLabel : copyLabel}
    </button>
  );
}

export function HeroCopyCommand({
  command,
  copyLabel,
  copiedLabel,
}: {
  command: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(command);
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [command]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="group flex items-center justify-between gap-6 rounded-[3px] bg-ink px-3.5 py-3 text-left transition-colors duration-150 hover:bg-carbon-2 active:scale-[0.99]"
    >
      <span className="flex items-center gap-2 font-mono text-[13px] text-paper">
        <span className="text-paper/45" aria-hidden="true">
          $
        </span>
        {command}
      </span>
      <span className="shrink-0 border-l border-paper/20 pl-3 font-mono text-[11px] text-paper/70">
        {copied ? copiedLabel : copyLabel}
      </span>
    </button>
  );
}
