"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/content/i18n";

type Phase = "idle" | "scanning" | "ready";
type NodeKind = "hot" | "cold";
type NodeId =
  | "renderFrame"
  | "lerp"
  | "stepParticles"
  | "validateLicense"
  | "check"
  | "hmac";

interface GraphNode {
  id: NodeId;
  label: string;
  x: number;
  y: number;
  kind: NodeKind;
}

const NODES: GraphNode[] = [
  { id: "renderFrame", label: "renderFrame", x: 80, y: 74, kind: "hot" },
  { id: "lerp", label: "lerp", x: 280, y: 74, kind: "hot" },
  { id: "stepParticles", label: "stepParticles", x: 480, y: 74, kind: "hot" },
  { id: "validateLicense", label: "validateLicense", x: 80, y: 234, kind: "cold" },
  { id: "check", label: "check", x: 280, y: 234, kind: "cold" },
  { id: "hmac", label: "hmac", x: 480, y: 234, kind: "cold" },
];

const EDGES: { from: NodeId; to: NodeId }[] = [
  { from: "renderFrame", to: "lerp" },
  { from: "lerp", to: "stepParticles" },
  { from: "validateLicense", to: "check" },
  { from: "check", to: "hmac" },
];

const NODE_W = 128;
const NODE_H = 34;

const CODE_LINES: { text: string; tone: "plain" | "dim" | "hot" | "cold" | "signal" }[] = [
  { text: "// license-guard.ts", tone: "dim" },
  { text: "export function renderFrame(t) {", tone: "hot" },
  { text: "  for (let i = 0; i < particles.length; i++) {", tone: "hot" },
  { text: "    particles[i].x += lerp(a, b, t);", tone: "hot" },
  { text: "  }", tone: "hot" },
  { text: "}", tone: "hot" },
  { text: "", tone: "plain" },
  { text: "export function validateLicense(key) {", tone: "cold" },
  { text: '  const salt = "uNp33k_v4";', tone: "cold" },
  { text: '  const url = "https://api.unpeek.dev/v1/license";', tone: "cold" },
  { text: "  return check(key, salt, url);", tone: "cold" },
  { text: "}", tone: "cold" },
];

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return reduce;
}

const FRAME_MS = 1000 / 60;

/**
 * Modeled vault cost per frame. The demo loop walks a particle buffer once per
 * frame, so the protected run pays the lookup for every iteration.
 */
function vaultCost(load: number): number {
  return Math.min(48, load * 12);
}

function modeledFps(exempt: boolean, load: number): number {
  if (exempt) return 60;
  return Math.max(8, Math.round(1000 / (FRAME_MS + vaultCost(load))));
}

interface CallGraphLabProps {
  dict: Dictionary;
}

