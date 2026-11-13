import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeterrentMode } from '../runtime/types.js';
import type { UnpeekProfile } from '../config.js';
import type {
  CheckOptions,
  CheckResult,
  ProtectOptions,
  ProtectSummary,
  SymbolicateOptions,
} from '../core/types.js';
import { initProject } from '../core/init.js';
import { protectProject } from '../core/protect.js';
import { checkProject } from '../core/check.js';
import { symbolicateStackTrace } from '../core/vlq.js';

const VERSION = '3.0.0';
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
    '    unpeek init [--dry-run] [--profile <name>]   wire postbuild and the .unpeek-maps/ vault',
    '    unpeek protect [options]                     protect client bundles in place (Tier 1 default: <2% CPU, <15% Gzip)',
    '    unpeek check [options]                       read-only CI gate for leaks, ignores, budget, and CSP',
    '    unpeek symbolicate [options]                 resolve stack traces locally using .unpeek-maps/',
    '',
    '  Options (protect):',
    '    --profile <name>               preset profile: minimal | recommended | strict',
    '    --dry-run                      compute transform & Gzip delta in memory without writing files',
    '    --max-gzip-delta <num>         fail if Gzip delta exceeds percentage',
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
    '',
    '  Options (check):',
    '    --out-dir <dir>                explicit client output directory',
    '    --max-gzip-delta <num>         maximum allowed Gzip delta percentage (default: 15)',
    '    --require-zero-eval            fail on eval() or new Function() in client bundles',
    '    --private-maps-dir <dir>       vault directory (default: .unpeek-maps)',
    '    --json                         output machine-readable JSON',
    '',
    '  Options (symbolicate):',
    '    --maps-dir <dir>               source maps directory (default: .unpeek-maps)',
    '    --trace <str>                  inline stack trace string to resolve',
    '    --file <path>                  path to stack trace log file',
    '',
    '  General:',
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
  if (summary.dryRun) {
    console.log('');
    console.log('  [DRY-RUN] Preview only — no files were modified on disk.');
  }
  console.log('');
  const projectRows: Array<[string, string]> = [
    ['framework', summary.framework],
    ['tier', tierLabel],
  ];
  if (summary.profile) {
    projectRows.push(['profile', summary.profile]);
  }
  if (summary.seed !== undefined) {
    projectRows.push(['seed', String(summary.seed)]);
  }
  projectRows.push(['output', summary.outDir], ['bundles', String(summary.processedFiles)]);
  console.log(sectionBlock('PROJECT', projectRows));
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
  | { kind: 'init'; dryRun: boolean; profile?: UnpeekProfile }
  | { kind: 'protect'; options: ProtectOptions }
  | { kind: 'check'; options: CheckOptions; json: boolean }
  | { kind: 'symbolicate'; options: SymbolicateOptions; file?: string }
  | { kind: 'error'; message: string };

const VALID_PROFILES = new Set<UnpeekProfile>(['minimal', 'recommended', 'strict']);

