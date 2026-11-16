import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SymbolicateFrame, SymbolicateOptions, SymbolicateResult } from './types.js';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_MAP = new Map<string, number>();
for (let i = 0; i < BASE64_CHARS.length; i++) {
  BASE64_MAP.set(BASE64_CHARS[i], i);
}

const VLQ_BASE_SHIFT = 5;
const VLQ_BASE = 1 << VLQ_BASE_SHIFT;
const VLQ_BASE_MASK = VLQ_BASE - 1;
const VLQ_CONTINUATION_BIT = VLQ_BASE;

export interface SourceMapSection {
  offset: {
    line: number;
    column: number;
  };
  map?: AnySourceMap;
  url?: string;
}

export interface RawSourceMap {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names: string[];
  mappings: string;
  sections?: SourceMapSection[];
  debugId?: string;
  debug_id?: string;
}

export type AnySourceMap = Omit<RawSourceMap, 'sources' | 'names' | 'mappings'> & {
  sources?: string[];
  names?: string[];
  mappings?: string;
  sections?: SourceMapSection[];
};

export interface DecodedMapping {
  generatedLine: number;
  generatedColumn: number;
  sourceIndex: number;
  originalLine: number;
  originalColumn: number;
  nameIndex?: number;
}

export function encodeVlq(value: number): string {
  let vlq = value < 0 ? (-value << 1) + 1 : value << 1;
  let encoded = '';
  do {
    let digit = vlq & VLQ_BASE_MASK;
    vlq >>>= VLQ_BASE_SHIFT;
    if (vlq > 0) {
      digit |= VLQ_CONTINUATION_BIT;
    }
    encoded += BASE64_CHARS[digit];
  } while (vlq > 0);
  return encoded;
}

export function decodeVlq(
  segment: string,
  startIndex: number
): { value: number; nextIndex: number } | null {
  let result = 0;
  let shift = 0;
  let index = startIndex;

  while (index < segment.length) {
    const digit = BASE64_MAP.get(segment[index]);
    if (digit === undefined) {
      return null;
    }
    index++;
    const continuation = (digit & VLQ_CONTINUATION_BIT) !== 0;
    result += (digit & VLQ_BASE_MASK) << shift;
    shift += VLQ_BASE_SHIFT;
    if (!continuation) {
      const isNegative = (result & 1) === 1;
      const shifted = result >> 1;
      return {
        value: isNegative ? -shifted : shifted,
        nextIndex: index,
      };
    }
    if (shift > 30) {
      return null;
    }
  }

  return null;
}

function decodeMappingsString(mappingsStr: string): {
  mappings: DecodedMapping[];
  malformedCount: number;
} {
  const mappings: DecodedMapping[] = [];
  let malformedCount = 0;
  if (!mappingsStr) {
    return { mappings, malformedCount };
  }

  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;

  const lines = mappingsStr.split(';');
  for (let genLine = 0; genLine < lines.length; genLine++) {
    const lineStr = lines[genLine];
    if (!lineStr) continue;

    let genCol = 0;
    const segments = lineStr.split(',');
    for (const seg of segments) {
      if (!seg) continue;

      const values: number[] = [];
      let idx = 0;
      let valid = true;
      while (idx < seg.length) {
        const decoded = decodeVlq(seg, idx);
        if (!decoded) {
          valid = false;
          break;
        }
        values.push(decoded.value);
        idx = decoded.nextIndex;
      }

      if (!valid || (values.length !== 1 && values.length !== 4 && values.length !== 5)) {
        malformedCount++;
        continue;
      }

      genCol += values[0];
      if (values.length >= 4) {
        sourceIndex += values[1];
        originalLine += values[2];
        originalColumn += values[3];
        const mapping: DecodedMapping = {
          generatedLine: genLine,
          generatedColumn: genCol,
          sourceIndex,
          originalLine,
          originalColumn,
        };
        if (values.length === 5) {
          nameIndex += values[4];
          mapping.nameIndex = nameIndex;
        }
        mappings.push(mapping);
      }
    }
  }

  return { mappings, malformedCount };
}

