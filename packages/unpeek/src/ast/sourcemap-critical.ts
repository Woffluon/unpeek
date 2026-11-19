import type * as acorn from 'acorn';
import {
  decodeVlq,
  flattenSourceMapSections,
  type AnySourceMap,
  type DecodedMapping,
} from '../core/vlq.js';

export interface SourceMapCriticalOptions {
  criticalAnnotation: string;
  criticalIncludeMatchers: ((name: string) => boolean)[];
  rawIncludePatterns: Array<string | RegExp>;
}

export interface FunctionLocationEntry {
  node: acorn.Node;
  name: string;
  idNode?: acorn.Node | null;
}

function contentMightMatchInclude(
  content: string,
  rawPatterns: Array<string | RegExp>
): boolean {
  for (const pat of rawPatterns) {
    if (typeof pat === 'string' && pat.length > 0) {
      if (content.includes(pat)) return true;
      try {
        const stripped = pat.replace(/^\^|\$$/g, '');
        if (stripped && new RegExp(stripped).test(content)) return true;
      } catch {
        // Fallback already checked via includes()
      }
    } else if (pat instanceof RegExp) {
      try {
        const stripped = pat.source.replace(/^\^|\$$/g, '');
        const flags = pat.flags.replace(/[gy]/g, '');
        if (new RegExp(stripped, flags).test(content)) return true;
      } catch {
        return true;
      }
    }
  }
  return false;
}

function mightContainCriticalMatches(
  rawMap: AnySourceMap,
  options: SourceMapCriticalOptions
): boolean {
  if (!rawMap || typeof rawMap !== 'object') return false;

  if (Array.isArray(rawMap.sections)) {
    return rawMap.sections.some(
      (sec) => sec?.map && mightContainCriticalMatches(sec.map, options)
    );
  }

  if (
    options.criticalIncludeMatchers.length > 0 &&
    Array.isArray(rawMap.names) &&
    rawMap.names.some(
      (n) =>
        typeof n === 'string' &&
        options.criticalIncludeMatchers.some((match) => match(n))
    )
  ) {
    return true;
  }

  if (Array.isArray(rawMap.sourcesContent)) {
    for (const content of rawMap.sourcesContent) {
      if (typeof content !== 'string' || content.length === 0) continue;
      if (content.includes(options.criticalAnnotation)) return true;
      if (
        options.rawIncludePatterns.length > 0 &&
        contentMightMatchInclude(content, options.rawIncludePatterns)
      ) {
        return true;
      }
    }
  }

  return false;
}

function decodeMappingsByLine(
  mappingsStr: string,
  maxGenLine: number
): Map<number, DecodedMapping[]> {
  const byLine = new Map<number, DecodedMapping[]>();
  if (!mappingsStr || maxGenLine < 0) return byLine;

  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;

  let genLine = 0;
  let pos = 0;
  const len = mappingsStr.length;

  while (pos <= len && genLine <= maxGenLine) {
    let semi = mappingsStr.indexOf(';', pos);
    if (semi === -1) semi = len;

    if (semi > pos) {
      const lineStr = mappingsStr.slice(pos, semi);
      let genCol = 0;
      const lineSegs: DecodedMapping[] = [];
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
        if (
          !valid ||
          (values.length !== 1 && values.length !== 4 && values.length !== 5)
        ) {
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
          lineSegs.push(mapping);
        }
      }

      if (lineSegs.length > 0) {
        for (let i = 1; i < lineSegs.length; i++) {
          if (lineSegs[i].generatedColumn < lineSegs[i - 1].generatedColumn) {
            lineSegs.sort((a, b) => a.generatedColumn - b.generatedColumn);
            break;
          }
        }
        byLine.set(genLine, lineSegs);
      }
    }

    if (semi === len) break;
    pos = semi + 1;
    genLine++;
  }

  return byLine;
}

function findNearestSegmentOnLine(
  lineSegs: DecodedMapping[] | undefined,
  genCol: number,
  maxForwardCol?: number
): DecodedMapping | undefined {
  if (!lineSegs || lineSegs.length === 0) return undefined;

  let lo = 0;
  let hi = lineSegs.length - 1;
  let best: DecodedMapping | undefined;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = lineSegs[mid];
    if (m.generatedColumn <= genCol) {
      best = m;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best) return best;

  const first = lineSegs[0];
  if (maxForwardCol === undefined || first.generatedColumn <= maxForwardCol) {
    return first;
  }
  return undefined;
}

function hasCriticalAnnotationNearLine(
  lines: string[],
  origLine: number,
  annotation: string
): boolean {
  if (origLine < 0 || origLine >= lines.length) return false;
  if (lines[origLine].includes(annotation)) return true;

  const minLine = Math.max(0, origLine - 5);
  let inBlockComment = false;

  for (let l = origLine - 1; l >= minLine; l--) {
    const line = lines[l];
    if (line.includes(annotation)) return true;

    const trimmed = line.trim();
    if (!inBlockComment && trimmed.endsWith('*/') && !trimmed.includes('/*')) {
      inBlockComment = true;
      continue;
    }
    if (inBlockComment) {
      if (trimmed.includes('/*')) {
        inBlockComment = false;
      }
      continue;
    }
    if (
      trimmed === '' ||
      trimmed.startsWith('//') ||
      (trimmed.startsWith('/*') && trimmed.endsWith('*/'))
    ) {
      continue;
    }
    break;
  }

  return false;
}

