import type * as acorn from 'acorn';
import type { TransformOptions, TransformResult } from './types.js';
import type {
  InternalShieldPayload,
  InternalTransformOptions,
  InternalTransformResult,
} from '../internal/types.js';
import { UnpeekError, type UnpeekErrorCode } from '../shared/errors.js';
import { computeFnv1aHash } from '../shared/hash.js';
import {
  analyzeAstHotPaths,
  detectHotPaths,
  parseJavaScriptAst,
} from './hot-path-detector.js';
import { applyStringVault } from './string-vault.js';
import { applyPolymorphicMangler } from './polymorphic-mangler.js';
import { applyColdFlowGuard } from './cold-flow-guard.js';
import {
  generateCompactJs,
  generateCompactJsWithMap,
} from './codegen.js';
import { applyMicroVm } from './micro-vm.js';
import { applySaltedStringVault } from './salted-vault.js';
import { generateRuntimeShield } from '../runtime/index.js';
import { deriveWindowKeySymbol } from '../internal/runtime.js';
import {
  attachMagicComments,
  classifyChunkBoundary,
  type BoundaryClassification,
  type ChunkBoundaryKind,
} from './boundary-classifier.js';
import { scrubResidualPaths } from './scrubber.js';

export {
  detectHotPaths,
  computeFnv1aHash,
  UnpeekError,
  classifyChunkBoundary,
  scrubResidualPaths,
};
export type { UnpeekErrorCode, BoundaryClassification, ChunkBoundaryKind };

function containsUnpeekShieldMarker(node: any, depth = 0): boolean {
  if (!node || typeof node !== 'object' || depth > 24) return false;
  if (
    node.type === 'Identifier' &&
    node.name === '__unpeek_tampered'
  ) {
    return true;
  }
  if (
    node.type === 'Literal' &&
    typeof node.value === 'string' &&
    (node.value === '__unpeek_tampered' ||
      node.value === 'unpeek:tamper' ||
      node.value.startsWith('__upk_v4_'))
  ) {
    return true;
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (containsUnpeekShieldMarker(item, depth + 1)) return true;
      }
    } else if (val && typeof val === 'object' && typeof val.type === 'string') {
      if (containsUnpeekShieldMarker(val, depth + 1)) return true;
    }
  }
  return false;
}

function isAstAlreadyProtected(ast: acorn.Program): boolean {
  if (!ast || !Array.isArray(ast.body)) return false;
  return ast.body.some((stmt: any) => {
    if (stmt.type === 'VariableDeclaration' && Array.isArray(stmt.declarations)) {
      for (const d of stmt.declarations) {
        const name = d.id?.type === 'Identifier' ? d.id.name : undefined;
        if (typeof name === 'string') {
          if (
            name === '_d' ||
            name.startsWith('_uC') ||
            name.startsWith('_uD') ||
            name.startsWith('_uS') ||
            name.startsWith('_uVm') ||
            name.startsWith('_wKdf') ||
            name.startsWith('_uP') ||
            name.startsWith('_uCache') ||
            name.startsWith('_uDc') ||
            name.startsWith('_m') ||
            name.startsWith('_w') ||
            name.startsWith('_k') ||
            (d.init?.type === 'CallExpression' &&
              d.init.callee?.type === 'FunctionExpression' &&
              d.init.callee?.id?.name === 'f' &&
              d.init.arguments?.[0]?.type === 'ArrayExpression') ||
            (d.init?.type === 'CallExpression' &&
              d.init.callee?.type === 'MemberExpression' &&
              d.init.callee.object?.type === 'Identifier' &&
              d.init.callee.object.name === 'Symbol' &&
              d.init.callee.property?.type === 'Identifier' &&
              d.init.callee.property.name === 'for' &&
              typeof d.init.arguments?.[0]?.value === 'string' &&
              d.init.arguments[0].value.startsWith('__upk_v4_'))
          ) {
            return true;
          }
        }
      }
    }
    if (stmt.type === 'FunctionDeclaration' && stmt.id?.type === 'Identifier') {
      const fnName = stmt.id.name;
      if (
        typeof fnName === 'string' &&
        (fnName.startsWith('_uD') ||
          fnName.startsWith('_uVm') ||
          fnName.startsWith('_wKdf') ||
          fnName.startsWith('_hX'))
      ) {
        return true;
      }
    }
    if (
      stmt.type === 'ExpressionStatement' &&
      stmt.expression?.type === 'CallExpression'
    ) {
      const callee = stmt.expression.callee;
      if (callee?.type === 'FunctionExpression') {
        const name = callee.id?.name;
        if (
          typeof name === 'string' &&
          (name.startsWith('_u$') ||
            name.startsWith('_$') ||
            name.startsWith('_s') ||
            name.startsWith('$b') ||
            containsUnpeekShieldMarker(callee.body))
        ) {
          return true;
        }
      }
    }
    return false;
  });
}

