import fs from 'node:fs';
import path from 'node:path';

export function initProject(cwd: string = process.cwd()): {
  updatedPackageJson: boolean;
  updatedGitignore: boolean;
  message: string;
} {
  const rootDir = path.resolve(cwd);
  const pkgPath = path.join(rootDir, 'package.json');
  let updatedPackageJson = false;
  let updatedGitignore = false;

  if (fs.existsSync(pkgPath)) {
    const raw = fs.readFileSync(pkgPath, 'utf8');
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

    if (updatedPackageJson) {
      fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    }
  }

  const gitignorePath = path.join(rootDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const current = fs.readFileSync(gitignorePath, 'utf8');
    const lines = current.split(/\r?\n/).map((line) => line.trim());
    if (!lines.includes('.unpeek-maps/') && !lines.includes('.unpeek-maps')) {
      const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
      fs.writeFileSync(gitignorePath, `${current}${prefix}.unpeek-maps/\n`, 'utf8');
      updatedGitignore = true;
    }
  } else {
    fs.writeFileSync(gitignorePath, '.unpeek-maps/\n', 'utf8');
    updatedGitignore = true;
  }

  const message =
    updatedPackageJson || updatedGitignore
      ? 'Initialized unpeek: configured postbuild hook and .unpeek-maps/ vault.'
      : 'unpeek is already initialized in this project.';

  return {
    updatedPackageJson,
    updatedGitignore,
    message,
  };
}