const IDENT_CHAR_RE = /[A-Za-z0-9_$]/;
const DECL_IDENT_RES = [
  /\bfunction\s*\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g,
  /([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]\s*(?:async\s+)?(?:function\b|\()/g,
];

function hasCriticalNameOnSourceLine(
  line: string,
  origCol: number,
  matchers: ((name: string) => boolean)[]
): boolean {
  if (!line || matchers.length === 0) return false;

  // Check identifier at or around originalColumn
  if (origCol >= 0 && origCol < line.length) {
    let start = origCol;
    while (start > 0 && IDENT_CHAR_RE.test(line[start - 1])) start--;
    let end = origCol;
    while (end < line.length && IDENT_CHAR_RE.test(line[end])) end++;
    if (end > start) {
      const token = line.slice(start, end);
      if (matchers.some((m) => m(token))) return true;
    }
  }

  // Check function / variable declaration identifiers on the line
  for (const re of DECL_IDENT_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m[1] && matchers.some((match) => match(m![1]))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Resolves AST function nodes marked as critical via Source Map v3 `names` or
 * `sourcesContent` (`@unpeek-critical` annotation within 5 comment/blank lines
 * or `critical.include` identifiers), using an O(1) pre-filter to skip VLQ
 * decoding when no potential match exists.
 */
export function resolveSourceMapCriticalNodes(
  functions: FunctionLocationEntry[],
  originalSourceMap: AnySourceMap | undefined,
  options: SourceMapCriticalOptions
): Set<acorn.Node> {
  const matched = new Set<acorn.Node>();
  if (!originalSourceMap || functions.length === 0) {
    return matched;
  }

  if (!mightContainCriticalMatches(originalSourceMap, options)) {
    return matched;
  }

  const flatMap = flattenSourceMapSections(originalSourceMap);
  if (!flatMap.mappings) {
    return matched;
  }

  let maxGenLine = -1;
  for (const fn of functions) {
    const nLine = fn.node.loc?.start?.line;
    if (typeof nLine === 'number') {
      maxGenLine = Math.max(maxGenLine, nLine - 1);
    }
    const idLine = fn.idNode?.loc?.start?.line;
    if (typeof idLine === 'number') {
      maxGenLine = Math.max(maxGenLine, idLine - 1);
    }
  }
  if (maxGenLine < 0) {
    return matched;
  }

  const lineMappings = decodeMappingsByLine(flatMap.mappings, maxGenLine);
  if (lineMappings.size === 0) {
    return matched;
  }

  const linesCache = new Map<number, string[]>();
  const getSourceLines = (sourceIdx: number): string[] | undefined => {
    if (linesCache.has(sourceIdx)) return linesCache.get(sourceIdx);
    const content = flatMap.sourcesContent?.[sourceIdx];
    if (typeof content !== 'string') return undefined;
    const split = content.split(/\r?\n/);
    linesCache.set(sourceIdx, split);
    return split;
  };

  const segmentIsCritical = (seg: DecodedMapping): boolean => {
    if (
      seg.nameIndex !== undefined &&
      options.criticalIncludeMatchers.length > 0
    ) {
      const mappedName = flatMap.names[seg.nameIndex];
      if (
        typeof mappedName === 'string' &&
        options.criticalIncludeMatchers.some((m) => m(mappedName))
      ) {
        return true;
      }
    }

    const lines = getSourceLines(seg.sourceIndex);
    if (!lines) return false;

    if (
      hasCriticalAnnotationNearLine(
        lines,
        seg.originalLine,
        options.criticalAnnotation
      )
    ) {
      return true;
    }

    if (
      options.criticalIncludeMatchers.length > 0 &&
      seg.originalLine >= 0 &&
      seg.originalLine < lines.length &&
      hasCriticalNameOnSourceLine(
        lines[seg.originalLine],
        seg.originalColumn,
        options.criticalIncludeMatchers
      )
    ) {
      return true;
    }

    return false;
  };

  for (const fn of functions) {
    const candidates: DecodedMapping[] = [];

    const idLoc = fn.idNode?.loc?.start;
    if (idLoc) {
      const seg = findNearestSegmentOnLine(
        lineMappings.get(idLoc.line - 1),
        idLoc.column
      );
      if (seg) candidates.push(seg);
    }

    const nodeStart = fn.node.loc?.start;
    if (nodeStart) {
      const nodeEnd = fn.node.loc?.end;
      const maxForwardCol =
        nodeEnd && nodeEnd.line === nodeStart.line ? nodeEnd.column : undefined;
      const seg = findNearestSegmentOnLine(
        lineMappings.get(nodeStart.line - 1),
        nodeStart.column,
        maxForwardCol
      );
      if (seg && !candidates.includes(seg)) {
        candidates.push(seg);
      }
    }

    if (candidates.some(segmentIsCritical)) {
      matched.add(fn.node);
    }
  }

  return matched;
}
