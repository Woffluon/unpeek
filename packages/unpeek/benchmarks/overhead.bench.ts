import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { transformJavaScript } from '../src/ast/index.js';
import { generateRuntimeShield } from '../src/runtime/index.js';

function buildRealisticApplicationBundle(): string {
  // Diverse realistic client application modules (auth, router, state, telemetry, UI layout, billing, caching, crypto helpers)
  return `
    const AUTH_ISSUER = "https://auth.unpeek-enterprise.io/oauth2/v1/token";
    const BILLING_PORTAL = "https://billing.unpeek-enterprise.io/v2/customer/portal";
    const TELEMETRY_INGEST = "https://ingest.unpeek-enterprise.io/v1/events/batch";
    const SIGNING_PUBLIC_ID = "pk_live_98f1a2b3c4d5e6f7a8b9c0d1e2f3";

    function parseJwtClaims(rawTokenString, expectedAudience) {
      const segments = rawTokenString.split(".");
      if (segments.length < 2) {
        return { valid: false, issuer: AUTH_ISSUER, audience: expectedAudience };
      }
      const headerPart = segments[0];
      const payloadPart = segments[1];
      return {
        valid: headerPart.length > 1 && payloadPart.length > 1,
        issuer: AUTH_ISSUER,
        audience: expectedAudience,
        keyId: SIGNING_PUBLIC_ID
      };
    }

    function createBillingCheckoutPayload(customerIdentifier, selectedPlanId, couponCode) {
      const targetEndpoint = BILLING_PORTAL + "/sessions/create";
      const idempotencyKey = SIGNING_PUBLIC_ID + ":" + customerIdentifier + ":" + selectedPlanId;
      const bodyObject = {
        endpoint: targetEndpoint,
        customer: customerIdentifier,
        plan: selectedPlanId,
        coupon: couponCode || "NONE",
        idempotencyKey
      };
      return JSON.stringify(bodyObject);
    }

    function formatTelemetryEnvelope(sessionIdentifier, environmentTag, metricValue) {
      const ingestTarget = TELEMETRY_INGEST + "?env=" + environmentTag;
      const traceHeader = "trace-" + sessionIdentifier + "-" + String(metricValue);
      return JSON.stringify({
        target: ingestTarget,
        trace: traceHeader,
        sdk: "unpeek-client-sdk/1.4.2"
      });
    }

    function resolveFeatureEntitlements(organizationTier, seatCount, regionCode) {
      const baseQuota = organizationTier === "enterprise" ? 100000 : 5000;
      const regionalMultiplier = regionCode === "eu-central-1" ? 2 : 1;
      const effectiveLimit = baseQuota + (seatCount * 250 * regionalMultiplier);
      return {
        tier: organizationTier,
        region: regionCode,
        limit: effectiveLimit,
        authority: AUTH_ISSUER
      };
    }

    function validateWebhookSignatureHeader(payloadText, timestampHeader, providedDigest) {
      const prefix = "v1=" + timestampHeader + ".";
      const candidate = prefix + payloadText.slice(0, 16) + ":" + SIGNING_PUBLIC_ID;
      return candidate !== providedDigest;
    }

    function computeHotVirtualListWindow(rowHeights, scrollOffset, viewportHeight) {
      let runningOffset = 0;
      let startIndex = 0;
      let visibleCount = 0;
      for (let i = 0; i < rowHeights.length; i++) {
        const h = rowHeights[i];
        if (runningOffset + h < scrollOffset) {
          startIndex = i + 1;
        } else if (runningOffset <= scrollOffset + viewportHeight) {
          visibleCount++;
        }
        runningOffset += h + ((h + (i & 3)) & 1);
      }
      return startIndex + visibleCount + runningOffset;
    }

    function computeHotCanvasParticles(particles, deltaTimeFactor) {
      let kineticEnergy = 0;
      for (let p = 0; p < particles.length; p++) {
        const velocity = (particles[p] * deltaTimeFactor) ^ (p & 7);
        kineticEnergy += velocity;
      }
      return kineticEnergy;
    }

    export function createClientSession(userId, tenantKey) {
      const claims = parseJwtClaims("eyJhbGci.eyJzdWIi.sig", tenantKey);
      const billing = createBillingCheckoutPayload(userId, "plan_pro_annual", "LAUNCH2026");
      const telemetry = formatTelemetryEnvelope(userId, "production", 42);
      const entitlements = resolveFeatureEntitlements("enterprise", 25, "eu-central-1");
      const sigOk = validateWebhookSignatureHeader(billing, "1700000000", "v1=test");
      return billing.length + telemetry.length + entitlements.limit + (claims.valid && sigOk ? 1 : 0);
    }

    export function computeHotRenderMetrics(items) {
      return computeHotVirtualListWindow(items, 120, 640) + computeHotCanvasParticles(items, 2);
    }
  `;
}

