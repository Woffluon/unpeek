import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkProject } from '../src/core/check.js';
import { protectProject } from '../src/core/protect.js';

function createTempProject(prefix = 'unpeek-secret-audit-'): {
  tmpDir: string;
  distDir: string;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const distDir = path.join(tmpDir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.unpeek-maps/\n', 'utf8');
  return { tmpDir, distDir };
}

describe('Plaintext Secret Audit in checkProject', () => {
  let tmpDir: string;
  let distDir: string;

  beforeEach(() => {
    ({ tmpDir, distDir } = createTempProject());
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects PEM headers, sk_live API keys, high-entropy tokens, template literals, and regex secret runs with redacted previews', async () => {
    const pemHeader = '-----BEGIN RSA PRIVATE KEY-----';
    const stripeKey = 'sk_' + 'live_51AbCdEf9GhIjKl2MnOpQr4StUvWx7Yz012345';
    const randomToken = 'q9_X7-mK2_vP8-zL4_wR6-nT3_jB5-yF1';
    const templateSecret = 'sk_' + 'live_98ZyXwVuTsRqPoNmLkJiHgFeDcBa654321';
    const regexDigest = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';

    fs.writeFileSync(
      path.join(distDir, 'leaked.js'),
      [
        `const pem = "${pemHeader}";`,
        `const apiKey = "${stripeKey}";`,
        `const token = "${randomToken}";`,
        `const tpl = \`prefix-\${Date.now()}-${templateSecret}\`;`,
        `const digestRe = /^${regexDigest}$/;`,
        'export { pem, apiKey, token, tpl, digestRe };',
      ].join('\n'),
      'utf8'
    );

    const res = await checkProject({
      cwd: tmpDir,
      outDir: 'dist',
      failOnPlaintextSecrets: true,
    });

    const secretFindings = res.violations.filter((v) => v.rule === 'plaintext-secret');
    expect(res.passed).toBe(false);
    expect(secretFindings).toHaveLength(5);

    for (const finding of secretFindings) {
      expect(finding.severity).toBe('error');
      expect(finding.file).toBe('leaked.js');
      expect(finding.message).toContain('line ');
      expect(finding.message).not.toContain(pemHeader);
      expect(finding.message).not.toContain(stripeKey);
      expect(finding.message).not.toContain(randomToken);
      expect(finding.message).not.toContain(templateSecret);
      expect(finding.message).not.toContain(regexDigest);
    }

    const joined = secretFindings.map((f) => f.message).join('\n');
    expect(joined).toContain('----...----');
    expect(joined).toContain('sk_l...2345');
    expect(joined).toContain('q9_X...-yF1');
    expect(joined).toContain('...4321');
    expect(joined).toContain('^5e8...2d8$');
  });

  it('defaults failOnPlaintextSecrets to false (warning, passed: true) and fails when failOnPlaintextSecrets is true', async () => {
    const apiKey = 'sk_' + 'live_51WarningModeCheckKey9876543210abcd';
    fs.writeFileSync(
      path.join(distDir, 'app.js'),
      `export const config = { key: "${apiKey}" };\n`,
      'utf8'
    );

    const defaultRes = await checkProject({ cwd: tmpDir, outDir: 'dist' });
    expect(defaultRes.passed).toBe(true);
    expect(defaultRes.violations.filter((v) => v.rule === 'plaintext-secret')).toHaveLength(0);
    const defaultWarnings = defaultRes.warnings.filter((w) => w.rule === 'plaintext-secret');
    expect(defaultWarnings).toHaveLength(1);
    expect(defaultWarnings[0].severity).toBe('warning');
    expect(defaultWarnings[0].message).not.toContain(apiKey);

    const explicitFalseRes = await checkProject({
      cwd: tmpDir,
      outDir: 'dist',
      failOnPlaintextSecrets: false,
    });
    expect(explicitFalseRes.passed).toBe(true);
    expect(explicitFalseRes.warnings.filter((w) => w.rule === 'plaintext-secret')).toHaveLength(1);

    const strictRes = await checkProject({
      cwd: tmpDir,
      outDir: 'dist',
      failOnPlaintextSecrets: true,
    });
    expect(strictRes.passed).toBe(false);
    expect(strictRes.warnings.filter((w) => w.rule === 'plaintext-secret')).toHaveLength(0);
    const strictViolations = strictRes.violations.filter((v) => v.rule === 'plaintext-secret');
    expect(strictViolations).toHaveLength(1);
    expect(strictViolations[0].severity).toBe('error');
    expect(strictViolations[0].message).not.toContain(apiKey);
  });

  it('avoids false positives on UI copy, natural prose, file paths, directives, module specifiers, binary URIs, and unpeek vault declarations', async () => {
    fs.writeFileSync(
      path.join(distDir, 'clean.js'),
      [
        '"use strict";',
        '"use client";',
        'import { helper } from "./chunks/a9f3e21b8c7d6e5f4a3b2c1d0e9f8a7b.js";',
        'import dataMod from "./assets/theme.json" with { type: "json" };',
        'export { something } from "../vendor/e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3.js";',
        'export * from "./modules/f1e2d3c4b5a697887766554433221100.mjs";',
        `const _uP1 = ["${'sk_' + 'live_'}51ShouldBeSkippedInsideVaultP", "q9_X7-mK2_vP8-zL4_wR6-nT3_jB5-yF1"];`,
        'const _uC1 = ["-----BEGIN PRIVATE KEY-----"];',
        `const _uD1 = (function () { return "${'sk_' + 'live_'}51ShouldBeSkippedInsideVaultD"; })();`,
        'function _uS1() { return "q9_X7-mK2_vP8-zL4_wR6-nT3_jB5-yF1"; }',
        `const _uSb1 = ["${'sk_' + 'live_'}51ShouldBeSkippedInsideVaultSb"];`,
        'function _uDec1() { return "-----BEGIN RSA PRIVATE KEY-----"; }',
        'export function renderBanner() {',
        '  const headline = "Welcome back, please sign in to continue to your workspace.";',
        '  const notice = "Your account settings and notification preferences were saved successfully.";',
        '  const ident = "AuthenticationSessionConfigurationManager";',
        '  const componentPath = "./components/auth/LoginForm.tsx";',
        '  const stylePath = "@acme/design-system/styles/tokens.css";',
        '  const iconUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";',
        '  const wasmHeader = "AGFzbQEAAAABBQFgAAF/AwIBAAcJAQVtZW1vcnkCAAoKAgAIAEEAEAs=";',
        '  const validationRe = /^[a-zA-Z0-9_-]{3,32}$/;',
        '  const dyn = () => import("./chunks/99887766554433221100ffeeddccbbaa.js");',
        '  return { helper, dataMod, headline, notice, ident, componentPath, stylePath, iconUri, wasmHeader, validationRe, dyn };',
        '}',
      ].join('\n'),
      'utf8'
    );

    const res = await checkProject({
      cwd: tmpDir,
      outDir: 'dist',
      failOnPlaintextSecrets: true,
    });

    expect(res.passed).toBe(true);
    expect(res.violations.filter((v) => v.rule === 'plaintext-secret')).toHaveLength(0);
    expect(res.warnings.filter((w) => w.rule === 'plaintext-secret')).toHaveLength(0);
  });

  it('produces zero plaintext-secret false positives on unpeek-protected vault output', async () => {
    const longPem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAv7mN9xQpL2rT5wYz8bK4nJ1hF6dS3aW0cE9uI2oP5qR8sT1v',
      'X4yZ7bN0mK3jH6gF9dS2aL5pO8iU1yT4rE7wQ0mN3bV6cX9zA2sD5fG8hJ1kL4pO',
      '7iU0yT3rE6wQ9mN2bV5cX8zA1sD4fG7hJ0kL3pO6iU9yT2rE5wQ8mN1bV4cX7zA0',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');

    fs.writeFileSync(
      path.join(distDir, 'protected.js'),
      [
        'export function getRuntimeCredentials() {',
        '  return {',
        `    apiKey: "${'sk_' + 'live_'}51ProtectedByUnpeekVaultKey987654321",`,
        '    token: "q9_X7-mK2_vP8-zL4_wR6-nT3_jB5-yF1",',
        `    pem: ${JSON.stringify(longPem)},`,
        '  };',
        '}',
      ].join('\n'),
      'utf8'
    );

    await protectProject({
      cwd: tmpDir,
      outDir: 'dist',
      seed: 0x12345678,
      keepPrivateMaps: true,
    });

    const checkRes = await checkProject({
      cwd: tmpDir,
      outDir: 'dist',
      failOnPlaintextSecrets: true,
    });

    expect(checkRes.violations.filter((v) => v.rule === 'plaintext-secret')).toHaveLength(0);
    expect(checkRes.warnings.filter((w) => w.rule === 'plaintext-secret')).toHaveLength(0);
    expect(checkRes.passed).toBe(true);
  });

  it('caps findings at 5 per file and safely skips unparseable JavaScript files', async () => {
    const lines = Array.from({ length: 7 }, (_, i) => {
      const idx = i + 1;
      return `export const secret${idx} = "${'sk_' + 'live_'}51CapTestKeyNumber${idx}AbCdEfGhIjKlMnOp";`;
    });
    fs.writeFileSync(path.join(distDir, 'many.js'), lines.join('\n'), 'utf8');
    fs.writeFileSync(path.join(distDir, 'broken.js'), 'function ( { invalid syntax', 'utf8');

    const res = await checkProject({
      cwd: tmpDir,
      outDir: 'dist',
      failOnPlaintextSecrets: true,
    });

    expect(res.passed).toBe(false);
    const manyFindings = res.violations.filter(
      (v) => v.rule === 'plaintext-secret' && v.file === 'many.js'
    );
    const brokenFindings = res.violations.filter(
      (v) => v.rule === 'plaintext-secret' && v.file === 'broken.js'
    );
    expect(manyFindings).toHaveLength(5);
    expect(brokenFindings).toHaveLength(0);
  });
});
