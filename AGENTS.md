# unpeek Agent Briefing

<project_context>
unpeek is a zero-config, call-graph-aware client-side JavaScript protection and anti-reverse-engineering toolkit targeting Next.js, Vite, Webpack, Rollup, and vanilla JS applications. A companion Next.js static launch and bilingual (EN/TR) documentation website lives under apps/web/. You are pair programming with the user to inspect, modify, test, benchmark, and release this codebase.
</project_context>

<engineering_principles>
1. Think before implementing: Formulate verifiable assumptions and inspect repository evidence first. When .codegraph/ is present, query CodeGraph (codegraph_explore) for call-path and symbol analysis before broad text scans.
2. Surgical and minimal changes: Modify only the files and lines necessary for the assigned task. Preserve untouched code, existing formatting, and uncommitted user edits to keep review diffs clean and prevent merge friction.
3. Preserve performance and size budgets: Maintain call-graph hot-path exemption (loops, array higher-order callbacks, requestAnimationFrame, UI render functions, and their callers) and O(1) const-array string vaults so runtime CPU overhead stays below 2% and Gzip size delta stays below 15%.
4. Clean your own artifacts: Remove unused imports, variables, and temporary helpers introduced by your changes. Document pre-existing technical debt separately rather than refactoring it without request.
</engineering_principles>

<repository_layout>
- packages/unpeek/: Core TypeScript npm package (AST engine, runtime anti-tamper shield, bundler detector, source map vault, CLI, and unplugin adapter).
- apps/web/: Next.js 15 static export launch website and bilingual (EN/TR) documentation.
- skills/unpeek/: Portable AI agent skill definition (SKILL.md) for equipping coding agents with unpeek workflows.
- scripts/: Conventional Commit version synchronization, release backlog discovery, artifact staging, and release integrity verification scripts.
- .github/workflows/: CI pipeline, automated immutable GitHub Release + npm publish pipeline, and GitHub Pages deployment workflow.
</repository_layout>

<versioning_and_git>
1. Single version authority: The root package.json "version" field governs all workspace package versions (packages/unpeek/package.json, apps/web/package.json), the CLI version banner (packages/unpeek/src/cli/index.ts), and website release metadata (apps/web/src/content/i18n.ts) to keep artifacts in sync without drift.
2. Synchronize before committing: Run the version preparation script with your planned commit message before creating a commit:
   powershell -File scripts/prepare-version.ps1 -Message "<commit message>"
   This script increments the version based on Conventional Commit semantics:
   - Major: Header containing '!' or body with 'BREAKING CHANGE:'
   - Minor: 'feat'
   - Patch: 'fix', 'perf', 'refactor', 'build', 'security'
   - No bump: 'docs', 'ci', 'test', 'chore' (and 'build(deps)' / 'chore(deps)')
3. Atomic commits: Use the identical Conventional Commit subject in both prepare-version.ps1 and git commit. Stage only files relevant to the change, leaving uncommitted user work untouched. Every commit on main is an independently releasable build candidate.
</versioning_and_git>

<verification>
Run checks proportional to the change and inspect actual command output before declaring completion:

Core package & benchmarks:
pnpm run typecheck
pnpm --filter unpeek run test:coverage
pnpm --filter unpeek run bench

Website & full build:
pnpm run build

Release readiness & version consistency:
powershell -File scripts/test-versioning.ps1
powershell -File scripts/validate-version.ps1 -Message "<exact full commit message>"
powershell -File scripts/stage-release.ps1

Report check statuses as PASS, FAIL, or NOT EXECUTED based on actual execution. Resolve failures by correcting code behavior rather than weakening assertions or linters.
</verification>

<security_and_release>
1. Client-only protection boundary: Process only browser-targeted output directories (.next/static/chunks, dist/assets, build/static/js) and leave server/SSR bundles (.next/server) untouched so server stack traces remain readable and SSR hydration stays fast.
2. Private source map vault: Extract production .map files into .unpeek-maps/ and strip //# sourceMappingURL= comments from public client bundles. Ensure .unpeek-maps/ remains in .gitignore and is never uploaded as a public release artifact.
3. Immutable releases: Every version-bumping commit on main produces a verified tarball (unpeek-v<version>.tgz) and SHA-256 checksum manifest (unpeek-v<version>-SHA256SUMS.txt) verified by scripts/test-existing-release.ps1 and published to GitHub Releases and npm.
4. Secret isolation: Registry tokens (NPM_TOKEN) and credentials belong exclusively in encrypted GitHub Actions secrets or local user keyrings. Never print, stage, or commit secret values.
</security_and_release>

<delegation_and_completion>
1. Bounded subagents: Assign subagents focused, non-overlapping tasks. Require subagents to report changed files, executed checks, and any unresolved assumptions.
2. Completion criteria: Mark a task complete only after the requested behavior is verified, relevant tests and benchmarks pass, and the final git diff has been reviewed for cleanliness.
</delegation_and_completion>
