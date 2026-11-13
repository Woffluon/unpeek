import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_BUILTIN_PATTERN = /node:(fs|path|url|module|zlib|crypto)/;

function collectReachableBundles(entryFile: string): string[] {
  const visited = new Set<string>();
  const queue: string[] = [path.resolve(entryFile)];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current) || !fs.existsSync(current)) continue;
    visited.add(current);

    const content = fs.readFileSync(current, 'utf8');
    const dir = path.dirname(current);

    // Match ESM relative imports (from "./chunk-XYZ.js") and CJS relative requires (require('./chunk-XYZ.cjs'))
    const relPattern = /(?:from\s+["']|require\(["'])(\.[^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = relPattern.exec(content)) !== null) {
      queue.push(path.resolve(dir, match[1]));
    }
  }

  return Array.from(visited);
}

describe('Browser Bundle Node Core Isolation (M-13)', () => {
  const testsDir = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.resolve(testsDir, '..', 'dist');

  it('dist/browser.js and its reachable chunks contain zero node:* builtin imports', () => {
    const entry = path.join(distDir, 'browser.js');
    expect(fs.existsSync(entry)).toBe(true);

    const files = collectReachableBundles(entry);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content, `Unexpected node:* reference in ${path.basename(file)}`).not.toMatch(
        NODE_BUILTIN_PATTERN
      );
    }
  });

  it('dist/browser.cjs and its reachable chunks contain zero node:* builtin requires', () => {
    const entry = path.join(distDir, 'browser.cjs');
    expect(fs.existsSync(entry)).toBe(true);

    const files = collectReachableBundles(entry);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content, `Unexpected node:* reference in ${path.basename(file)}`).not.toMatch(
        NODE_BUILTIN_PATTERN
      );
    }
  });
});
