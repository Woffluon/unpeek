import type * as acorn from 'acorn';
import type {
  InternalShieldPayload,
  InternalTransformOptions,
  InternalTransformResult,
  TransformOptions,
  TransformResult,
} from '../types.js';
import { UnpeekError, type UnpeekErrorCode } from '../errors.js';
import { computeFnv1aHash } from '../shared/hash.js';
import {
  analyzeAstHotPaths,
  detectHotPaths,
  parseJavaScriptAst,
} from './hot-path-detector.js';
import { applyStringVault } from './string-vault.js';
import { applyPolymorphicMangler } from './polymorphic-mangler.js';
import { applyColdFlowGuard } from './cold-flow-guard.js';
import { generateCompactJs, derivePolymorphicIdent } from './codegen.js';
import { applyMicroVm } from './micro-vm.js';
import { applySaltedStringVault } from './salted-vault.js';
import { deriveWindowKeySymbol, generateRuntimeShield } from '../runtime/index.js';

export { detectHotPaths, computeFnv1aHash, UnpeekError };
export type { UnpeekErrorCode };

function isAstAlreadyProtected(ast: acorn.Program): boolean {
  if (!ast || !Array.isArray(ast.body)) return false;
  return ast.body.some((stmt) => {
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
            name.startsWith('_m') ||
            name.startsWith('_w') ||
            name.startsWith('_k') ||
            (name.startsWith('_a') &&
              d.init?.type === 'CallExpression' &&
              d.init.callee?.type === 'FunctionExpression' &&
              d.init.callee?.id?.name === 'f')
          ) {
            return true;
          }
        }
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
            name.startsWith('$b'))
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
    };
    return emptyResult;
  }

  const ast = parseJavaScriptAst(code);
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
    };
    return protectedResult;
  }

  // 1. Detect hot paths (loops, array HOF callbacks, rAF, UI components, and their callees)
  const {
    report: hotPathReport,
    coldFunctionNodes,
    hotFunctionNodes,
    hotExemptNodes,
    serializedFunctionNodes,
  } = analyzeAstHotPaths(ast, options.config);

  const shieldCoupled =
    internalOptions.shieldCoupled ?? Boolean(internalOptions.injectRuntimeShield);
  const deterrentMode =
    internalOptions.deterrentMode ?? internalOptions.config?.shield?.deterrentMode ?? 'passive';
  const detectHeadless =
    internalOptions.detectHeadless ?? internalOptions.config?.shield?.detectHeadless ?? false;
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
    const vmRes = applyMicroVm(
      ast,
      coldFunctionNodes,
      serializedFunctionNodes,
      seed,
      sym,
      shieldDelta
    );
    virtualizedFunctionsCount = vmRes.virtualizedCount;
  }

  // 2. Inject polymorphic opaque guards only on cold functions (<2% runtime CPU budget)
  applyColdFlowGuard(ast, coldFunctionNodes, seed, hotExemptNodes);

  // 3. Mangle local parameters & function-scoped variables safely
  const mangledSymbolsCount = applyPolymorphicMangler(
    ast,
    seed,
    serializedFunctionNodes,
    options.config
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
      options.config,
      sym,
      shieldDelta,
      deterrentMode,
      shieldCoupled,
      detectHeadless
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
      options.config,
      shieldCoupled,
      detectHeadless
    );
    encryptedStringsCount = vaultRes.encryptedStringsCount;
    integrityToken = vaultRes.integrityToken;
    shaderBuffersCount = vaultRes.shaderBuffersCount ?? 0;
  }

  // 5. Generate compact single-line JavaScript output
  const outputCode = generateCompactJs(ast);

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
  };
  return finalResult;
}
