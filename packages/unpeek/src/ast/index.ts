import type { TransformOptions, TransformResult } from '../types.js';
import {
  analyzeAstHotPaths,
  detectHotPaths,
  parseJavaScriptAst,
} from './hot-path-detector.js';
import { applyStringVault, computeFnv1aHash } from './string-vault.js';
import { applyPolymorphicMangler } from './polymorphic-mangler.js';
import { applyColdFlowGuard } from './cold-flow-guard.js';
import { generateCompactJs, derivePolymorphicIdent } from './codegen.js';
import { applyMicroVm } from './micro-vm.js';
import { injectWasmVault } from './wasm-vault.js';
import { applySaltedStringVault } from './salted-vault.js';
import { generateRuntimeShield } from '../runtime/index.js';

export { detectHotPaths, analyzeAstHotPaths } from './hot-path-detector.js';
export { applyStringVault, computeFnv1aHash } from './string-vault.js';
export { applyPolymorphicMangler } from './polymorphic-mangler.js';
export { applyColdFlowGuard } from './cold-flow-guard.js';
export { generateCompactJs, derivePolymorphicIdent } from './codegen.js';
export { applyMicroVm } from './micro-vm.js';
export { injectWasmVault } from './wasm-vault.js';
export { applySaltedStringVault } from './salted-vault.js';

function isAstAlreadyProtected(ast: any): boolean {
  if (!ast || !Array.isArray(ast.body)) return false;
  return ast.body.some((stmt: any) => {
    if (stmt.type === 'VariableDeclaration' && Array.isArray(stmt.declarations)) {
      for (const d of stmt.declarations) {
        const name = d.id?.name;
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
  const seed = options.seed ?? 0x9e3779b9;
  const minStringLength = options.minStringLength ?? 4;
  const isAggressive = options.aggressive ?? false;

  if (!code || !code.trim()) {
    return {
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
  }

  const ast = parseJavaScriptAst(code);
  if (!ast || isAstAlreadyProtected(ast)) {
    return {
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
  }

  // 1. Detect hot paths (loops, array HOF callbacks, rAF, UI components, and their callees)
  const {
    report: hotPathReport,
    coldFunctionNodes,
    hotFunctionNodes,
    hotExemptNodes,
    serializedFunctionNodes,
  } = analyzeAstHotPaths(ast);

  let virtualizedFunctionsCount = 0;
  if (isAggressive) {
    const vmRes = applyMicroVm(
      ast,
      coldFunctionNodes,
      serializedFunctionNodes,
      seed
    );
    virtualizedFunctionsCount = vmRes.virtualizedCount;
  }

  // 2. Inject polymorphic opaque guards only on cold functions (<2% runtime CPU budget)
  applyColdFlowGuard(ast, coldFunctionNodes, seed, hotExemptNodes);

  // 3. Mangle local parameters & function-scoped variables safely
  const mangledSymbolsCount = applyPolymorphicMangler(
    ast,
    seed,
    serializedFunctionNodes
  );

  let encryptedStringsCount = 0;
  let integrityToken = 0;
  let shaderBuffersCount = 0;

  if (isAggressive) {
    injectWasmVault(ast, seed);
    const saltedRes = applySaltedStringVault(
      ast,
      seed,
      minStringLength,
      hotExemptNodes
    );
    encryptedStringsCount = saltedRes.encryptedStringsCount;
    integrityToken = saltedRes.integrityToken;
  } else {
    const vaultRes = applyStringVault(
      ast,
      seed,
      minStringLength,
      hotExemptNodes,
      undefined,
      undefined,
      options.deterrentMode
    );
    encryptedStringsCount = vaultRes.encryptedStringsCount;
    integrityToken = vaultRes.integrityToken;
    shaderBuffersCount = vaultRes.shaderBuffersCount ?? 0;
  }

  // 5. Generate compact single-line JavaScript output
  const outputCode = generateCompactJs(ast);

  let finalCode = outputCode;
  if (options.injectRuntimeShield) {
    const shield = generateRuntimeShield({
      seed,
      deterrentMode: options.deterrentMode ?? 'passive',
      expectedIntegrityHash: integrityToken,
    });
    if (shield.preambleCode) {
      finalCode = `${shield.preambleCode}\n${finalCode}`;
    }
  }

  return {
    code: finalCode,
    encryptedStringsCount,
    mangledSymbolsCount,
    hotPathReport,
    integrityToken,
    virtualizedFunctionsCount,
    shaderBuffersCount,
  };
}