export function transformJavaScript(
  code: string,
  options: TransformOptions = {}
): TransformResult {
  const internalOptions = options as InternalTransformOptions;
  const seed = internalOptions.seed ?? 0x9e3779b9;
  const minStringLength =
    options.minStringLength ?? options.config?.vault?.minStringLength ?? 4;
  const isAggressive = options.aggressive ?? false;

  if (!code || !code.trim()) {
    const emptyResult: InternalTransformResult = {
      code,
      encryptedStringsCount: 0,
      mangledSymbolsCount: 0,
      hotPathReport: {
        totalFunctions: 0,
        hotFunctionsSkipped: [],
        coldFunctionsProtected: [],
      },
      integrityToken: computeFnv1aHash('', seed),
      virtualizedFunctionsCount: 0,
      shaderBuffersCount: 0,
      skippedReason: 'empty',
    };
    return emptyResult;
  }

  const comments: acorn.Comment[] = [];
  const ast = parseJavaScriptAst(code, comments);
  if (!ast) {
    if (options.strict) {
      const targetLabel = options.filename ? ` "${options.filename}"` : '';
      throw new UnpeekError(
        'ERR_PARSE_FAILED',
        `Failed to parse JavaScript${targetLabel}.`
      );
    }
    const unparsedResult: InternalTransformResult = {
      code,
      encryptedStringsCount: 0,
      mangledSymbolsCount: 0,
      hotPathReport: {
        totalFunctions: 0,
        hotFunctionsSkipped: [],
        coldFunctionsProtected: [],
      },
      integrityToken: computeFnv1aHash(code, seed),
      virtualizedFunctionsCount: 0,
      shaderBuffersCount: 0,
      skippedReason: 'parse-error',
    };
    return unparsedResult;
  }
  if (isAstAlreadyProtected(ast)) {
    const protectedResult: InternalTransformResult = {
      code,
      encryptedStringsCount: 0,
      mangledSymbolsCount: 0,
      hotPathReport: {
        totalFunctions: 0,
        hotFunctionsSkipped: [],
        coldFunctionsProtected: [],
      },
      integrityToken: computeFnv1aHash(code, seed),
      virtualizedFunctionsCount: 0,
      shaderBuffersCount: 0,
      skippedReason: 'already-protected',
    };
    return protectedResult;
  }

  // 0. Classify chunk boundaries & attach dynamic import magic comments
  const boundary = classifyChunkBoundary(ast);
  attachMagicComments(boundary.importExpressions, comments);

  const effectiveConfig = options.critical
    ? { ...(options.config ?? {}), critical: options.critical }
    : options.config;
  const effectiveProfile = options.profile ?? effectiveConfig?.profile;

  // 1. Detect hot paths (loops, array HOF callbacks, rAF, UI components, and their callees)
  const hotRes = analyzeAstHotPaths(ast, effectiveConfig);
  const {
    report: hotPathReport,
    coldFunctionNodes,
    hotFunctionNodes,
    hotExemptNodes,
    serializedFunctionNodes,
  } = hotRes;
  const criticalFunctionNodes = (
    hotRes as { criticalFunctionNodes?: WeakSet<acorn.Node> }
  ).criticalFunctionNodes;

  if (options.scrubPaths || effectiveConfig?.scrubPaths) {
    scrubResidualPaths(
      ast,
      {
        scrubPaths: true,
        rootDir: internalOptions.rootDir ?? options.rootDir ?? process.cwd(),
      },
      hotExemptNodes,
      boundary.exemptSubtreeRoots
    );
  }

  const shieldCoupled =
    internalOptions.shieldCoupled ?? Boolean(internalOptions.injectRuntimeShield);
  const deterrentMode =
    internalOptions.deterrentMode ?? effectiveConfig?.shield?.deterrentMode ?? 'passive';
  const detectHeadless =
    internalOptions.detectHeadless ?? effectiveConfig?.shield?.detectHeadless ?? false;
  const sym = shieldCoupled
    ? internalOptions.windowKeySymbol ?? deriveWindowKeySymbol(seed)
    : undefined;
  let shieldDelta = shieldCoupled ? internalOptions.expectedDelta : undefined;
  if (shieldCoupled && shieldDelta === undefined) {
    const shieldInfo = generateRuntimeShield({
      seed,
      windowKeySymbol: sym,
      deterrentMode,
      detectHeadless,
    }) as InternalShieldPayload;
    shieldDelta = shieldInfo.expectedDelta ?? 0;
  }

  let virtualizedFunctionsCount = 0;
  if (isAggressive) {
    const extraVmOpts =
      criticalFunctionNodes || effectiveConfig?.critical?.maxFunctionsPerChunk !== undefined
        ? {
            ...(criticalFunctionNodes ? { criticalFunctionNodes } : {}),
            ...(effectiveConfig?.critical?.maxFunctionsPerChunk !== undefined
              ? { maxFunctionsPerChunk: effectiveConfig.critical.maxFunctionsPerChunk }
              : {}),
          }
        : undefined;
    const vmRes = extraVmOpts
      ? (
          applyMicroVm as (
            a: acorn.Program,
            b?: Set<acorn.Node> | WeakSet<acorn.Node>,
            c?: WeakSet<acorn.Node>,
            d?: number,
            e?: string,
            f?: number,
            g?: {
              criticalFunctionNodes?: WeakSet<acorn.Node>;
              maxFunctionsPerChunk?: number;
            }
          ) => { virtualizedCount: number }
        )(
          ast,
          coldFunctionNodes,
          serializedFunctionNodes,
          seed,
          sym,
          shieldDelta,
          extraVmOpts
        )
      : applyMicroVm(
          ast,
          coldFunctionNodes,
          serializedFunctionNodes,
          seed,
          sym,
          shieldDelta
        );
    virtualizedFunctionsCount = vmRes.virtualizedCount;
  }

  // 2. Inject polymorphic opaque guards only on cold functions (<2% runtime CPU budget), skipped in Tier 1 minimal
  if (effectiveProfile !== 'minimal' && effectiveConfig?.coldFlow !== false) {
    applyColdFlowGuard(ast, coldFunctionNodes, seed, hotExemptNodes);
  }

  // 3. Mangle local parameters & function-scoped variables safely
  const mangledSymbolsCount = applyPolymorphicMangler(
    ast,
    seed,
    serializedFunctionNodes,
    effectiveConfig
  );

  let encryptedStringsCount = 0;
  let integrityToken = 0;
  let shaderBuffersCount = 0;

  if (isAggressive) {
    const saltedRes = applySaltedStringVault(
      ast,
      seed,
      minStringLength,
      hotExemptNodes,
      effectiveConfig,
      sym,
      shieldDelta,
      deterrentMode,
      shieldCoupled,
      detectHeadless,
      boundary.exemptSubtreeRoots
    );
    encryptedStringsCount = saltedRes.encryptedStringsCount;
    integrityToken = saltedRes.integrityToken;
  } else {
    const vaultRes = applyStringVault(
      ast,
      seed,
      minStringLength,
      hotExemptNodes,
      sym,
      shieldDelta,
      deterrentMode,
      effectiveConfig,
      shieldCoupled,
      detectHeadless,
      boundary.exemptSubtreeRoots
    );
    encryptedStringsCount = vaultRes.encryptedStringsCount;
    integrityToken = vaultRes.integrityToken;
    shaderBuffersCount = vaultRes.shaderBuffersCount ?? 0;
  }

  // 5. Generate compact JavaScript output (and optional M2 source map)
  const wantMap = Boolean(internalOptions.generateMap || options.map);
  let outputCode: string;
  let generatedMap:
    | {
        version: number;
        file?: string;
        sources: string[];
        names: string[];
        mappings: string;
      }
    | undefined;

  if (wantMap) {
    const mapped = generateCompactJsWithMap(ast, options.filename);
    outputCode = mapped.code;
    generatedMap = {
      version: 3,
      ...(options.filename ? { file: options.filename } : {}),
      sources: mapped.sources,
      names: mapped.names,
      mappings: mapped.mappings,
    };
  } else {
    outputCode = generateCompactJs(ast);
  }

  let finalCode = outputCode;
  if (internalOptions.injectRuntimeShield && !internalOptions.skipShieldPreamble) {
    const shield = generateRuntimeShield({
      seed,
      windowKeySymbol: sym,
      expectedDelta: shieldDelta,
      deterrentMode,
      detectHeadless,
      expectedIntegrityHash: integrityToken,
    });
    if (shield.preambleCode) {
      finalCode = `${shield.preambleCode}\n${finalCode}`;
      if (generatedMap && generatedMap.mappings) {
        const preambleLines = shield.preambleCode.split('\n').length;
        generatedMap.mappings = ';'.repeat(preambleLines) + generatedMap.mappings;
      }
    }
  }

  const finalResult: InternalTransformResult = {
    code: finalCode,
    encryptedStringsCount,
    mangledSymbolsCount,
    hotPathReport,
    integrityToken,
    virtualizedFunctionsCount,
    shaderBuffersCount,
    ...(generatedMap ? { sourceMap: generatedMap } : {}),
  };
  return finalResult;
}
