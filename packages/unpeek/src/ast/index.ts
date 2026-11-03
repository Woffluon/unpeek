import { generate } from 'astring';
import type { TransformOptions, TransformResult } from '../types.js';
import {
  analyzeAstHotPaths,
  detectHotPaths,
  parseJavaScriptAst,
} from './hot-path-detector.js';
import { applyStringVault, computeFnv1aHash } from './string-vault.js';
import { applyPolymorphicMangler } from './polymorphic-mangler.js';
import { applyColdFlowGuard } from './cold-flow-guard.js';

export { detectHotPaths } from './hot-path-detector.js';
export { computeFnv1aHash } from './string-vault.js';

export function transformJavaScript(
  code: string,
  options: TransformOptions = {}
): TransformResult {
  const seed = options.seed ?? 0x9e3779b9;
  const minStringLength = options.minStringLength ?? 4;

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
    };
  }

  const ast = parseJavaScriptAst(code);
  if (!ast) {
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
    };
  }

  // 1. Detect hot paths (loops, array HOF callbacks, rAF, UI components)
  const { report: hotPathReport, coldFunctionNodes } = analyzeAstHotPaths(ast);

  // 2. Inject polymorphic opaque guards only on cold functions (<2% runtime CPU budget)
  applyColdFlowGuard(ast, coldFunctionNodes, seed);

  // 3. Mangle local parameters & function-scoped variables safely
  const mangledSymbolsCount = applyPolymorphicMangler(ast, seed);

  // 4. Encrypt eligible string literals into an O(1) lazy inline-cached vault
  const { encryptedStringsCount, integrityToken } = applyStringVault(
    ast,
    seed,
    minStringLength
  );

  // 5. Generate compact single-line JavaScript output
  const outputCode = generate(ast, { indent: '', lineEnd: '' });

  return {
    code: outputCode,
    encryptedStringsCount,
    mangledSymbolsCount,
    hotPathReport,
    integrityToken,
  };
}
