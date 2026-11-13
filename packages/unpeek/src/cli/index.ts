import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeterrentMode, ProtectOptions, ProtectSummary } from '../types.js';
import { initProject } from '../core/init.js';
import { protectProject } from '../core/protect.js';

const VERSION = '2.0.0';
let cachedPackageVersion: string | undefined;

export function getPackageVersion(): string {
  if (cachedPackageVersion !== undefined) {
    return cachedPackageVersion;
  }
  try {
    const pkgUrl = new URL('../../package.json', import.meta.url);
    const content = fs.readFileSync(pkgUrl, 'utf8');
    const parsed = JSON.parse(content) as { version?: string };
    cachedPackageVersion = parsed.version ?? VERSION;
  } catch {
    cachedPackageVersion = VERSION;
  }
  return cachedPackageVersion;
}

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
    `${MARK_TOP}  ${paint('1', `unpeek ${getPackageVersion()}`)}`,
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
    '    unpeek protect [options]       protect client bundles in place (Tier 1 default: <2% CPU, <15% Gzip)',
    '',
    '  Options:',
    '    --out-dir <dir>                explicit client output directory',
    '    --seed <number>                deterministic polymorphic seed',
    '    --passive                      passive deterrent mode (default: marks tamper, keeps console)',
    '    --gradual                      gradual deterrent mode (silences console on tamper)',
    '    --detect-headless              treat navigator.webdriver / HeadlessChrome as tamper',
    '    --no-maps                      delete .map files instead of vaulting them',
    '    --min-string-length <num>      minimum string length for the vault (default: 4)',
    '    --private-maps-dir <dir>       vault directory (default: .unpeek-maps)',
    '    --no-shield                    skip the runtime anti-tamper shield',
    '    --aggressive                   enable Tier 2 aggressive protection (Micro-VM & WASM KDF)',
    '    -h, --help                     show help',
    '    -v, --version                  show version',
    '',
    '  Tiers:',
    '    Tier 1 (default)               call-graph hot-path exemption (<2% CPU, <15% Gzip)',
    '    Tier 2 (--aggressive)          zero plaintext exposure via Micro-VM & WASM KDF',
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

  const tierLabel = summary.aggressive
    ? 'Tier 2 (--aggressive: Micro-VM & WASM KDF)'
    : 'Tier 1 (default: <2% CPU, <15% Gzip)';

  console.log('');
  console.log(brandBlock());
  console.log('');
  console.log(
    sectionBlock('PROJECT', [
      ['framework', summary.framework],
      ['tier', tierLabel],
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

  if (summary.dockerIgnoreMissing) {
    console.log('');
    console.log(
      "[unpeek:advisory] .dockerignore is missing .unpeek-maps/. Private maps may leak into Docker image during 'COPY . .'."
    );
  }
}

function printInitResult(
  result: {
    framework?: string;
    updatedPackageJson: boolean;
    updatedGitignore: boolean;
    updatedNextConfig?: boolean;
    isNext162Plus?: boolean;
    message: string;
  },
  dryRun: boolean
): void {
  const postbuild = result.isNext162Plus
    ? 'n/a (Build Adapter)'
    : result.updatedPackageJson
      ? dryRun
        ? 'would be added'
        : 'unpeek protect (added)'
      : 'already configured';
  const adapterStatus = result.isNext162Plus
    ? result.updatedNextConfig
      ? dryRun
        ? 'withUnpeek (would be configured)'
        : 'withUnpeek (configured)'
      : 'withUnpeek (already configured)'
    : undefined;
  const vault = result.updatedGitignore
    ? dryRun
      ? 'would be ignored'
      : '.unpeek-maps/ (added)'
    : 'already ignored';

  const rows: Array<[string, string]> = [
    ['framework', result.framework ?? 'unknown'],
  ];
  if (adapterStatus) {
    rows.push(['next.config', adapterStatus]);
  }
  rows.push(['postbuild', postbuild]);
  rows.push(['vault', vault]);

  console.log('');
  console.log(brandBlock());
  console.log('');
  console.log(sectionBlock('PROJECT', rows));
  console.log('');
  if (dryRun) {
    console.log(`  ${dim(result.message)}`);
  } else if (result.updatedPackageJson || result.updatedGitignore || result.updatedNextConfig) {
    console.log(`  ${dim('unpeek wired. maps stay private from the first build.')}`);
  } else {
    console.log(`  ${dim(result.message)}`);
  }
  if (!dryRun) {
    console.log(`  ${dim('run your build to protect the first bundle.')}`);
  }
}

export type ParsedCliCommand =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'init'; dryRun: boolean }
  | { kind: 'protect'; options: ProtectOptions }
  | { kind: 'error'; message: string };

function readFlagValue(
  args: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } | { error: string } {
  const arg = args[index];
  if (arg.startsWith(`${flag}=`)) {
    const value = arg.slice(flag.length + 1);
    if (!value) {
      return { error: `Missing value for ${flag}` };
    }
    return { value, nextIndex: index };
  }
  const next = args[index + 1];
  if (!next || next.startsWith('-')) {
    return { error: `Missing value for ${flag}` };
  }
  return { value: next, nextIndex: index + 1 };
}

function parseNumericFlag(
  raw: string,
  flag: string,
  requireNonNegativeInt = false,
): { value: number } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: `Invalid numeric value for ${flag}: "${raw}"` };
  }
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return { error: `Invalid numeric value for ${flag}: "${raw}"` };
  }
  if (requireNonNegativeInt && (!Number.isInteger(parsed) || parsed < 0)) {
    return { error: `Invalid non-negative integer for ${flag}: "${raw}"` };
  }
  return { value: parsed };
}