function resolveSourceWithRoot(rawSource: string, sourceRoot?: string): string {
  if (!sourceRoot || !rawSource || rawSource.startsWith(sourceRoot)) {
    return rawSource;
  }
  return `${sourceRoot.replace(/\/$/, '')}/${rawSource.replace(/^\//, '')}`;
}

function flattenSourceMapSectionsWithStats(rawMap: AnySourceMap): {
  map: RawSourceMap;
  malformedCount: number;
} {
  if (!Array.isArray(rawMap.sections)) {
    const normalized: RawSourceMap = {
      version: rawMap.version ?? 3,
      sources: Array.isArray(rawMap.sources) ? [...rawMap.sources] : [],
      names: Array.isArray(rawMap.names) ? [...rawMap.names] : [],
      mappings: typeof rawMap.mappings === 'string' ? rawMap.mappings : '',
    };
    if (rawMap.file !== undefined) normalized.file = rawMap.file;
    if (rawMap.sourceRoot !== undefined) normalized.sourceRoot = rawMap.sourceRoot;
    if (Array.isArray(rawMap.sourcesContent)) {
      normalized.sourcesContent = [...rawMap.sourcesContent];
    }
    const debugId = rawMap.debugId ?? rawMap.debug_id;
    if (debugId) normalized.debugId = debugId;
    return { map: normalized, malformedCount: 0 };
  }

  const mergedSources: string[] = [];
  const mergedSourcesContent: Array<string | null> = [];
  let hasAnySourcesContent = false;
  const sourceIndexMap = new Map<string, number>();

  const mergedNames: string[] = [];
  const nameIndexMap = new Map<string, number>();

  const mergedMappings: DecodedMapping[] = [];
  let totalMalformed = 0;

  const internSource = (src: string, content: string | null | undefined): number => {
    const existing = sourceIndexMap.get(src);
    if (existing !== undefined) {
      if (mergedSourcesContent[existing] === null && content !== undefined && content !== null) {
        mergedSourcesContent[existing] = content;
        hasAnySourcesContent = true;
      }
      return existing;
    }
    const nextIdx = mergedSources.length;
    mergedSources.push(src);
    if (content !== undefined && content !== null) {
      hasAnySourcesContent = true;
    }
    mergedSourcesContent.push(content ?? null);
    sourceIndexMap.set(src, nextIdx);
    return nextIdx;
  };

  const internName = (name: string): number => {
    const existing = nameIndexMap.get(name);
    if (existing !== undefined) return existing;
    const nextIdx = mergedNames.length;
    mergedNames.push(name);
    nameIndexMap.set(name, nextIdx);
    return nextIdx;
  };

  for (const section of rawMap.sections) {
    if (!section || !section.map) continue;
    const offLine = (section.offset?.line ?? 0) | 0;
    const offCol = (section.offset?.column ?? 0) | 0;
    const flatSecResult = flattenSourceMapSectionsWithStats(section.map);
    const flatSec = flatSecResult.map;
    totalMalformed += flatSecResult.malformedCount;

    const decoded = decodeMappingsString(flatSec.mappings);
    totalMalformed += decoded.malformedCount;

    const secSources = flatSec.sources ?? [];
    const secContents = flatSec.sourcesContent ?? [];
    const secNames = flatSec.names ?? [];

    const sourceRemap = new Map<number, number>();
    for (let i = 0; i < secSources.length; i++) {
      const fullSource = resolveSourceWithRoot(secSources[i], flatSec.sourceRoot);
      sourceRemap.set(i, internSource(fullSource, secContents[i]));
    }

    const nameRemap = new Map<number, number>();
    for (let i = 0; i < secNames.length; i++) {
      nameRemap.set(i, internName(secNames[i]));
    }

    for (const m of decoded.mappings) {
      const mappedSource = sourceRemap.get(m.sourceIndex);
      if (mappedSource === undefined) continue;
      const shifted: DecodedMapping = {
        generatedLine: offLine + m.generatedLine,
        generatedColumn: (m.generatedLine === 0 ? offCol : 0) + m.generatedColumn,
        sourceIndex: mappedSource,
        originalLine: m.originalLine,
        originalColumn: m.originalColumn,
      };
      if (m.nameIndex !== undefined) {
        const mappedName = nameRemap.get(m.nameIndex);
        if (mappedName !== undefined) {
          shifted.nameIndex = mappedName;
        }
      }
      mergedMappings.push(shifted);
    }
  }

  mergedMappings.sort((a, b) =>
    a.generatedLine !== b.generatedLine
      ? a.generatedLine - b.generatedLine
      : a.generatedColumn - b.generatedColumn
  );

  const flat: RawSourceMap = {
    version: rawMap.version ?? 3,
    sources: mergedSources,
    names: mergedNames,
    mappings: encodeMappings(mergedMappings),
  };
  if (rawMap.file !== undefined) flat.file = rawMap.file;
  if (rawMap.sourceRoot !== undefined) flat.sourceRoot = rawMap.sourceRoot;
  if (hasAnySourcesContent) flat.sourcesContent = mergedSourcesContent;
  const debugId = rawMap.debugId ?? rawMap.debug_id;
  if (debugId) flat.debugId = debugId;

  return { map: flat, malformedCount: totalMalformed };
}