export function CallGraphLab({ dict }: CallGraphLabProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [exempt, setExempt] = useState(true);
  const [load, setLoad] = useState(2);
  const [selected, setSelected] = useState<NodeId>("renderFrame");
  const [fps, setFps] = useState<number | null>(null);
  const [visible, setVisible] = useState(true);
  const reduce = useReducedMotion();

  const shellRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<SVGCircleElement | null>(null);
  const scanTimer = useRef<number | null>(null);

  const ready = phase === "ready";
  const nodeVisible = phase !== "idle";

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "80px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (scanTimer.current) window.clearTimeout(scanTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!ready) {
      setFps(null);
      return;
    }

    if (reduce) {
      setFps(modeledFps(exempt, load));
      return;
    }

    if (!visible) return;

    let raf = 0;
    let frames = 0;
    let reportedAt = performance.now();
    const budget = exempt ? 0 : vaultCost(load);

    const frame = (now: number) => {
      frames++;
      if (dotRef.current) {
        const progress = (now % 1600) / 1600;
        dotRef.current.setAttribute("cx", String(60 + progress * 200));
      }

      if (budget > 0) {
        const until = performance.now() + budget;
        while (performance.now() < until) {
          // modeled vault cost: the loop blocks the frame on purpose
        }
      }

      if (now - reportedAt >= 500) {
        const measured = Math.min(60, Math.round((frames * 1000) / (now - reportedAt)));
        setFps(measured);
        frames = 0;
        reportedAt = now;
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ready, exempt, load, reduce, visible]);

  const start = useCallback(() => {
    if (scanTimer.current) window.clearTimeout(scanTimer.current);
    setPhase("scanning");
    setFps(null);
    scanTimer.current = window.setTimeout(() => {
      setPhase("ready");
      scanTimer.current = null;
    }, reduce ? 60 : 860);
  }, [reduce]);

  const reset = useCallback(() => {
    if (scanTimer.current) window.clearTimeout(scanTimer.current);
    scanTimer.current = null;
    setPhase("idle");
    setFps(null);
    setSelected("renderFrame");
  }, []);

  const decision = (() => {
    if (selected === "renderFrame") return dict.lab.decisionHot;
    if (selected === "lerp" || selected === "stepParticles") return dict.lab.decisionCaller;
    return dict.lab.decisionCold;
  })();

  const activeKind = NODES.find((node) => node.id === selected)?.kind ?? "hot";
  const fpsValue = fps === null ? "--" : String(fps);

  return (
    <div ref={shellRef} className="border border-rule">
      <div className="grid grid-cols-1 lg:grid-cols-12">
        <div className="border-b border-rule bg-carbon p-4 sm:p-5 lg:col-span-5 lg:border-b-0 lg:border-r">
          <div className="mb-4 flex items-center justify-between gap-4 font-mono text-[11px] text-carbon-text/60">
            <span className="whitespace-nowrap">{dict.lab.codeTitle}</span>
            <span className="hidden truncate text-right sm:inline">{dict.lab.codeNote}</span>
          </div>
          <pre className="code-scroll overflow-x-auto text-[11.5px] leading-[1.9] text-carbon-text/80 sm:text-[12.5px]">
            <code>
              {CODE_LINES.map((line, index) => (
                <span
                  key={index}
                  className={
                    line.tone === "dim"
                      ? "block text-carbon-text/55"
                      : line.tone === "hot"
                        ? "block border-l-2 border-signal bg-signal/10 pl-3 text-carbon-text"
                        : line.tone === "cold"
                          ? "block border-l-2 border-carbon-text/45 pl-3 text-carbon-text/90"
                          : "block"
                  }
                >
                  {line.text || "\u00A0"}
                </span>
              ))}
            </code>
          </pre>
        </div>

        <div className="p-4 sm:p-5 lg:col-span-7">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={phase === "idle" ? start : reset}
              className="rounded-[4px] bg-ink px-3.5 py-2 text-[13px] leading-none text-paper transition-colors duration-150 hover:bg-carbon-2 active:scale-[0.98]"
            >
              {phase === "scanning"
                ? `${dict.lab.analyzing}...`
                : phase === "ready"
                  ? dict.lab.reset
                  : dict.lab.analyze}
            </button>

            <button
              type="button"
              onClick={() => setExempt((value) => !value)}
              aria-pressed={exempt}
              disabled={phase === "idle"}
              className="rounded-[4px] border border-rule px-3.5 py-2 text-[13px] leading-none text-ink transition-colors duration-150 hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {exempt ? dict.lab.exemptHot : dict.lab.protectHot}
            </button>

            <label className="ml-auto flex items-center gap-2 font-mono text-[11px] text-ink-2">
              <span className="hidden sm:inline">{dict.lab.particleLoad}</span>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={load}
                onChange={(event) => setLoad(Number(event.target.value))}
                className="h-1 w-20 accent-[#111111]"
                aria-label={dict.lab.particleLoad}
              />
              <span className="tnum w-4 text-right">{load}</span>
            </label>
          </div>

          <svg
            viewBox="0 0 560 300"
            className="mt-4 h-auto w-full"
            role="img"
            aria-label={
              exempt
                ? "Call graph after analysis. Hot chain is exempt, cold chain is protected."
                : "Call graph after analysis. Every chain is protected."
            }
          >
            <text x="0" y="14" className="fill-ink-3 font-mono" fontSize="9" letterSpacing="0.08em">
              {dict.hero.hotLabel}
            </text>
            <text x="0" y="194" className="fill-ink-3 font-mono" fontSize="9" letterSpacing="0.08em">
              {dict.hero.coldLabel}
            </text>

            {EDGES.map((edge, index) => {
              const from = NODES.find((node) => node.id === edge.from)!;
              const to = NODES.find((node) => node.id === edge.to)!;
              const x1 = from.x + NODE_W / 2 + 2;
              const x2 = to.x - NODE_W / 2 - 2;
              const isHot = from.kind === "hot";
              const muted = isHot && !exempt && ready;
              return (
                <line
                  key={`${edge.from}-${edge.to}`}
                  x1={x1}
                  y1={from.y}
                  x2={x2}
                  y2={to.y}
                  stroke={isHot ? "#FF3300" : "#111111"}
                  strokeOpacity={muted ? 0.25 : 0.45}
                  strokeWidth="1.2"
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={nodeVisible ? 0 : 1}
                  style={{
                    transition: `stroke-dashoffset 340ms cubic-bezier(0.22,1,0.36,1) ${
                      nodeVisible ? 120 + index * 70 : 0
                    }ms, stroke-opacity 180ms linear`,
                  }}
                />
              );
            })}

            {NODES.map((node, index) => {
              const isSelected = selected === node.id;
              const hot = node.kind === "hot";
              const active = hot ? exempt : true;
              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.label} ${hot ? dict.lab.legendHot : dict.lab.legendCold}`}
                  onClick={() => setSelected(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(node.id);
                    }
                  }}
                  className="cursor-pointer"
                  style={{
                    opacity: nodeVisible ? 1 : 0,
                    transform: nodeVisible ? "translateY(0)" : "translateY(6px)",
                    transition: `opacity 260ms cubic-bezier(0.22,1,0.36,1) ${
                      nodeVisible ? index * 60 : 0
                    }ms, transform 260ms cubic-bezier(0.22,1,0.36,1) ${
                      nodeVisible ? index * 60 : 0
                    }ms`,
                  }}
                >
                  <rect
                    x={node.x - NODE_W / 2}
                    y={node.y - NODE_H / 2}
                    width={NODE_W}
                    height={NODE_H}
                    rx="4"
                    fill={hot && active ? "#FF3300" : "#111111"}
                    fillOpacity={hot && !active ? 0.12 : hot ? 0.92 : 0.92}
                    stroke={isSelected ? "#FF3300" : hot ? "#FF3300" : "#111111"}
                    strokeWidth={isSelected ? 2 : 1}
                    strokeOpacity={isSelected ? 1 : 0.5}
                  />
                  <text
                    x={node.x}
                    y={node.y + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fontFamily="var(--font-ioskeley), monospace"
                    fill={hot && active ? "#F2F0E9" : hot && !active ? "#5C594F" : "#EDEAE1"}
                  >
                    {node.label}
                  </text>
                  {hot && (
                    <text
                      x={node.x}
                      y={node.y + NODE_H / 2 + 12}
                      textAnchor="middle"
                      fontSize="8.5"
                      fontFamily="var(--font-ioskeley), monospace"
                      fill={active ? "#FF3300" : "#6E6A5E"}
                      letterSpacing="0.06em"
                    >
                      {active ? dict.lab.legendHot.toUpperCase() : dict.lab.legendCold.toUpperCase()}
                    </text>
                  )}
                </g>
              );
            })}

            <circle ref={dotRef} cx="60" cy="286" r="3" fill="#FF3300" opacity={ready ? 1 : 0} />
            <line x1="60" y1="286" x2="260" y2="286" stroke="#D5D0C2" strokeWidth="1" />
          </svg>

          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-rule pt-3 sm:grid-cols-[160px_1fr]">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3">
                {dict.lab.fpsLabel}
              </div>
              <div className="tnum mt-1 flex items-baseline gap-1.5">
                <span
                  className={`font-display text-[34px] leading-none tracking-[-0.03em] ${
                    !ready ? "text-ink-3" : exempt ? "text-ink" : "text-signal"
                  }`}
                >
                  {fpsValue}
                </span>
                <span className="font-mono text-[11px] text-ink-3">fps</span>
              </div>
              <div className="tnum mt-1 font-mono text-[10.5px] leading-4 text-ink-3">
                {ready
                  ? `${(FRAME_MS + (exempt ? 0 : vaultCost(load))).toFixed(1)} ms per frame`
                  : "16.7 ms budget"}
              </div>
              <p className="mt-1.5 text-[12px] leading-5 text-ink-2">
                {exempt ? dict.lab.hotFpsCaption : dict.lab.coldFpsCaption}
              </p>
            </div>

            <div className="border-l-0 border-rule pl-0 sm:border-l sm:pl-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-ink-3">
                {dict.lab.evidence}
              </div>
              <div className="mt-1 flex items-center gap-2 font-mono text-[12px] text-ink">
                <span
                  className={`inline-block h-2 w-2 ${activeKind === "hot" ? "bg-signal" : "bg-ink"}`}
                />
                {NODES.find((node) => node.id === selected)?.label}
              </div>
              <p className="mt-1.5 text-[12px] leading-5 text-ink-2">{decision}</p>
            </div>
          </div>

          <p className="mt-3 font-mono text-[10.5px] leading-4 text-ink-3">
            {dict.lab.disclaimer}
          </p>
        </div>
      </div>
    </div>
  );
}
