import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { relocateSourceMaps, stripSourceMapComments } from '../src/core/sourcemap-vault.js';
import {
  chainSourceMaps,
  decodeMappings,
  decodeVlq,
  encodeMappings,
  encodeVlq,
  resolvePosition,
  symbolicateStackTrace,
} from '../src/core/vlq.js';
import { UnpeekError } from '../src/shared/errors.js';

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

  it('preserves //# debugId=<uuid> when stripping //# sourceMappingURL=', () => {
    const input = 'console.log("hi");\n//# debugId=12345678-1234-4321-abcd-1234567890ab\n//# sourceMappingURL=app.js.map\n';
    const res = stripSourceMapComments(input);
    expect(res.stripped).toBe(true);
    expect(res.debugId).toBe('12345678-1234-4321-abcd-1234567890ab');
    expect(res.code).not.toContain('sourceMappingURL=');
    expect(res.code).toContain('//# debugId=12345678-1234-4321-abcd-1234567890ab');
  });

  it('encodes/decodes VLQ, chains map_B o map_A, and symbolicating handles malformed VLQ gracefully', async () => {
    for (const n of [0, 1, -1, 15, -16, 1234, -9876]) {
      const enc = encodeVlq(n);
      const dec = decodeVlq(enc, 0);
      expect(dec).toEqual({ value: n, nextIndex: enc.length });
    }

    const mapA = {
      version: 3,
      sources: ['src/app.ts'],
      names: ['secretFn'],
      mappings: encodeMappings([
        { generatedLine: 0, generatedColumn: 10, sourceIndex: 0, originalLine: 4, originalColumn: 2, nameIndex: 0 },
      ]),
      debugId: 'dbg-uuid-1',
    };
    const mapB = {
      version: 3,
      sources: ['dist/app.js'],
      names: [],
      mappings: encodeMappings([
        { generatedLine: 0, generatedColumn: 25, sourceIndex: 0, originalLine: 0, originalColumn: 10 },
      ]),
    };

    const chained = chainSourceMaps(mapB, mapA);
    expect(chained.debugId).toBe('dbg-uuid-1');
    const pos = resolvePosition(chained, 1, 26);
    expect(pos).toMatchObject({
      source: 'src/app.ts',
      line: 5,
      column: 3,
      name: 'secretFn',
      malformedCount: 0,
    });

    // symbolicateStackTrace with valid map and malformed VLQ segment
    const mapsDir = path.join(tmpDir, '.unpeek-maps');
    fs.mkdirSync(mapsDir, { recursive: true });
    fs.writeFileSync(path.join(mapsDir, 'app.js.map'), JSON.stringify(chained), 'utf8');
    fs.writeFileSync(
      path.join(mapsDir, 'broken.js.map'),
      JSON.stringify({ version: 3, sources: ['src/b.ts'], names: [], mappings: '!!!BAD_VLQ!!!' }),
      'utf8'
    );

    const symRes = await symbolicateStackTrace({
      cwd: tmpDir,
      mapsDir: '.unpeek-maps',
      stackTrace: [
        'Error: boom',
        '    at _u$x (https://cdn.example.com/assets/app.js:1:26)',
        '    at _u$y (broken.js:1:5)',
      ].join('\n'),
    });

    expect(symRes.frames[1]).toMatchObject({
      resolved: true,
      originalSource: 'src/app.ts',
      originalLine: 5,
      originalColumn: 3,
      originalName: 'secretFn',
    });
    expect(symRes.stackTrace).toContain('src/app.ts:5:3');
    expect(symRes.frames[2].resolved).toBe(false);
    expect(symRes.warnings.some((w) => w.includes('malformed VLQ'))).toBe(true);
    expect(decodeMappings('!!!').malformedCount).toBeGreaterThan(0);
  });
});
