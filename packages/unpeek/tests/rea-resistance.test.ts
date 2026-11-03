import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { transformJavaScript } from '../src/ast/index.js';
import { generateRuntimeShield, verifyCodeIntegrity, computeIntegrityHash } from '../src/runtime/index.js';

describe('Reverse Engineering & Deobfuscation Resistance (Acceptance Thresholds)', () => {
  const sampleSource = `
    const STRIPE_INTERNAL_ENDPOINT = "https://billing.internal.corp/v1/charge";
    const LICENSE_SIGNING_SECRET = "unpeek_prod_key_998877665544";

    function validateLicensePayload(customerToken, planTier) {
      const targetUrl = STRIPE_INTERNAL_ENDPOINT;
      const signingSecret = LICENSE_SIGNING_SECRET;
      const combined = customerToken + ":" + planTier + ":" + signingSecret + "@" + targetUrl;
      return combined;
    }

    function renderFrameLoop(points) {
      let sum = 0;
      for (let idx = 0; idx < points.length; idx++) {
        sum += points[idx] * 2;
      }
      return sum;
    }
  `;

  it('eliminates 100% of sensitive string literals and local parameter/variable names from static plaintext inspection', () => {
    const result = transformJavaScript(sampleSource, {
      seed: 0x123456,
      minStringLength: 4,
    });

    // 1. Sensitive strings must not appear in plaintext
    expect(result.code).not.toContain('https://billing.internal.corp/v1/charge');
    expect(result.code).not.toContain('unpeek_prod_key_998877665544');

    // 2. Local variable and parameter identifiers inside functions must be mangled
    expect(result.code).not.toContain('customerToken');
    expect(result.code).not.toContain('planTier');
    expect(result.code).not.toContain('signingSecret');
    expect(result.mangledSymbolsCount).toBeGreaterThan(0);
    expect(result.encryptedStringsCount).toBeGreaterThanOrEqual(2);
  });

  it('preserves 100% semantic equivalence and automatically exempts hot-path loops', () => {
    const result = transformJavaScript(sampleSource, {
      seed: 0x998877,
      minStringLength: 4,
    });

    expect(result.hotPathReport.hotFunctionsSkipped).toContain('renderFrameLoop');
    expect(result.hotPathReport.coldFunctionsProtected).toContain('validateLicensePayload');

    const ctx = vm.createContext({});
    vm.runInContext(
      `${result.code}\n;globalThis.out1 = validateLicensePayload("cus_42", "pro"); globalThis.out2 = renderFrameLoop([1, 2, 3, 4]);`,
      ctx
    );

    expect(ctx.out1).toBe(
      'cus_42:pro:unpeek_prod_key_998877665544@https://billing.internal.corp/v1/charge'
    );
    expect(ctx.out2).toBe(20);
  });

  it('produces polymorphic AST outputs across different build seeds to defeat static pattern-matching deobfuscators', () => {
    const buildA = transformJavaScript(sampleSource, { seed: 10101 });
    const buildB = transformJavaScript(sampleSource, { seed: 20202 });

    expect(buildA.code).not.toBe(buildB.code);
    expect(buildA.integrityToken).not.toBe(buildB.integrityToken);
  });

  it('detects DevTools Pretty-Print / formatting tampering with 0% false positives on untouched minified code', () => {
    const minifiedFn = 'function _0x1a(a,b){return a+b;}';
    const expectedHash = computeIntegrityHash(minifiedFn, 42);

    // Untouched code passes (0% false positive)
    expect(verifyCodeIntegrity(minifiedFn, expectedHash, 42)).toBe(true);

    // Pretty-printed / beautified code fails integrity check immediately
    const prettyPrintedFn = 'function _0x1a(a, b) {\n  return a + b;\n}';
    expect(verifyCodeIntegrity(prettyPrintedFn, expectedHash, 42)).toBe(false);

    // Runtime shield executes safely in SSR (no window) without throwing
    const shield = generateRuntimeShield({ seed: 42, deterrentMode: 'gradual' });
    expect(() => vm.runInNewContext(shield.preambleCode, {})).not.toThrow();
  });
});