export function parseCliArgs(args: string[], cwd: string = process.cwd()): ParsedCliCommand {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return { kind: 'help' };
  }

  if (args.includes('--version') || args.includes('-v')) {
    return { kind: 'version' };
  }

  const first = args[0];
  const hasSubcommand = !first.startsWith('-');

  if (hasSubcommand && first !== 'init' && first !== 'protect') {
    return {
      kind: 'error',
      message: `Unknown command "${first}". Run "unpeek --help" for usage.`,
    };
  }

  if (first === 'init') {
    let dryRun = false;
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--dry-run') {
        dryRun = true;
      } else {
        return {
          kind: 'error',
          message: `Unknown option "${arg}" for init. Run "unpeek --help" for usage.`,
        };
      }
    }
    return { kind: 'init', dryRun };
  }

  const options: ProtectOptions = { cwd };
  const startIndex = first === 'protect' ? 1 : 0;

  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--out-dir' || arg.startsWith('--out-dir=')) {
      const res = readFlagValue(args, i, '--out-dir');
      if ('error' in res) return { kind: 'error', message: res.error };
      options.outDir = res.value;
      i = res.nextIndex;
    } else if (arg === '--private-maps-dir' || arg.startsWith('--private-maps-dir=')) {
      const res = readFlagValue(args, i, '--private-maps-dir');
      if ('error' in res) return { kind: 'error', message: res.error };
      options.privateMapsDir = res.value;
      i = res.nextIndex;
    } else if (arg === '--seed' || arg.startsWith('--seed=')) {
      const res = readFlagValue(args, i, '--seed');
      if ('error' in res) return { kind: 'error', message: res.error };
      const num = parseNumericFlag(res.value, '--seed');
      if ('error' in num) return { kind: 'error', message: num.error };
      options.seed = num.value;
      i = res.nextIndex;
    } else if (arg === '--min-string-length' || arg.startsWith('--min-string-length=')) {
      const res = readFlagValue(args, i, '--min-string-length');
      if ('error' in res) return { kind: 'error', message: res.error };
      const num = parseNumericFlag(res.value, '--min-string-length', true);
      if ('error' in num) return { kind: 'error', message: num.error };
      options.minStringLength = num.value;
      i = res.nextIndex;
    } else if (arg === '--aggressive') {
      options.aggressive = true;
    } else if (arg === '--no-shield') {
      options.injectRuntimeShield = false;
    } else if (arg === '--passive') {
      options.deterrentMode = 'passive' as DeterrentMode;
    } else if (arg === '--gradual') {
      options.deterrentMode = 'gradual' as DeterrentMode;
    } else if (arg === '--detect-headless') {
      options.detectHeadless = true;
    } else if (arg === '--no-maps') {
      options.keepPrivateMaps = false;
    } else {
      return {
        kind: 'error',
        message: `Unknown option "${arg}". Run "unpeek --help" for usage.`,
      };
    }
  }

  return { kind: 'protect', options };
}

export async function runCli(args: string[]): Promise<void> {
  const parsed = parseCliArgs(args, process.cwd());

  switch (parsed.kind) {
    case 'help':
      printHelp();
      return;
    case 'version':
      console.log(getPackageVersion());
      return;
    case 'error':
      console.error(`[unpeek] ${parsed.message}`);
      process.exitCode = 1;
      return;
    case 'init': {
      const res = initProject(process.cwd(), { dryRun: parsed.dryRun });
      printInitResult(res, parsed.dryRun);
      return;
    }
    case 'protect': {
      const summary = await protectProject(parsed.options);
      printSummaryTable(summary);
      return;
    }
  }
}

function isDirectCliExecution(argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    const executedPath = fs.realpathSync(path.resolve(argv1));
    const currentPath = fs.realpathSync(fileURLToPath(import.meta.url));
    if (process.platform === 'win32') {
      return executedPath.toLowerCase() === currentPath.toLowerCase();
    }
    return executedPath === currentPath;
  } catch {
    return false;
  }
}

if (isDirectCliExecution(process.argv[1])) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error('[unpeek] fatal error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

