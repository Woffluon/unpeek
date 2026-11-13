import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPackageVersion, parseCliArgs, runCli } from '../src/cli/index.js';

describe('CLI Argument Parsing and Execution', () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  describe('parseCliArgs', () => {
    it('returns help for empty args, --help, or -h', () => {
      expect(parseCliArgs([])).toEqual({ kind: 'help' });
      expect(parseCliArgs(['--help'])).toEqual({ kind: 'help' });
      expect(parseCliArgs(['-h'])).toEqual({ kind: 'help' });
    });

    it('returns version for --version or -v', () => {
      expect(parseCliArgs(['--version'])).toEqual({ kind: 'version' });
      expect(parseCliArgs(['-v'])).toEqual({ kind: 'version' });
    });

    it('parses init with optional --dry-run', () => {
      expect(parseCliArgs(['init'])).toEqual({ kind: 'init', dryRun: false });
      expect(parseCliArgs(['init', '--dry-run'])).toEqual({ kind: 'init', dryRun: true });
    });

    it('parses protect flags with both space and = syntax', () => {
      const res = parseCliArgs(
        [
          'protect',
          '--out-dir',
          'dist/client',
          '--seed=1234',
          '--min-string-length',
          '6',
          '--private-maps-dir=.maps',
          '--aggressive',
          '--no-shield',
          '--gradual',
          '--detect-headless',
          '--no-maps',
        ],
        '/repo',
      );
      expect(res).toEqual({
        kind: 'protect',
        options: {
          cwd: '/repo',
          outDir: 'dist/client',
          seed: 1234,
          minStringLength: 6,
          privateMapsDir: '.maps',
          aggressive: true,
          injectRuntimeShield: false,
          deterrentMode: 'gradual',
          detectHeadless: true,
          keepPrivateMaps: false,
        },
      });
    });

    it('returns error on unknown subcommands', () => {
      const res = parseCliArgs(['deploy']);
      expect(res.kind).toBe('error');
      if (res.kind === 'error') {
        expect(res.message).toContain('Unknown command "deploy"');
      }
    });

    it('returns error on unknown flags', () => {
      const res = parseCliArgs(['protect', '--bogus-flag']);
      expect(res.kind).toBe('error');
      if (res.kind === 'error') {
        expect(res.message).toContain('Unknown option "--bogus-flag"');
      }
    });

    it('returns error on unknown init flags', () => {
      const res = parseCliArgs(['init', '--seed', '123']);
      expect(res.kind).toBe('error');
      if (res.kind === 'error') {
        expect(res.message).toContain('Unknown option "--seed"');
      }
    });

    it('returns error on missing flag values', () => {
      expect(parseCliArgs(['protect', '--out-dir'])).toMatchObject({
        kind: 'error',
        message: 'Missing value for --out-dir',
      });
      expect(parseCliArgs(['protect', '--out-dir='])).toMatchObject({
        kind: 'error',
        message: 'Missing value for --out-dir',
      });
      expect(parseCliArgs(['protect', '--seed', '--aggressive'])).toMatchObject({
        kind: 'error',
        message: 'Missing value for --seed',
      });
      expect(parseCliArgs(['protect', '--private-maps-dir'])).toMatchObject({
        kind: 'error',
        message: 'Missing value for --private-maps-dir',
      });
    });

    it('returns error on NaN or invalid numeric args', () => {
      expect(parseCliArgs(['protect', '--seed', 'abc'])).toMatchObject({
        kind: 'error',
        message: 'Invalid numeric value for --seed: "abc"',
      });
      expect(parseCliArgs(['protect', '--seed=not-a-number'])).toMatchObject({
        kind: 'error',
        message: 'Invalid numeric value for --seed: "not-a-number"',
      });
      expect(parseCliArgs(['protect', '--min-string-length', 'xyz'])).toMatchObject({
        kind: 'error',
        message: 'Invalid numeric value for --min-string-length: "xyz"',
      });
      expect(parseCliArgs(['protect', '--min-string-length=-5'])).toMatchObject({
        kind: 'error',
        message: 'Invalid non-negative integer for --min-string-length: "-5"',
      });
    });

    it('parses --profile, --dry-run, and --max-gzip-delta for protect and init', () => {
      expect(
        parseCliArgs(['protect', '--profile', 'strict', '--dry-run', '--max-gzip-delta=12.5'], '/repo')
      ).toEqual({
        kind: 'protect',
        options: {
          cwd: '/repo',
          profile: 'strict',
          dryRun: true,
          maxGzipDelta: 12.5,
        },
      });

      expect(parseCliArgs(['init', '--profile=minimal'])).toEqual({
        kind: 'init',
        dryRun: false,
        profile: 'minimal',
      });

      expect(parseCliArgs(['protect', '--profile', 'invalid'])).toMatchObject({
        kind: 'error',
        message: expect.stringContaining('Invalid value for --profile'),
      });

      expect(parseCliArgs(['protect', '--max-gzip-delta=-3'])).toMatchObject({
        kind: 'error',
        message: expect.stringContaining('Invalid non-negative value for --max-gzip-delta'),
      });

      expect(parseCliArgs(['protect', '--max-gzip-delta', 'NaN'])).toMatchObject({
        kind: 'error',
        message: expect.stringContaining('Invalid numeric value for --max-gzip-delta'),
      });
    });

    it('parses check and symbolicate subcommands', () => {
      expect(
        parseCliArgs(['check', '--out-dir', 'dist', '--max-gzip-delta', '10', '--require-zero-eval', '--json'], '/repo')
      ).toEqual({
        kind: 'check',
        options: {
          cwd: '/repo',
          outDir: 'dist',
          maxGzipDelta: 10,
          requireZeroEval: true,
        },
        json: true,
      });

      expect(
        parseCliArgs(['symbolicate', '--maps-dir', '.maps', '--trace', 'at fn (app.js:1:2)'], '/repo')
      ).toEqual({
        kind: 'symbolicate',
        options: {
          cwd: '/repo',
          mapsDir: '.maps',
          stackTrace: 'at fn (app.js:1:2)',
        },
        file: undefined,
      });

      expect(parseCliArgs(['symbolicate'])).toMatchObject({
        kind: 'error',
        message: expect.stringContaining('requires either --trace'),
      });
    });
  });

  describe('runCli error exitCode and lazy version', () => {
    it('sets process.exitCode = 1 and logs error on invalid flags or commands', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      process.exitCode = undefined;
      await runCli(['--seed', 'abc']);
      expect(process.exitCode).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid numeric value for --seed'));

      errSpy.mockClear();
      process.exitCode = undefined;
      await runCli(['unknown-subcmd']);
      expect(process.exitCode).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown command "unknown-subcmd"'));
    });

    it('prints package.json version lazily on --version', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await runCli(['--version']);
      expect(logSpy).toHaveBeenCalledWith(getPackageVersion());
    });
  });
});
