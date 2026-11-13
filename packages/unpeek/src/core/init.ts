import fs from 'node:fs';
import path from 'node:path';
import type { InitOptions, InitResult } from './types.js';
import { detectTargetFramework } from './detector.js';
import { UnpeekError } from '../shared/errors.js';
import { isNext16OrAbove } from '../internal/next.js';

export type { InitOptions, InitResult };

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function detectIndentation(rawJson: string): string | number {
  const match = rawJson.match(/^[ \t]+(?=["{\[])/m);
  if (!match) return 2;
  const indent = match[0];
  if (indent.includes('\t')) return '\t';
  return indent.length;
}

const NEXT_CONFIG_FILES = ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next.config.cjs'];

function wireNextConfig(rootDir: string, dryRun: boolean): { updated: boolean; filename: string } {
  let targetFile: string | undefined;
  for (const f of NEXT_CONFIG_FILES) {
    if (fs.existsSync(path.join(rootDir, f))) {
      targetFile = f;
      break;
    }
  }

  if (!targetFile) {
    const defaultMjs = `import { withUnpeek } from 'unpeek/next';\n\n/** @type {import('next').NextConfig} */\nconst nextConfig = {};\n\nexport default withUnpeek(nextConfig);\n`;
    if (!dryRun) {
      fs.writeFileSync(path.join(rootDir, 'next.config.mjs'), defaultMjs, 'utf8');
    }
    return { updated: true, filename: 'next.config.mjs' };
  }

  const filePath = path.join(rootDir, targetFile);
  const content = fs.readFileSync(filePath, 'utf8');

  if (content.includes('withUnpeek')) {
    return { updated: false, filename: targetFile };
  }

  const isCjs = targetFile.endsWith('.cjs') || (targetFile.endsWith('.js') && !content.includes('import ') && !content.includes('export '));

  let modified = content;
  if (isCjs) {
    const importStmt = `const { withUnpeek } = require('unpeek/next');\n`;
    modified = `${importStmt}${modified}`;

    if (/module\.exports\s*=\s*([a-zA-Z0-9_$]+)\s*;?/.test(modified)) {
      modified = modified.replace(/module\.exports\s*=\s*([a-zA-Z0-9_$]+)\s*;?/, 'module.exports = withUnpeek($1);');
    } else if (/module\.exports\s*=\s*/.test(modified)) {
      modified = modified.replace(/module\.exports\s*=\s*([\s\S]+?);?\s*$/, 'module.exports = withUnpeek($1);');
    }
  } else {
    const importStmt = `import { withUnpeek } from 'unpeek/next';\n`;
    modified = `${importStmt}${modified}`;

    if (/export\s+default\s+([a-zA-Z0-9_$]+)\s*;?/.test(modified)) {
      modified = modified.replace(/export\s+default\s+([a-zA-Z0-9_$]+)\s*;?/, 'export default withUnpeek($1);');
    } else if (/export\s+default\s+/.test(modified)) {
      modified = modified.replace(/export\s+default\s+([\s\S]+?);?\s*$/, 'export default withUnpeek($1);');
    }
  }

  if (!dryRun && modified !== content) {
    fs.writeFileSync(filePath, modified, 'utf8');
  }

  return { updated: modified !== content, filename: targetFile };
}

export function initProject(cwd?: string, options?: InitOptions): InitResult;
/**
 * @deprecated Pass an options object `{ dryRun: boolean }` instead of a boolean.
 */
export function initProject(cwd: string, dryRun: boolean): InitResult;
export function initProject(
  cwd: string = process.cwd(),
  options: InitOptions | boolean = {},
): InitResult {
  const dryRun = typeof options === 'boolean' ? options : (options.dryRun ?? false);
  const rootDir = path.resolve(cwd);
  const { framework } = detectTargetFramework(rootDir);
  const pkgPath = path.join(rootDir, 'package.json');
  let updatedPackageJson = false;
  let updatedGitignore = false;
  let updatedNextConfig = false;
  let isNext16 = false;

  let nextVersion: string | undefined;
  let pkg: Record<string, unknown> = {};
  let rawPkgContent = '';

  if (fs.existsSync(pkgPath)) {
    rawPkgContent = fs.readFileSync(pkgPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPkgContent);
    } catch (err: unknown) {
      throw new UnpeekError(
        'ERR_INIT_INVALID_PACKAGE_JSON',
        `Invalid JSON in package.json at "${pkgPath}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    if (!isPlainObject(parsed)) {
      throw new UnpeekError(
        'ERR_INIT_INVALID_PACKAGE_JSON',
        `package.json at "${pkgPath}" must contain a JSON object.`,
      );
    }
    pkg = parsed;
    const deps = isPlainObject(pkg.dependencies) ? pkg.dependencies : undefined;
    const devDeps = isPlainObject(pkg.devDependencies) ? pkg.devDependencies : undefined;
    const rawNext = deps?.next ?? devDeps?.next;
    nextVersion = typeof rawNext === 'string' ? rawNext : undefined;
  }

  if (framework === 'nextjs' && isNext16OrAbove(nextVersion)) {
    isNext16 = true;
    const configRes = wireNextConfig(rootDir, dryRun);
    updatedNextConfig = configRes.updated;
  } else if (fs.existsSync(pkgPath)) {
    // For non-Next 16.2+ frameworks and legacy Next.js, configure postbuild script
    const indent = detectIndentation(rawPkgContent);
    const trailingNewline = rawPkgContent.endsWith('\r\n')
      ? '\r\n'
      : rawPkgContent.endsWith('\n')
        ? '\n'
        : '';

    const scripts: Record<string, unknown> = isPlainObject(pkg.scripts)
      ? { ...pkg.scripts }
      : {};
    pkg.scripts = scripts;

    const existingPostbuild =
      typeof scripts.postbuild === 'string' ? scripts.postbuild : undefined;
    if (!existingPostbuild) {
      scripts.postbuild = 'unpeek protect';
      updatedPackageJson = true;
    } else if (!existingPostbuild.includes('unpeek protect')) {
      scripts.postbuild = `${existingPostbuild.trim()} && unpeek protect`;
      updatedPackageJson = true;
    }

    if (updatedPackageJson && !dryRun) {
      fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, indent)}${trailingNewline}`, 'utf8');
    }
  }

  const gitignorePath = path.join(rootDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const current = fs.readFileSync(gitignorePath, 'utf8');
    const lines = current.split(/\r?\n/).map((line) => line.trim());
    if (!lines.includes('.unpeek-maps/') && !lines.includes('.unpeek-maps')) {
      const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
      if (!dryRun) {
        fs.writeFileSync(gitignorePath, `${current}${prefix}.unpeek-maps/\n`, 'utf8');
      }
      updatedGitignore = true;
    }
  } else {
    if (!dryRun) {
      fs.writeFileSync(gitignorePath, '.unpeek-maps/\n', 'utf8');
    }
    updatedGitignore = true;
  }

  let message: string;
  if (isNext16) {
    if (dryRun) {
      message = `[dry-run] Detected Next.js 16.2+ (${nextVersion}). Would configure withUnpeek adapter in next.config and .unpeek-maps/ vault.`;
    } else if (updatedNextConfig || updatedGitignore) {
      message = `Detected Next.js 16.2+ (${nextVersion}). Initialized unpeek: configured withUnpeek adapter in next.config and .unpeek-maps/ vault.`;
    } else {
      message = `Detected Next.js 16.2+ (${nextVersion}). unpeek is already initialized in this project.`;
    }
  } else {
    if (dryRun) {
      message = `[dry-run] Detected framework: ${framework}. Would configure postbuild hook and .unpeek-maps/ vault.`;
    } else if (updatedPackageJson || updatedGitignore) {
      message = `Detected framework: ${framework}. Initialized unpeek: configured postbuild hook and .unpeek-maps/ vault.`;
    } else {
      message = `Detected framework: ${framework}. unpeek is already initialized in this project.`;
    }
  }

  return {
    updatedPackageJson,
    updatedGitignore,
    updatedNextConfig,
    framework,
    isNext162Plus: isNext16,
    message,
  };
}
