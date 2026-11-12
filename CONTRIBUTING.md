# Contributing to unpeek

Thank you for your interest in contributing to `unpeek`. This repository is a TypeScript monorepo providing client-side JavaScript protection, source map isolation, and an interactive documentation website.

---

## Code of Conduct

Be considerate, constructive, and respectful to all contributors and maintainers.

---

## Development Prerequisites

- Node.js >= 18.0.0
- pnpm >= 11.0.0 (workspace package manager: pnpm@11.10.0)
- Git

Install workspace dependencies:

```bash
pnpm install
```

---

## Monorepo Layout

- `packages/unpeek/`: Core TypeScript npm package
  - `src/ast/`: Acorn AST traversal, call-graph analysis, hot-path detection, string vault, and identifier mangling
  - `src/runtime/`: Runtime anti-tamper shield, FNV-1a checksums, and passive deterrents
  - `src/bundler/`: Framework detector, unplugin bundler adapter, and `.unpeek-maps/` vault
  - `src/cli/`: Command-line interface (`unpeek init`, `unpeek protect`)
  - `benchmarks/`: V8 CPU overhead and Gzip bundle delta benchmark suite
- `apps/web/`: Next.js static launch and bilingual documentation website
- `skills/unpeek/`: AI coding agent skill definition
- `scripts/`: Version synchronization and release staging scripts

---

## Development Workflow

### 1. Build and Typecheck

Run typechecks and compile workspace projects:

```bash
# Typecheck all packages
pnpm run typecheck

# Build core package and documentation site
pnpm run build
```

### 2. Testing and Coverage

Run Vitest unit tests and ensure code coverage remains at or above 80%:

```bash
# Run all unit and reverse-engineering resistance tests
pnpm --filter unpeek run test

# Run configuration subsystem tests (validates unpeek.config discovery, merging, and schema options)
pnpm --filter unpeek test tests/config.test.ts

# Run unit tests with V8 code coverage report
pnpm --filter unpeek run test:coverage
```

### 3. Overhead Benchmarks

All changes to the AST traversal engine or runtime shield must honor the performance budget:
- Runtime CPU overhead: < 2.0%
- Gzip bundle delta: < 15.0%

Run the benchmark suite:

```bash
pnpm --filter unpeek run bench
```

### 4. Release Verification Scripts

Before creating release commits or validating release readiness, run the PowerShell verification scripts in `scripts/`:

```powershell
# 1. Test Conventional Commit version bump calculations
powershell -File scripts/test-versioning.ps1

# 2. Validate version consistency against planned commit message
powershell -File scripts/validate-version.ps1 -Message "<planned commit message>"

# 3. Stage release tarballs and generate SHA-256 checksum manifests
powershell -File scripts/stage-release.ps1
```

- `scripts/test-versioning.ps1`: Unit tests for version calculation across major, minor, patch, and no-bump Conventional Commit types.
- `scripts/validate-version.ps1`: Pre-commit validator checking version consistency across `package.json`, `packages/unpeek/package.json`, `apps/web/package.json`, `cli/index.ts`, and `apps/web/src/content/i18n.ts`.
- `scripts/stage-release.ps1`: Builds, packs `unpeek-v<version>.tgz`, and generates `unpeek-v<version>-SHA256SUMS.txt` for immutable release deployment.

---

## Commit Guidelines and Versioning

This project uses Conventional Commits to automate semantic versioning. The root `package.json` version governs all workspace packages.

Commit types:
- `feat`: New user-facing feature (increments minor version)
- `fix`: Bug fix (increments patch version)
- `perf`: Performance improvement (increments patch version)
- `refactor`: Code change without behavior modification (increments patch version)
- `docs`: Documentation update (**no version bump**)
- `test`: Test suite modifications (**no version bump**)
- `chore`: Tooling or maintenance changes (**no version bump**)

> [!IMPORTANT]
> **Documentation Commits Do Not Bump Versions:**
> Under Conventional Commits rules, `docs` commits (e.g., `docs: update configuration guide`) do not increment semantic version numbers in `prepare-version.ps1` or trigger package release builds. The root `package.json` version remains unchanged for documentation-only changes.

Breaking changes:
- Header containing `!` or body containing `BREAKING CHANGE:` triggers a major version bump.

Before committing, synchronize workspace versions using the preparation script:

```powershell
powershell -File scripts/prepare-version.ps1 -Message "<planned commit message>"
```

Validate release readiness:

```powershell
powershell -File scripts/validate-version.ps1 -Message "<planned commit message>"
```

---

## Pull Request Process

1. Create a feature branch from `main`.
2. Keep edits focused and surgical. Touch only files directly related to the issue.
3. Write or update tests covering the changed functionality.
4. Verify that `pnpm run typecheck`, `pnpm --filter unpeek run test:coverage`, and `pnpm run build` pass with zero errors.
5. Submit a pull request with a concise description of the change, test evidence, and motivation.
