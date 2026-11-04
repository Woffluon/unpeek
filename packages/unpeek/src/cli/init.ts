import fs from 'node:fs';
import path from 'node:path';
import { detectTargetFramework } from '../bundler/detector.js';

export interface InitOptions {
  dryRun?: boolean;
}

export interface InitResult {
  updatedPackageJson: boolean;
  updatedGitignore: boolean;
  framework?: string;
  message: string;
}

function detectIndentation(rawJson: string): string | number {
  const match = rawJson.match(/^[ \t]+(?=["{\[])/m);
  if (!match) return 2;
  const indent = match[0];
  if (indent.includes('\t')) return '\t';
  return indent.length;
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

  if (fs.existsSync(pkgPath)) {
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const indent = detectIndentation(raw);
    const trailingNewline = raw.endsWith('\r\n') ? '\r\n' : raw.endsWith('\n') ? '\n' : '';
    const pkg = JSON.parse(raw) as {
      scripts?: Record<string, string>;
      [key: string]: unknown;
    };

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
  if (dryRun) {
    message = `[dry-run] Detected framework: ${framework}. Would configure postbuild hook and .unpeek-maps/ vault.`;
  } else if (updatedPackageJson || updatedGitignore) {
    message = `Detected framework: ${framework}. Initialized unpeek: configured postbuild hook and .unpeek-maps/ vault.`;
  } else {
    message = `Detected framework: ${framework}. unpeek is already initialized in this project.`;
  }

  return {
    updatedPackageJson,
    updatedGitignore,
    framework,
    message,
  };
}