export function flattenSourceMapSections(rawMap: AnySourceMap): RawSourceMap {
  return flattenSourceMapSectionsWithStats(rawMap).map;
}

export function decodeMappings(mappingsOrMap: string | AnySourceMap): {
  mappings: DecodedMapping[];
  malformedCount: number;
} {
  if (typeof mappingsOrMap === 'string') {
    return decodeMappingsString(mappingsOrMap);
  }
  if (!mappingsOrMap || typeof mappingsOrMap !== 'object') {
    return { mappings: [], malformedCount: 0 };
  }
  const { map, malformedCount } = flattenSourceMapSectionsWithStats(mappingsOrMap);
  const decoded = decodeMappingsString(map.mappings);
  return {
    mappings: decoded.mappings,
    malformedCount: malformedCount + decoded.malformedCount,
  };
}

export function encodeMappings(decoded: DecodedMapping[]): string {
  if (decoded.length === 0) return '';

  const sorted = [...decoded].sort((a, b) =>
    a.generatedLine !== b.generatedLine
      ? a.generatedLine - b.generatedLine
      : a.generatedColumn - b.generatedColumn
  );

  const maxLine = sorted[sorted.length - 1].generatedLine;
  const lineBuckets: string[][] = Array.from({ length: maxLine + 1 }, () => []);

  let prevSource = 0;
  let prevOrigLine = 0;
  let prevOrigCol = 0;
  let prevName = 0;
  let prevGenLine = -1;
  let prevGenCol = 0;

  for (const m of sorted) {
    if (m.generatedLine !== prevGenLine) {
      prevGenLine = m.generatedLine;
      prevGenCol = 0;
    }

    let seg =
      encodeVlq(m.generatedColumn - prevGenCol) +
      encodeVlq(m.sourceIndex - prevSource) +
      encodeVlq(m.originalLine - prevOrigLine) +
      encodeVlq(m.originalColumn - prevOrigCol);

    prevGenCol = m.generatedColumn;
    prevSource = m.sourceIndex;
    prevOrigLine = m.originalLine;
    prevOrigCol = m.originalColumn;

    if (m.nameIndex !== undefined) {
      seg += encodeVlq(m.nameIndex - prevName);
      prevName = m.nameIndex;
    }

    lineBuckets[m.generatedLine].push(seg);
  }

  return lineBuckets.map((segs) => segs.join(',')).join(';');
}

