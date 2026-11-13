import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { relocateSourceMaps } from '../src/bundler/sourcemap-vault.js';
import { UnpeekError } from '../src/errors.js';

describe('SourceMap Vault Security & Ignore File Controls', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unpeek-vault-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects ../ path traversal outside cwd with ERR_SECURITY_PATH_TRAVERSAL', () => {
    const outDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'app.js.map'), '{}', 'utf8');

    let caught: unknown;
    try {
      relocateSourceMaps(outDir, tmpDir, true, '../escaped-maps');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UnpeekError);
    expect((caught as UnpeekError).code).toBe('ERR_SECURITY_PATH_TRAVERSAL');
  });

  it('does not mutate ignore files when updateIgnoreFiles is false', () => {
    const outDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'app.js.map'), '{}', 'utf8');

    const gitignorePath = path.join(tmpDir, '.gitignore');
    const dockerignorePath = path.join(tmpDir, '.dockerignore');
    const npmignorePath = path.join(tmpDir, '.npmignore');
    fs.writeFileSync(gitignorePath, 'node_modules\n', 'utf8');
    fs.writeFileSync(dockerignorePath, 'node_modules\n', 'utf8');
    fs.writeFileSync(npmignorePath, 'tests\n', 'utf8');

    const res = relocateSourceMaps(outDir, tmpDir, true, '.unpeek-maps', true, undefined, {
      updateIgnoreFiles: false,
    });

    expect(res.movedMapsCount).toBe(1);
    expect(fs.readFileSync(gitignorePath, 'utf8')).toBe('node_modules\n');
    expect(fs.readFileSync(dockerignorePath, 'utf8')).toBe('node_modules\n');
    expect(fs.readFileSync(npmignorePath, 'utf8')).toBe('tests\n');
  });
});
