import fs from 'node:fs';
import path from 'node:path';
import type { SourceMapVaultResult } from '../types.js';
import { scanClientBundles } from './detector.js';

export const SOURCE_MAP_COMMENT_REGEX =
  /(?:^\s*\/\/[#@]\s*sourceMappingURL=.*$|\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\/)\s*/gm;

function ensureIgnoreEntry(cwd: string, fileName: string, entryName: string): void {
  const filePath = path.join(path.resolve(cwd), fileName);
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const normalizedEntry = entryName.endsWith('/') ? entryName : `${entryName}/`;
  const bareEntry = normalizedEntry.slice(0, -1);
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  if (!lines.includes(normalizedEntry) && !lines.includes(bareEntry)) {
    const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(filePath, `${content}${prefix}${normalizedEntry}\n`, 'utf8');
  }
}

function isSubdirectoryOrSame(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function relocateSourceMaps(
  outDir: string,
  cwd: string,
  keepPrivateMaps: boolean = true,
  privateMapsDir: string = '.unpeek-maps',
  stripComments: boolean = true
): SourceMapVaultResult {
  const resolvedOutDir = path.resolve(outDir);
  const resolvedCwd = path.resolve(cwd);
  const vaultDir = path.resolve(resolvedCwd, privateMapsDir || '.unpeek-maps');
  const resolvedPublicDir = path.resolve(resolvedCwd, 'public');

  if (keepPrivateMaps !== false) {
    if (isSubdirectoryOrSame(resolvedOutDir, vaultDir)) {
      throw new Error(
        `[unpeek] Security Error: privateMapsDir cannot be located inside outDir (${resolvedOutDir}). This would expose private source maps to the web server.`
      );
    }
    if (isSubdirectoryOrSame(resolvedPublicDir, vaultDir)) {
      throw new Error(
        `[unpeek] Security Error: privateMapsDir cannot be located inside publicDir (${resolvedPublicDir}). This would expose private source maps to the web server.`
      );
    }
  }

  const movedFiles: string[] = [];
  let movedMapsCount = 0;
  let strippedFilesCount = 0;

  if (!fs.existsSync(resolvedOutDir)) {
    return {
      movedMapsCount: 0,
      strippedFilesCount: 0,
      vaultDir,
      movedFiles: [],
    };
  }

  function walkForMaps(currentDir: string): void {
    const normalized = currentDir.replace(/\\/g, '/');
    if (
      normalized.includes('/.next/server') ||
      normalized.includes('/node_modules') ||
      normalized.includes('/.unpeek-maps')
    ) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.unpeek-maps' ||
          entry.name === 'server' ||
          entry.name === 'ssr'
        ) {
          continue;
        }
        walkForMaps(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.map')) {
        if (keepPrivateMaps !== false) {
          const relPath = path.relative(resolvedOutDir, fullPath);
          const targetPath = path.join(vaultDir, relPath);
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.copyFileSync(fullPath, targetPath);
          fs.unlinkSync(fullPath);
          movedFiles.push(targetPath);
        } else {
          fs.unlinkSync(fullPath);
        }
        movedMapsCount++;
      }
    }
  }

  walkForMaps(resolvedOutDir);

  if (keepPrivateMaps !== false && movedMapsCount > 0) {
    const relVault = path.relative(resolvedCwd, vaultDir).replace(/\\/g, '/');
    const ignoreEntry = relVault && !relVault.startsWith('..') ? `${relVault}/` : '.unpeek-maps/';
    ensureIgnoreEntry(resolvedCwd, '.gitignore', ignoreEntry);
    ensureIgnoreEntry(resolvedCwd, '.dockerignore', ignoreEntry);
    ensureIgnoreEntry(resolvedCwd, '.npmignore', ignoreEntry);
  }

  if (stripComments) {
    const clientFiles = scanClientBundles(resolvedOutDir);
    for (const filePath of clientFiles) {
      const original = fs.readFileSync(filePath, 'utf8');
      if (original.includes('sourceMappingURL=')) {
        const stripped = original.replace(SOURCE_MAP_COMMENT_REGEX, '');
        if (stripped !== original) {
          fs.writeFileSync(filePath, stripped, 'utf8');
          strippedFilesCount++;
        }
      }
    }
  }

  return {
    movedMapsCount,
    strippedFilesCount,
    vaultDir,
    movedFiles,
  };
}