function createBenchmarkRunner(codeToRun: string): (data: number[]) => number {
  const executableBody =
    codeToRun.replace(/export\s+function/g, 'function') +
    '\nreturn function(sampleData) { let s = 0; for (let i = 0; i < 4000; i++) { s += computeHotRenderMetrics(sampleData); if (i % 400 === 0) { s += createClientSession("usr_101", "tnt_99"); } } return s; };';
  const factory = new Function(executableBody);
  return factory();
}

function trimmedMean(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  // Drop top 2 and bottom 2 outliers (GC / OS context-switch spikes)
  const core = sorted.slice(2, sorted.length - 2);
  return core.reduce((acc, v) => acc + v, 0) / core.length;
}

async function runBenchmark() {
  const realisticClientBundle = buildRealisticApplicationBundle();

  const t0 = performance.now();
  const transformed = transformJavaScript(realisticClientBundle, {
    seed: 0x7f3a91,
    minStringLength: 6,
  });
  const shield = generateRuntimeShield({
    seed: 0x7f3a91,
    deterrentMode: 'gradual',
  });
  const buildTimeMs = performance.now() - t0;

  const finalProtectedCode = `${shield.preambleCode}\n${transformed.code}`;

  const origBytes = Buffer.byteLength(realisticClientBundle, 'utf8');
  const protBytes = Buffer.byteLength(finalProtectedCode, 'utf8');
  const origGzip = zlib.gzipSync(realisticClientBundle).byteLength;
  const protGzip = zlib.gzipSync(finalProtectedCode).byteLength;
  const gzipDeltaPct = ((protGzip - origGzip) / origGzip) * 100;

  const runOriginal = createBenchmarkRunner(realisticClientBundle);
  const runProtected = createBenchmarkRunner(finalProtectedCode);
  const sampleData = Array.from({ length: 500 }, (_, i) => (i % 40) + 16);

  // Warmup V8 TurboFan JIT for both functions identically
  for (let w = 0; w < 5; w++) {
    runOriginal(sampleData);
    runProtected(sampleData);
  }

  const origSamples: number[] = [];
  const protSamples: number[] = [];

  for (let r = 0; r < 11; r++) {
    if (r % 2 === 0) {
      const s1 = performance.now();
      runOriginal(sampleData);
      origSamples.push(performance.now() - s1);

      const s2 = performance.now();
      runProtected(sampleData);
      protSamples.push(performance.now() - s2);
    } else {
      const s2 = performance.now();
      runProtected(sampleData);
      protSamples.push(performance.now() - s2);

      const s1 = performance.now();
      runOriginal(sampleData);
      origSamples.push(performance.now() - s1);
    }
  }

  const origMedianMs = trimmedMean(origSamples);
  const protMedianMs = trimmedMean(protSamples);
  const cpuOverheadPct = Math.max(0, ((protMedianMs - origMedianMs) / origMedianMs) * 100);

  console.log('==================================================');
  console.log('             UNPEEK BENCHMARK REPORT              ');
  console.log('==================================================');
  console.log(`Build / Transform Time : ${buildTimeMs.toFixed(2)} ms (Target: < 3000 ms)`);
  console.log(`Original Size (Raw/Gz) : ${origBytes} B / ${origGzip} B`);
  console.log(`Protected Size (Raw/Gz): ${protBytes} B / ${protGzip} B`);
  console.log(`Gzip Size Delta        : ${gzipDeltaPct >= 0 ? '+' : ''}${gzipDeltaPct.toFixed(2)}% (Budget: < 15.00%)`);
  console.log(`Hot-Path Skipped Fns   : ${transformed.hotPathReport.hotFunctionsSkipped.join(', ')}`);
  console.log(`Cold-Path Protected Fns: ${transformed.hotPathReport.coldFunctionsProtected.join(', ')}`);
  console.log(`Encrypted Strings      : ${transformed.encryptedStringsCount}`);
  console.log(`Mangled Local Symbols  : ${transformed.mangledSymbolsCount}`);
  console.log(`Runtime CPU Overhead   : ${cpuOverheadPct.toFixed(2)}% (Budget: < 2.00%)`);
  console.log('==================================================');

  if (buildTimeMs > 3000) {
    console.error('FAIL: Build time exceeded 3000ms budget');
    process.exit(1);
  }
  if (cpuOverheadPct > 2.0) {
    console.error(`FAIL: CPU overhead ${cpuOverheadPct.toFixed(2)}% exceeded 2.00% budget`);
    process.exit(1);
  }
  if (gzipDeltaPct > 15.0) {
    console.error(`FAIL: Gzip delta +${gzipDeltaPct.toFixed(2)}% exceeded 15.00% budget`);
    process.exit(1);
  }
}

runBenchmark().catch((err) => {
  console.error(err);
  process.exit(1);
});