function ensureSortedMappings(mappings: DecodedMapping[]): DecodedMapping[] {
  for (let i = 1; i < mappings.length; i++) {
    const prev = mappings[i - 1];
    const curr = mappings[i];
    if (
      curr.generatedLine < prev.generatedLine ||
      (curr.generatedLine === prev.generatedLine && curr.generatedColumn < prev.generatedColumn)
    ) {
      return [...mappings].sort((a, b) =>
        a.generatedLine !== b.generatedLine
          ? a.generatedLine - b.generatedLine
          : a.generatedColumn - b.generatedColumn
      );
    }
  }
  return mappings;
}

function findMappingAt(
  mappings: DecodedMapping[],
  line0: number,
  col0: number
): DecodedMapping | undefined {
  let lo = 0;
  let hi = mappings.length - 1;
  let best: DecodedMapping | undefined;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = mappings[mid];
    if (m.generatedLine < line0 || (m.generatedLine === line0 && m.generatedColumn <= col0)) {
      if (m.generatedLine === line0) {
        best = m;
      }
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

export function shiftSourceMapLines(map: RawSourceMap, lineOffset: number): RawSourceMap {
  if (lineOffset <= 0 || !map.mappings) {
    return map;
  }
  return {
    ...map,
    mappings: `${';'.repeat(lineOffset)}${map.mappings}`,
  };
}

export function computeDeterministicDebugId(code: string, mappings = ''): string {
  const hash = crypto.createHash('sha256').update(code, 'utf8');
  if (mappings) {
    hash.update('\0', 'utf8').update(mappings, 'utf8');
  }
  const bytes = hash.digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function chainSourceMaps(mapB: AnySourceMap, mapA: AnySourceMap): RawSourceMap {
  const flatB = flattenSourceMapSections(mapB);
  const flatA = flattenSourceMapSections(mapA);
  const decodedB = ensureSortedMappings(decodeMappingsString(flatB.mappings).mappings);
  const decodedA = ensureSortedMappings(decodeMappingsString(flatA.mappings).mappings);
  const chained: DecodedMapping[] = [];

  for (const mB of decodedB) {
    const mA = findMappingAt(decodedA, mB.originalLine, mB.originalColumn);
    if (mA) {
      chained.push({
        generatedLine: mB.generatedLine,
        generatedColumn: mB.generatedColumn,
        sourceIndex: mA.sourceIndex,
        originalLine: mA.originalLine,
        originalColumn: mA.originalColumn,
        nameIndex: mA.nameIndex,
      });
    }
  }

  const debugId = flatA.debugId ?? flatA.debug_id ?? flatB.debugId ?? flatB.debug_id;
  const result: RawSourceMap = {
    version: 3,
    file: flatB.file ?? flatA.file,
    sourceRoot: flatA.sourceRoot,
    sources: [...flatA.sources],
    sourcesContent: flatA.sourcesContent ? [...flatA.sourcesContent] : undefined,
    names: [...flatA.names],
    mappings: encodeMappings(chained),
  };
  if (debugId) {
    result.debugId = debugId;
  }
  return result;
}

export function resolvePosition(
  map: AnySourceMap,
  line1Based: number,
  column1Based: number
): {
  source?: string;
  line?: number;
  column?: number;
  name?: string;
  malformedCount: number;
} {
  const { map: flatMap, malformedCount: flattenMalformed } = flattenSourceMapSectionsWithStats(map);
  const { mappings, malformedCount: decodeMalformed } = decodeMappingsString(flatMap.mappings);
  const malformedCount = flattenMalformed + decodeMalformed;
  const sortedMappings = ensureSortedMappings(mappings);
  const match = findMappingAt(
    sortedMappings,
    Math.max(0, line1Based - 1),
    Math.max(0, column1Based - 1)
  );
  if (!match) {
    return { malformedCount };
  }
  const rawSource = flatMap.sources[match.sourceIndex];
  const source = resolveSourceWithRoot(rawSource, flatMap.sourceRoot);

  return {
    source,
    line: match.originalLine + 1,
    column: match.originalColumn + 1,
    name: match.nameIndex !== undefined ? flatMap.names[match.nameIndex] : undefined,
    malformedCount,
  };
}

export function safeDecodeURIComponent(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input.replace(/%[0-9A-Fa-f]{2}/g, (seq) => {
      try {
        return decodeURIComponent(seq);
      } catch {
        return seq;
      }
    });
  }
}

function collectMapFiles(mapsDir: string): string[] {
  if (!fs.existsSync(mapsDir)) return [];
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.map')) {
        results.push(fullPath);
      }
    }
  };
  walk(mapsDir);
  return results;
}

