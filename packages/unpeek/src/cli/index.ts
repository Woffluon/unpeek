import fs from 'node:fs';
import type { DeterrentMode, ProtectOptions, ProtectSummary } from '../types.js';
import { initProject } from './init.js';
import { protectProject } from './protect.js';

const VERSION = '1.2.0';

function getPackageVersion(): string {
  try {
    const pkgUrl = new URL('../../package.json', import.meta.url);
    const content = fs.readFileSync(pkgUrl, 'utf8');
    const parsed = JSON.parse(content) as { version?: string };
    return parsed.version ?? VERSION;
  } catch {
    return VERSION;
  }
}

const RUNTIME_VERSION = getPackageVersion();

function printHelp(): void {
  const helpText = `
unpeek v${VERSION} — Call-graph-aware polymorphic AST obfuscation & runtime shield

Usage:
  unpeek init [--dry-run]           Configure postbuild hook & .unpeek-maps/ vault
  unpeek protect [options]          Protect client bundles in-place

Options:
  --out-dir <dir>                   Explicit client output directory
  --seed <number>                   Deterministic polymorphic seed
  --passive                         Use passive deterrent mode instead of gradual
  --no-maps                         Delete .map files instead of vaulting to .unpeek-maps/
  --min-string-length <num>         Minimum string length for encryption vault (default: 4)
  --private-maps-dir <dir>          Directory to store vaulted source maps (default: .unpeek-maps)
  --no-shield                       Do not inject runtime anti-tamper deterrent shield
  -h, --help                        Show help message
  -v, --version                     Show version number
`.trim();
  console.log(helpText);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function printSummaryTable(summary: ProtectSummary): void {
  const sign = summary.gzipDeltaPercent > 0 ? '+' : '';
  const rows: Array<[string, string]> = [
    ['Framework', summary.framework],
    ['Client OutDir', summary.outDir],
    ['Processed Bundles', String(summary.processedFiles)],
    ['Vaulted Source Maps', String(summary.movedSourceMaps)],
    ['Cold Functions Protected', String(summary.totalColdFunctionsProtected)],
    ['Hot Functions Skipped (0% Tax)', String(summary.totalHotFunctionsSkipped)],
    ['Encrypted Strings', String(summary.totalEncryptedStrings)],
    ['Mangled Symbols', String(summary.totalMangledSymbols)],
    [
      'Gzip Bundle Size',
      `${formatBytes(summary.originalGzipBytes)} -> ${formatBytes(summary.protectedGzipBytes)} (${sign}${summary.gzipDeltaPercent}%)`,
    ],
    ['Elapsed Time', `${summary.elapsedMs} ms`],
  ];

  const col1Width = Math.max(...rows.map(([k]) => k.length), 16);
  const col2Width = Math.max(...rows.map(([, v]) => v.length), 20);
  const divider = `+-${'-'.repeat(col1Width)}-+-${'-'.repeat(col2Width)}-+`;

  console.log('\n[unpeek] Protection Complete');
  console.log(divider);
  for (const [label, value] of rows) {
    console.log(`| ${label.padEnd(col1Width)} | ${value.padEnd(col2Width)} |`);
  }
  console.log(divider);
}

export async function runCli(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION);
    return;
  }

  const command = args[0] && !args[0].startsWith('-') ? args[0] : '';

  if (command === 'init') {
    const dryRun = args.includes('--dry-run');
    const res = initProject(process.cwd(), { dryRun });
    console.log(`[unpeek] ${res.message}`);
    return;
  }

  if (command === 'protect' || (args.length > 0 && args[0].startsWith('-'))) {
    const options: ProtectOptions = {
      cwd: process.cwd(),
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === 'protect') {
        continue;
      } else if (arg === '--out-dir' && args[i + 1]) {
        options.outDir = args[++i];
      } else if (arg.startsWith('--out-dir=')) {
        options.outDir = arg.slice('--out-dir='.length);
      } else if (arg === '--seed' && args[i + 1]) {
        const parsed = Number(args[++i]);
        if (!Number.isNaN(parsed)) {
          options.seed = parsed;
        }
      } else if (arg.startsWith('--seed=')) {
        const parsed = Number(arg.slice('--seed='.length));
        if (!Number.isNaN(parsed)) {
          options.seed = parsed;
        }
      } else if (arg === '--min-string-length' && args[i + 1]) {
        const parsed = Number(args[++i]);
        if (!Number.isNaN(parsed)) {
          options.minStringLength = parsed;
        }
      } else if (arg.startsWith('--min-string-length=')) {
        const parsed = Number(arg.slice('--min-string-length='.length));
        if (!Number.isNaN(parsed)) {
          options.minStringLength = parsed;
        }
      } else if (arg === '--private-maps-dir' && args[i + 1]) {
        options.privateMapsDir = args[++i];
      } else if (arg.startsWith('--private-maps-dir=')) {
        options.privateMapsDir = arg.slice('--private-maps-dir='.length);
      } else if (arg === '--no-shield') {
        options.injectRuntimeShield = false;
      } else if (arg === '--passive') {
        options.deterrentMode = 'passive' as DeterrentMode;
      } else if (arg === '--no-maps') {
        options.keepPrivateMaps = false;
      }
    }

    const summary = await protectProject(options);
    printSummaryTable(summary);
    return;
  }

  printHelp();
}
