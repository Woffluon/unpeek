import type { DeterrentMode, ProtectOptions, ProtectSummary } from '../types.js';
import { initProject } from './init.js';
import { protectProject } from './protect.js';

const VERSION = '1.0.1';

function printHelp(): void {
  const helpText = `
unpeek v${VERSION} — Call-graph-aware polymorphic AST obfuscation & runtime shield

Usage:
  unpeek init                       Configure postbuild hook & .unpeek-maps/ vault
  unpeek protect [options]          Protect client bundles in-place

Options:
  --out-dir <dir>                   Explicit client output directory
  --seed <number>                   Deterministic polymorphic seed
  --passive                         Use passive deterrent mode instead of gradual
  --no-maps                         Delete .map files instead of vaulting to .unpeek-maps/
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
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION);
    return;
  }

  const command = args[0] && !args[0].startsWith('-') ? args[0] : 'protect';

  if (command === 'init') {
    const res = initProject(process.cwd());
    console.log(`[unpeek] ${res.message}`);
    return;
  }

  if (command === 'protect') {
    const options: ProtectOptions = {
      cwd: process.cwd(),
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--out-dir' && args[i + 1]) {
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