function normalizeFileRefCandidates(fileRef: string): string[] {
  let cleanRef = fileRef.trim();
  try {
    if (/^(?:https?|file):\/\//i.test(cleanRef)) {
      cleanRef = new URL(cleanRef).pathname;
    }
  } catch {
    // keep cleanRef as-is
  }
  cleanRef = cleanRef.split('?')[0].split('#')[0].replace(/\\/g, '/');
  // Strip Windows drive prefix (e.g. /C:/... or C:/...)
  cleanRef = cleanRef.replace(/^\/+([A-Za-z]:\/)/, '$1').replace(/^\/+/, '');
  const decodedRef = safeDecodeURIComponent(cleanRef).replace(/\\/g, '/').replace(/^\/+/, '');

  const variants = new Set<string>();
  for (const raw of [decodedRef, cleanRef]) {
    if (!raw) continue;
    variants.add(raw);
    const withoutDrive = raw.replace(/^[A-Za-z]:\//, '');
    variants.add(withoutDrive);
    for (const v of [raw, withoutDrive]) {
      const nextStripped = v.replace(
        /^(?:.*\/)?(?:_next\/static\/chunks\/|_next\/static\/|_next\/|static\/chunks\/|static\/)/,
        ''
      );
      if (nextStripped) variants.add(nextStripped);
      const chunksIdx = v.indexOf('/chunks/');
      if (chunksIdx !== -1) {
        variants.add(v.slice(chunksIdx + '/chunks/'.length));
      }
    }
  }
  return Array.from(variants).filter(Boolean);
}

function findMatchingMapFile(fileRef: string, mapsDir: string, allMaps: string[]): string | undefined {
  const candidates = normalizeFileRefCandidates(fileRef);

  for (const cand of candidates) {
    const exactCandidate = path.join(mapsDir, `${cand}.map`);
    if (fs.existsSync(exactCandidate)) {
      return exactCandidate;
    }
  }

  for (const mapPath of allMaps) {
    const relRaw = path.relative(mapsDir, mapPath).replace(/\\/g, '/');
    const relDecoded = safeDecodeURIComponent(relRaw);
    for (const rel of [relDecoded, relRaw]) {
      const relNoMap = rel.slice(0, -4);
      for (const cand of candidates) {
        if (
          rel === `${cand}.map` ||
          rel.endsWith(`/${cand}.map`) ||
          cand.endsWith(`/${relNoMap}`) ||
          cand === relNoMap
        ) {
          return mapPath;
        }
      }
    }
  }

  const baseNames = new Set(candidates.map((c) => `${path.posix.basename(c)}.map`));
  return allMaps.find((m) => {
    const base = path.basename(m);
    return baseNames.has(base) || baseNames.has(safeDecodeURIComponent(base));
  });
}

const V8_PARENS_FRAME_REGEX = /^\s*at\s+(?:.+?\s+\()(.+):(\d+):(\d+)\)\s*$/;
const V8_BARE_FRAME_REGEX = /^\s*at\s+(.+?):(\d+):(\d+)\s*$/;
const FIREFOX_FRAME_REGEX = /^[^@]*@(.+?):(\d+):(\d+)\s*$/;
const STACK_FRAME_REGEX = /(?:at\s+(?:[^(]+\s+\()?|\@)([^\s()]+?):(\d+):(\d+)\)?/;

function parseStackFrame(rawLine: string): { fileRef: string; lineNum: number; colNum: number } | null {
  const match =
    rawLine.match(V8_PARENS_FRAME_REGEX) ??
    rawLine.match(V8_BARE_FRAME_REGEX) ??
    rawLine.match(FIREFOX_FRAME_REGEX) ??
    rawLine.match(STACK_FRAME_REGEX);
  if (!match) {
    return null;
  }
  return {
    fileRef: match[1],
    lineNum: Number(match[2]),
    colNum: Number(match[3]),
  };
}

export async function symbolicateStackTrace(
  options: SymbolicateOptions
): Promise<SymbolicateResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const mapsDir = path.resolve(cwd, options.mapsDir ?? '.unpeek-maps');
  const allMaps = collectMapFiles(mapsDir);
  const warnings: string[] = [];
  const mapCache = new Map<string, RawSourceMap | null>();

  if (allMaps.length === 0) {
    warnings.push(`No .map files found in "${mapsDir}".`);
  }

  const lines = options.stackTrace.split(/\r?\n/);
  const frames: SymbolicateFrame[] = [];
  const outputLines: string[] = [];

  for (const rawLine of lines) {
    const parsedFrame = parseStackFrame(rawLine);
    if (!parsedFrame) {
      frames.push({ raw: rawLine, resolved: false });
      outputLines.push(rawLine);
      continue;
    }

    const { fileRef, lineNum, colNum } = parsedFrame;
    const normalizedFrameFile = safeDecodeURIComponent(fileRef).replace(/\\/g, '/');

    const mapPath = findMatchingMapFile(fileRef, mapsDir, allMaps);
    if (!mapPath) {
      frames.push({
        raw: rawLine,
        file: normalizedFrameFile,
        line: lineNum,
        column: colNum,
        resolved: false,
      });
      outputLines.push(rawLine);
      continue;
    }

    let parsedMap = mapCache.get(mapPath);
    if (parsedMap === undefined) {
      try {
        const rawJson = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as AnySourceMap;
        parsedMap = Array.isArray(rawJson?.sections)
          ? flattenSourceMapSections(rawJson)
          : (rawJson as RawSourceMap);
      } catch {
        parsedMap = null;
        warnings.push(`Failed to parse source map "${mapPath}".`);
      }
      mapCache.set(mapPath, parsedMap);
    }

    if (!parsedMap || typeof parsedMap.mappings !== 'string' || !Array.isArray(parsedMap.sources)) {
      frames.push({
        raw: rawLine,
        file: normalizedFrameFile,
        line: lineNum,
        column: colNum,
        resolved: false,
      });
      outputLines.push(rawLine);
      continue;
    }

    const pos = resolvePosition(parsedMap, lineNum, colNum);
    if (pos.malformedCount > 0) {
      warnings.push(`Skipped ${pos.malformedCount} malformed VLQ segment(s) in "${path.basename(mapPath)}".`);
    }

    if (!pos.source || pos.line === undefined || pos.column === undefined) {
      frames.push({
        raw: rawLine,
        file: normalizedFrameFile,
        line: lineNum,
        column: colNum,
        resolved: false,
      });
      outputLines.push(rawLine);
      continue;
    }

    frames.push({
      raw: rawLine,
      file: normalizedFrameFile,
      line: lineNum,
      column: colNum,
      originalSource: pos.source,
      originalLine: pos.line,
      originalColumn: pos.column,
      originalName: pos.name,
      resolved: true,
    });

    const fnPrefix = pos.name ? `${pos.name} ` : '';
    outputLines.push(`    at ${fnPrefix}(${pos.source}:${pos.line}:${pos.column})`);
  }

  return {
    stackTrace: outputLines.join('\n'),
    frames,
    warnings: Array.from(new Set(warnings)),
  };
}
