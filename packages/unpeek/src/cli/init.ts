import fs from 'node:fs';
import path from 'node:path';
import { detectTargetFramework } from '../bundler/detector.js';

export interface InitOptions {
  dryRun?: boolean;
}

export interface InitResult {
  updatedPackageJson: boolean;
  updatedGitignore: boolean;
  updatedNextConfig?: boolean;
  framework?: string;
  isNext162Plus?: boolean;
  message: string;
}

function detectIndentation(rawJson: string): string | number {
  const match = rawJson.match(/^[ \t]+(?=["{\[])/m);
  if (!match) return 2;
  const indent = match[0];
  if (indent.includes('\t')) return '\t';
  return indent.length;
}

export function isNext16OrAbove(versionStr?: string): boolean {
  if (!versionStr) return false;
  const clean = versionStr.replace(/^[^\d]*/, '');
  const match = clean.match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  if (major > 16) return true;
  if (major === 16 && minor >= 2) return true;
  return false;
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

export function initProject(
  cwd: string = process.cwd(),
  options: InitOptions | boolean = {}
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
  let pkg: any = {};

  if (fs.existsSync(pkgPath)) {
    try {
      const raw = fs.readFileSync(pkgPath, 'utf8');
      pkg = JSON.parse(raw);
      nextVersion = pkg.dependencies?.next || pkg.devDependencies?.next;
    } catch {
      // ignore
    }
  }

  if (framework === 'nextjs' && isNext16OrAbove(nextVersion)) {
    isNext16 = true;
    const configRes = wireNextConfig(rootDir, dryRun);
    updatedNextConfig = configRes.updated;
  } else if (fs.existsSync(pkgPath)) {
    // For non-Next 16.2+ frameworks and legacy Next.js, configure postbuild script
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const indent = detectIndentation(raw);
    const trailingNewline = raw.endsWith('\r\n') ? '\r\n' : raw.endsWith('\n') ? '\n' : '';

    if (!pkg.scripts || typeof pkg.scripts !== 'object') {
      pkg.scripts = {};
    }

    const existingPostbuild = pkg.scripts.postbuild;
    if (!existingPostbuild) {
      pkg.scripts.postbuild = 'unpeek protect';
      updatedPackageJson = true;
    } else if (!existingPostbuild.includes('unpeek protect')) {
      pkg.scripts.postbuild = `${existingPostbuild.trim()} && unpeek protect`;
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
