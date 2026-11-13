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

export interface RawSourceMap {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names: string[];
  mappings: string;
  debugId?: string;
  debug_id?: string;
}

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

export function decodeMappings(mappingsStr: string): {
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

export function chainSourceMaps(mapB: RawSourceMap, mapA: RawSourceMap): RawSourceMap {
  const decodedB = decodeMappings(mapB.mappings).mappings;
  const decodedA = decodeMappings(mapA.mappings).mappings;
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

  const debugId = mapA.debugId ?? mapA.debug_id ?? mapB.debugId ?? mapB.debug_id;
  const result: RawSourceMap = {
    version: 3,
    file: mapB.file ?? mapA.file,
    sourceRoot: mapA.sourceRoot,
    sources: [...mapA.sources],
    sourcesContent: mapA.sourcesContent ? [...mapA.sourcesContent] : undefined,
    names: [...mapA.names],
    mappings: encodeMappings(chained),
  };
  if (debugId) {
    result.debugId = debugId;
  }
  return result;
}

export function resolvePosition(
  map: RawSourceMap,
  line1Based: number,
  column1Based: number
): {
  source?: string;
  line?: number;
  column?: number;
  name?: string;
  malformedCount: number;
} {
  const { mappings, malformedCount } = decodeMappings(map.mappings);
  const match = findMappingAt(mappings, Math.max(0, line1Based - 1), Math.max(0, column1Based - 1));
  if (!match) {
    return { malformedCount };
  }
  const rawSource = map.sources[match.sourceIndex];
  const source =
    map.sourceRoot && rawSource && !rawSource.startsWith(map.sourceRoot)
      ? `${map.sourceRoot.replace(/\/$/, '')}/${rawSource.replace(/^\//, '')}`
      : rawSource;

  return {
    source,
    line: match.originalLine + 1,
    column: match.originalColumn + 1,
    name: match.nameIndex !== undefined ? map.names[match.nameIndex] : undefined,
    malformedCount,
  };
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

function findMatchingMapFile(fileRef: string, mapsDir: string, allMaps: string[]): string | undefined {
  let cleanRef = fileRef.trim();
  try {
    if (/^https?:\/\//i.test(cleanRef)) {
      cleanRef = new URL(cleanRef).pathname;
    }
  } catch {
    // keep cleanRef as-is
  }
  cleanRef = cleanRef.split('?')[0].split('#')[0].replace(/\\/g, '/').replace(/^\/+/, '');
  const targetMapName = `${path.posix.basename(cleanRef)}.map`;

  const exactCandidate = path.join(mapsDir, `${cleanRef}.map`);
  if (fs.existsSync(exactCandidate)) {
    return exactCandidate;
  }

  for (const mapPath of allMaps) {
    const rel = path.relative(mapsDir, mapPath).replace(/\\/g, '/');
    if (rel === `${cleanRef}.map` || rel.endsWith(`/${cleanRef}.map`) || cleanRef.endsWith(`/${rel.slice(0, -4)}`)) {
      return mapPath;
    }
  }

  return allMaps.find((m) => path.basename(m) === targetMapName);
}

const STACK_FRAME_REGEX = /(?:at\s+(?:[^(]+\s+\()?|\@)([^\s()]+?):(\d+):(\d+)\)?/;

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
    const match = rawLine.match(STACK_FRAME_REGEX);
    if (!match) {
      frames.push({ raw: rawLine, resolved: false });
      outputLines.push(rawLine);
      continue;
    }

    const fileRef = match[1];
    const lineNum = Number(match[2]);
    const colNum = Number(match[3]);

    const mapPath = findMatchingMapFile(fileRef, mapsDir, allMaps);
    if (!mapPath) {
      frames.push({ raw: rawLine, file: fileRef, line: lineNum, column: colNum, resolved: false });
      outputLines.push(rawLine);
      continue;
    }

    let parsedMap = mapCache.get(mapPath);
    if (parsedMap === undefined) {
      try {
        parsedMap = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as RawSourceMap;
      } catch {
        parsedMap = null;
        warnings.push(`Failed to parse source map "${mapPath}".`);
      }
      mapCache.set(mapPath, parsedMap);
    }

    if (!parsedMap || typeof parsedMap.mappings !== 'string' || !Array.isArray(parsedMap.sources)) {
      frames.push({ raw: rawLine, file: fileRef, line: lineNum, column: colNum, resolved: false });
      outputLines.push(rawLine);
      continue;
    }

    const pos = resolvePosition(parsedMap, lineNum, colNum);
    if (pos.malformedCount > 0) {
      warnings.push(`Skipped ${pos.malformedCount} malformed VLQ segment(s) in "${path.basename(mapPath)}".`);
    }

    if (!pos.source || pos.line === undefined || pos.column === undefined) {
      frames.push({ raw: rawLine, file: fileRef, line: lineNum, column: colNum, resolved: false });
      outputLines.push(rawLine);
      continue;
    }

    frames.push({
      raw: rawLine,
      file: fileRef,
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