function parseProfileFlag(
  raw: string,
  flag: string,
): { value: UnpeekProfile } | { error: string } {
  if (!VALID_PROFILES.has(raw as UnpeekProfile)) {
    return {
      error: `Invalid value for ${flag}: "${raw}". Expected minimal, recommended, or strict.`,
    };
  }
  return { value: raw as UnpeekProfile };
}

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

  if (hasSubcommand && first !== 'init' && first !== 'protect' && first !== 'check' && first !== 'symbolicate') {
    return {
      kind: 'error',
      message: `Unknown command "${first}". Run "unpeek --help" for usage.`,
    };
  }

  if (first === 'init') {
    let dryRun = false;
    let profile: UnpeekProfile | undefined;
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--dry-run') {
        dryRun = true;
      } else if (arg === '--profile' || arg.startsWith('--profile=')) {
        const res = readFlagValue(args, i, '--profile');
        if ('error' in res) return { kind: 'error', message: res.error };
        const prof = parseProfileFlag(res.value, '--profile');
        if ('error' in prof) return { kind: 'error', message: prof.error };
        profile = prof.value;
        i = res.nextIndex;
      } else {
        return {
          kind: 'error',
          message: `Unknown option "${arg}" for init. Run "unpeek --help" for usage.`,
        };
      }
    }
    return profile ? { kind: 'init', dryRun, profile } : { kind: 'init', dryRun };
  }

  if (first === 'check') {
    const options: CheckOptions = { cwd };
    let json = false;
    for (let i = 1; i < args.length; i++) {
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
      } else if (arg === '--max-gzip-delta' || arg.startsWith('--max-gzip-delta=')) {
        const res = readFlagValue(args, i, '--max-gzip-delta');
        if ('error' in res) return { kind: 'error', message: res.error };
        const num = parseNumericFlag(res.value, '--max-gzip-delta');
        if ('error' in num) return { kind: 'error', message: num.error };
        if (num.value < 0) {
          return { kind: 'error', message: `Invalid non-negative value for --max-gzip-delta: "${res.value}"` };
        }
        options.maxGzipDelta = num.value;
        i = res.nextIndex;
      } else if (arg === '--require-zero-eval') {
        options.requireZeroEval = true;
      } else if (arg === '--strict-csp') {
        options.strictCsp = true;
      } else if (arg === '--json') {
        json = true;
      } else {
        return {
          kind: 'error',
          message: `Unknown option "${arg}" for check. Run "unpeek --help" for usage.`,
        };
      }
    }
    return { kind: 'check', options, json };
  }

  if (first === 'symbolicate') {
    const options: SymbolicateOptions = { stackTrace: '', cwd };
    let file: string | undefined;
    let hasTrace = false;
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--maps-dir' || arg.startsWith('--maps-dir=')) {
        const res = readFlagValue(args, i, '--maps-dir');
        if ('error' in res) return { kind: 'error', message: res.error };
        options.mapsDir = res.value;
        i = res.nextIndex;
      } else if (arg === '--trace' || arg.startsWith('--trace=')) {
        const res = readFlagValue(args, i, '--trace');
        if ('error' in res) return { kind: 'error', message: res.error };
        options.stackTrace = res.value;
        hasTrace = true;
        i = res.nextIndex;
      } else if (arg === '--file' || arg.startsWith('--file=')) {
        const res = readFlagValue(args, i, '--file');
        if ('error' in res) return { kind: 'error', message: res.error };
        file = res.value;
        i = res.nextIndex;
      } else {
        return {
          kind: 'error',
          message: `Unknown option "${arg}" for symbolicate. Run "unpeek --help" for usage.`,
        };
      }
    }
    if (!hasTrace && !file) {
      return {
        kind: 'error',
        message: 'symbolicate requires either --trace <str> or --file <path>.',
      };
    }
    return { kind: 'symbolicate', options, file };
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
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--profile' || arg.startsWith('--profile=')) {
      const res = readFlagValue(args, i, '--profile');
      if ('error' in res) return { kind: 'error', message: res.error };
      const prof = parseProfileFlag(res.value, '--profile');
      if ('error' in prof) return { kind: 'error', message: prof.error };
      options.profile = prof.value;
      i = res.nextIndex;
    } else if (arg === '--max-gzip-delta' || arg.startsWith('--max-gzip-delta=')) {
      const res = readFlagValue(args, i, '--max-gzip-delta');
      if ('error' in res) return { kind: 'error', message: res.error };
      const num = parseNumericFlag(res.value, '--max-gzip-delta');
      if ('error' in num) return { kind: 'error', message: num.error };
      if (num.value < 0) {
        return {
          kind: 'error',
          message: `Invalid non-negative value for --max-gzip-delta: "${res.value}"`,
        };
      }
      options.maxGzipDelta = num.value;
      i = res.nextIndex;
    } else {
      return {
        kind: 'error',
        message: `Unknown option "${arg}". Run "unpeek --help" for usage.`,
      };
    }
  }

  return { kind: 'protect', options };
}

function printCheckResult(result: CheckResult): void {
  console.log('');
  console.log(brandBlock());
  console.log('');
  console.log(
    sectionBlock('CHECK', [
      ['status', result.passed ? 'PASSED' : 'FAILED'],
      ['output', result.outDir],
      ['files', String(result.checkedFiles)],
      ['violations', String(result.violations.length)],
      ['warnings', String(result.warnings.length)],
    ])
  );
  if (result.violations.length > 0) {
    console.log('');
    for (const v of result.violations) {
      console.error(`  [ERROR] (${v.rule}) ${v.message}`);
    }
  }
  if (result.warnings.length > 0) {
    console.log('');
    for (const w of result.warnings) {
      console.warn(`  [WARN]  (${w.rule}) ${w.message}`);
    }
  }
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
      const cwd = process.cwd();
      const res = initProject(cwd, { dryRun: parsed.dryRun });
      if (parsed.profile && !parsed.dryRun) {
        const configPath = path.join(cwd, 'unpeek.config.json');
        let existing: Record<string, unknown> = {};
        if (fs.existsSync(configPath)) {
          try {
            existing = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
          } catch {
            existing = {};
          }
        }
        existing.profile = parsed.profile;
        fs.writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
      }
      printInitResult(res, parsed.dryRun);
      return;
    }
    case 'protect': {
      const summary = await protectProject(parsed.options);
      printSummaryTable(summary);
      if (summary.dryRun && summary.budgetExceeded) {
        console.error(
          `[unpeek] Budget exceeded: gzipDeltaPercent (${summary.gzipDeltaPercent}%) > maxGzipDelta (${parsed.options.maxGzipDelta}%).`
        );
        process.exitCode = 1;
      }
      return;
    }
    case 'check': {
      const result = await checkProject(parsed.options);
      if (parsed.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printCheckResult(result);
      }
      if (!result.passed) {
        process.exitCode = 1;
      }
      return;
    }
    case 'symbolicate': {
      let stackTrace = parsed.options.stackTrace;
      if (parsed.file) {
        const filePath = path.resolve(parsed.options.cwd ?? process.cwd(), parsed.file);
        if (!fs.existsSync(filePath)) {
          console.error(`[unpeek] Trace file not found: "${filePath}"`);
          process.exitCode = 1;
          return;
        }
        stackTrace = fs.readFileSync(filePath, 'utf8');
      }
      const result = await symbolicateStackTrace({
        ...parsed.options,
        stackTrace,
      });
      console.log(result.stackTrace);
      for (const w of result.warnings) {
        console.error(`[unpeek:warn] ${w}`);
      }
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

