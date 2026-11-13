import fs from 'node:fs';
import path from 'node:path';
import type { SourceMapVaultResult, UnpeekConfig } from '../types.js';
import { UnpeekError } from '../errors.js';
import { hasNextServerSegment, scanClientBundles } from './detector.js';

export const SOURCE_MAP_COMMENT_REGEX =
  /(?:^\s*\/\/[#@]\s*sourceMappingURL=.*$|\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\/)\s*/gm;

function ensureIgnoreEntry(dir: string, fileName: string, entryName: string): void {
  const filePath = path.join(path.resolve(dir), fileName);
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const normalizedEntry = entryName.endsWith('/') ? entryName : `${entryName}/`;
  const bareEntry = normalizedEntry.slice(0, -1);
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  if (
    !lines.includes(normalizedEntry) &&
    !lines.includes(bareEntry) &&
    !lines.includes('.unpeek-maps') &&
    !lines.includes('.unpeek-maps/')
  ) {
    const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(filePath, `${content}${prefix}${normalizedEntry}\n`, 'utf8');
  }
}

function isSubdirectoryOrSame(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function findMonorepoRoots(cwd: string): string[] {
  const resolved = path.resolve(cwd);
  const dirs: string[] = [resolved];
  let curr = resolved;

  while (true) {
    const parent = path.dirname(curr);
    if (!parent || parent === curr) {
      break;
    }
    const hasGit = fs.existsSync(path.join(parent, '.git'));
    const hasWorkspace = fs.existsSync(path.join(parent, 'pnpm-workspace.yaml'));
    const hasGitIgnore = fs.existsSync(path.join(parent, '.gitignore'));
    const hasDockerIgnore = fs.existsSync(path.join(parent, '.dockerignore'));
    const hasPkgJson = fs.existsSync(path.join(parent, 'package.json'));

    if (hasGit || hasWorkspace || hasGitIgnore || hasDockerIgnore || hasPkgJson) {
      dirs.push(parent);
    }
    if (hasGit || hasWorkspace) {
      break;
    }
    curr = parent;
  }

  return dirs;
}

function checkDockerIgnoreMissing(cwd: string, ignoreEntry: string): boolean {
  const candidateDirs = findMonorepoRoots(cwd);
  let foundAnyDockerIgnore = false;

  for (const dir of candidateDirs) {
    const filePath = path.join(dir, '.dockerignore');
    if (fs.existsSync(filePath)) {
      foundAnyDockerIgnore = true;
      const content = fs.readFileSync(filePath, 'utf8');
      const normalizedEntry = ignoreEntry.endsWith('/') ? ignoreEntry : `${ignoreEntry}/`;
      const bareEntry = normalizedEntry.slice(0, -1);
      const lines = content.split(/\r?\n/).map((line) => line.trim());
      if (
        lines.includes(normalizedEntry) ||
        lines.includes(bareEntry) ||
        lines.includes('.unpeek-maps') ||
        lines.includes('.unpeek-maps/')
      ) {
        return false;
      }
    }
  }

  return true;
}

function updateAllIgnoreFiles(cwd: string, vaultDir: string): void {
  const candidateDirs = findMonorepoRoots(cwd);
  for (const dir of candidateDirs) {
    const relFromDir = path.relative(dir, vaultDir).replace(/\\/g, '/');
    const entry = relFromDir && !relFromDir.startsWith('..') ? `${relFromDir}/` : '.unpeek-maps/';

    ensureIgnoreEntry(dir, '.gitignore', entry);
    ensureIgnoreEntry(dir, '.dockerignore', entry);
    ensureIgnoreEntry(dir, '.npmignore', entry);
  }
}

export interface RelocateSourceMapsOptions {
  /** Whether to update .gitignore/.dockerignore/.npmignore files (default: true). */
  updateIgnoreFiles?: boolean;
}

export function relocateSourceMaps(
  outDir: string,
  cwd: string,
  keepPrivateMaps: boolean = true,
  privateMapsDir: string = '.unpeek-maps',
  stripComments: boolean = true,
  config?: UnpeekConfig,
  options?: boolean | RelocateSourceMapsOptions
): SourceMapVaultResult {
  const resolvedOutDir = path.resolve(outDir);
  const resolvedCwd = path.resolve(cwd);
  const effectiveVaultDirName = config?.sourcemaps?.vaultDir ?? privateMapsDir ?? '.unpeek-maps';
  const effectiveKeepPrivate = config?.sourcemaps?.keepPrivate ?? keepPrivateMaps;
  const effectiveStripComments = config?.sourcemaps?.stripComments ?? stripComments;
  const updateIgnoreFiles =
    typeof options === 'boolean' ? options : (options?.updateIgnoreFiles ?? true);
  const vaultDir = path.resolve(resolvedCwd, effectiveVaultDirName);

  const publicDirsToCheck = new Set<string>();
  if (config?.publicDirs && config.publicDirs.length > 0) {
    for (const d of config.publicDirs) {
      publicDirsToCheck.add(d);
    }
  } else {
    publicDirsToCheck.add('public');
    publicDirsToCheck.add('static');
    publicDirsToCheck.add('assets');
  }

  if (effectiveKeepPrivate !== false) {
    if (!isSubdirectoryOrSame(resolvedCwd, vaultDir)) {
      throw new UnpeekError(
        'ERR_SECURITY_PATH_TRAVERSAL',
        `[unpeek] Security Error: privateMapsDir (${vaultDir}) cannot traverse outside cwd (${resolvedCwd}).`
      );
    }
    if (isSubdirectoryOrSame(resolvedOutDir, vaultDir)) {
      throw new Error(
        `[unpeek] Security Error: privateMapsDir cannot be located inside outDir (${resolvedOutDir}). This would expose private source maps to the web server.`
      );
    }
    for (const pubDir of publicDirsToCheck) {
      const resolvedPublicDir = path.resolve(resolvedCwd, pubDir);
      if (isSubdirectoryOrSame(resolvedPublicDir, vaultDir)) {
        throw new Error(
          `[unpeek] Security Error: privateMapsDir cannot be located inside publicDir (${resolvedPublicDir}). This would expose private source maps to the web server.`
        );
      }
    }
  }

  const relVault = path.relative(resolvedCwd, vaultDir).replace(/\\/g, '/');
  const ignoreEntry = relVault && !relVault.startsWith('..') ? `${relVault}/` : '.unpeek-maps/';
  const dockerIgnoreMissing = checkDockerIgnoreMissing(resolvedCwd, ignoreEntry);

  const movedFiles: string[] = [];
  let movedMapsCount = 0;
  let strippedFilesCount = 0;

  if (!fs.existsSync(resolvedOutDir)) {
    return {
      movedMapsCount: 0,
      strippedFilesCount: 0,
      vaultDir,
      movedFiles: [],
      dockerIgnoreMissing,
    };
  }

  function walkForMaps(currentDir: string): void {
    if (hasNextServerSegment(currentDir, resolvedOutDir)) {
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
        if (entry.name === 'node_modules' || entry.name === '.unpeek-maps') {
          continue;
        }
        if (hasNextServerSegment(fullPath, resolvedOutDir)) {
          continue;
        }
        walkForMaps(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.map')) {
        if (effectiveKeepPrivate !== false) {
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

  if (updateIgnoreFiles && effectiveKeepPrivate !== false && movedMapsCount > 0) {
    updateAllIgnoreFiles(resolvedCwd, vaultDir);
  }

  if (effectiveStripComments) {
    const clientFiles = scanClientBundles(resolvedOutDir, config);
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
    dockerIgnoreMissing,
  };
}
