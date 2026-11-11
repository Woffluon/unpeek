import fs from 'node:fs';
import type { DeterrentMode, ProtectOptions, ProtectSummary } from '../types.js';
import { initProject } from './init.js';
import { protectProject } from './protect.js';

const VERSION = '1.10.0';

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

const MARK_TOP = '  \u259B\u2580\u2580\u259C';
const MARK_BOTTOM = '  \u2599\u2584\u2584\u259F';
const RULE = '\u2500';
const LABEL_WIDTH = 19;

function colorEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === 'dumb') return false;
  return Boolean(process.stdout.isTTY);
}

function paint(code: string, text: string): string {
  return colorEnabled() ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function dim(text: string): string {
  return paint('2', text);
}

function brandBlock(): string {
  return [
    `${MARK_TOP}  ${paint('1', `unpeek ${RUNTIME_VERSION}`)}`,
    `${MARK_BOTTOM}  ${dim('client bundle protection')}`,
  ].join('\n');
}

function sectionBlock(title: string, rows: Array<[string, string]>): string {
  const fill = Math.max(2, 46 - title.length);
  const header = `  ${dim(title)} ${dim(RULE.repeat(fill))}`;
  const body = rows.map(([label, value]) => `  ${dim(label.padEnd(LABEL_WIDTH))}  ${value}`);
  return [header, ...body].join('\n');
}

function printHelp(): void {
  const helpText = [
    brandBlock(),
    '',
    '  Usage:',
    '    unpeek init [--dry-run]        wire postbuild and the .unpeek-maps/ vault',
    '    unpeek protect [options]       protect client bundles in place',
    '',
    '  Options:',
    '    --out-dir <dir>                explicit client output directory',
    '    --seed <number>                deterministic polymorphic seed',
    '    --passive                      passive deterrent mode instead of gradual',
    '    --no-maps                      delete .map files instead of vaulting them',
    '    --min-string-length <num>      minimum string length for the vault (default: 4)',
    '    --private-maps-dir <dir>       vault directory (default: .unpeek-maps)',
    '    --no-shield                    skip the runtime anti-tamper shield',
    '    --aggressive                   enable Layer 2 aggressive protection (Micro-VM & WASM KDF)',
    '    -h, --help                     show help',
    '    -v, --version                  show version',
  ].join('\n');
  console.log(helpText);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function printSummaryTable(summary: ProtectSummary): void {
  const sign = summary.gzipDeltaPercent > 0 ? '+' : '';
  const gzip = `${formatBytes(summary.originalGzipBytes)} -> ${formatBytes(summary.protectedGzipBytes)}  ${sign}${summary.gzipDeltaPercent}%`;

  console.log('');
  console.log(brandBlock());
  console.log('');
  console.log(
    sectionBlock('PROJECT', [
      ['framework', summary.framework],
      ['output', summary.outDir],
      ['bundles', String(summary.processedFiles)],
    ])
  );
  console.log('');
  console.log(
    sectionBlock('CALL GRAPH', [
      ['hot path exempt', `${summary.totalHotFunctionsSkipped}  ${dim('0% tax')}`],
      ['cold path protected', String(summary.totalColdFunctionsProtected)],
    ])
  );
  console.log('');
  console.log(
    sectionBlock('TRANSFORM', [
      ['string vault', `${summary.totalEncryptedStrings} literals  ${dim('O(1) memo')}`],
      ['symbol mangling', `${summary.totalMangledSymbols} bindings`],
    ])
  );
  console.log('');
  console.log(
    sectionBlock('OUTPUT', [
      ['source maps', `${summary.movedSourceMaps} moved -> .unpeek-maps/`],
      ['gzip', gzip],
      ['elapsed', `${summary.elapsedMs} ms`],
    ])
  );
  console.log('');
  console.log(`  ${dim('done. maps are private. hot path untouched.')}`);
}

function printInitResult(
  result: {
    framework?: string;
    updatedPackageJson: boolean;
    updatedGitignore: boolean;
    message: string;
  },
  dryRun: boolean
): void {
  const postbuild = result.updatedPackageJson
    ? dryRun
      ? 'would be added'
      : 'unpeek protect (added)'
    : 'already configured';
  const vault = result.updatedGitignore
    ? dryRun
      ? 'would be ignored'
      : '.unpeek-maps/ (added)'
    : 'already ignored';

  console.log('');
  console.log(brandBlock());
  console.log('');
  console.log(
    sectionBlock('PROJECT', [
      ['framework', result.framework ?? 'unknown'],
      ['postbuild', postbuild],
      ['vault', vault],
    ])
  );
  console.log('');
  if (dryRun) {
    console.log(`  ${dim(result.message)}`);
  } else if (result.updatedPackageJson || result.updatedGitignore) {
    console.log(`  ${dim('postbuild wired. maps stay private from the first build.')}`);
  } else {
    console.log(`  ${dim(result.message)}`);
  }
  if (!dryRun) {
    console.log(`  ${dim('run your build to protect the first bundle.')}`);
  }
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
    printInitResult(res, dryRun);
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
      } else if (arg === '--aggressive') {
        options.aggressive = true;
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
