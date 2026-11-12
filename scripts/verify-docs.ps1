param(
    [string]$CommitSha,
    [string]$Base,
    [string]$RepoRoot,
    [switch]$Strict
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

$RepoRoot = if ($RepoRoot) { $RepoRoot } else { Join-Path $PSScriptRoot ".." }
$RepoRoot = (Resolve-Path $RepoRoot).Path

function Get-ChangedFiles {
    param([string]$RepoRoot, [string]$CommitSha, [string]$Base)

    if ($CommitSha) {
        $Files = @(& git -C $RepoRoot diff-tree --no-commit-id --name-only -r $CommitSha)
        if ($LASTEXITCODE -ne 0) { throw "Failed to inspect commit '$CommitSha'." }
        return $Files
    }
    if ($Base) {
        $Files = @(& git -C $RepoRoot diff --name-only "$Base..HEAD")
        if ($LASTEXITCODE -ne 0) { throw "Failed to inspect diff against base '$Base'." }
        return $Files
    }

    $Working = @(& git -C $RepoRoot diff --name-only HEAD)
    $Staged = @(& git -C $RepoRoot diff --cached --name-only)
    $Untracked = @(& git -C $RepoRoot ls-files --others --exclude-standard)
    $All = @($Working + $Staged + $Untracked | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    return $All
}

function Test-I18nHasDocChanges {
    param([string]$RepoRoot, [string]$CommitSha, [string]$Base)

    $I18nRel = "apps/web/src/content/i18n.ts"
    $DiffOutput = if ($CommitSha) {
        & git -C $RepoRoot show -U0 $CommitSha -- $I18nRel
    } elseif ($Base) {
        & git -C $RepoRoot diff -U0 "$Base..HEAD" -- $I18nRel
    } else {
        & git -C $RepoRoot diff -U0 HEAD -- $I18nRel
    }

    if (-not $DiffOutput -or $DiffOutput.Count -eq 0) { return $false }

    $AddedLines = @($DiffOutput | Where-Object { $_ -match '^\+[^+]' })
    $NonVersionLines = @($AddedLines | Where-Object { $_ -notmatch '^\+\s*"version"\s*:' -and $_ -notmatch '^\+\s*version\s*:' })
    return ($NonVersionLines.Count -gt 0)
}

function Test-I18nSymmetry {
    param([string]$RepoRoot, [string]$CommitSha, [string]$Base)

    $I18nRel = "apps/web/src/content/i18n.ts"
    $I18nPath = Join-Path $RepoRoot $I18nRel
    if (-not (Test-Path -LiteralPath $I18nPath)) { return $true }

    # Find line where 'tr: {' begins
    $Lines = [System.IO.File]::ReadAllLines($I18nPath)
    $TrStartLine = 0
    for ($i = 0; $i -lt $Lines.Length; $i++) {
        if ($Lines[$i] -match '^\s*tr:\s*\{') {
            $TrStartLine = $i + 1
            break
        }
    }
    if ($TrStartLine -eq 0) { return $true }

    # Get diff hunks for i18n.ts
    $DiffOutput = if ($CommitSha) {
        & git -C $RepoRoot show -U0 $CommitSha -- $I18nRel
    } elseif ($Base) {
        & git -C $RepoRoot diff -U0 "$Base..HEAD" -- $I18nRel
    } else {
        & git -C $RepoRoot diff -U0 HEAD -- $I18nRel
    }

    if (-not $DiffOutput -or $DiffOutput.Count -eq 0) {
        return $true
    }

    $HasEn = $false
    $HasTr = $false

    foreach ($Line in $DiffOutput) {
        # Match hunk header: @@ -old,count +new,count @@ or @@ -old +new @@
        if ($Line -match '^@@\s+-(?:\d+)(?:,\d+)?\s+\+(?<newLine>\d+)(?:,\d+)?\s+@@') {
            $LineNum = [int]$Matches["newLine"]
            if ($LineNum -lt $TrStartLine) {
                $HasEn = $true
            } else {
                $HasTr = $true
            }
        }
    }

    # If only one was touched, that's asymmetric
    if ($HasEn -xor $HasTr) {
        return $false
    }
    return $true
}

$Changed = @(Get-ChangedFiles -RepoRoot $RepoRoot -CommitSha $CommitSha -Base $Base)

if ($Changed.Count -eq 0) {
    Write-Host "[DOCS_VERIFY] PASS: Working tree is clean. No uncommitted changes to verify." -ForegroundColor Green
    exit 0
}

$Errors = [System.Collections.Generic.List[string]]::new()

# Categorize changed files
$CliChanged = @($Changed | Where-Object { $_ -match '^packages/unpeek/src/cli/' })
$ApiChanged = @($Changed | Where-Object { $_ -match '^packages/unpeek/src/(options|types|config)\.ts$' -or $_ -eq 'packages/unpeek/src/index.ts' })
$AdapterChanged = @($Changed | Where-Object { $_ -match '^packages/unpeek/src/(next|plugins|bundler)/' })
$BenchChanged = @($Changed | Where-Object { $_ -match '^packages/unpeek/benchmarks/' })
$SrcChanged = @($Changed | Where-Object { $_ -match '^packages/unpeek/src/' })

# Documentation files in change
$ReadmeEn = $Changed -contains 'README.md'
$ReadmeTr = $Changed -contains 'README.tr.md'
$PkgReadmeEn = $Changed -contains 'packages/unpeek/README.md'
$PkgReadmeTr = $Changed -contains 'packages/unpeek/README.tr.md'
$WebI18n = $Changed -contains 'apps/web/src/content/i18n.ts'
$WebI18nHasDocChanges = if ($WebI18n) { Test-I18nHasDocChanges -RepoRoot $RepoRoot -CommitSha $CommitSha -Base $Base } else { $false }
$SkillChanged = @($Changed | Where-Object { $_ -match '^skills/unpeek/' })
$Changelog = $Changed -contains 'CHANGELOG.md'

# --- Symmetry Verification ---
if ($ReadmeEn -xor $ReadmeTr) {
    $Missing = if ($ReadmeEn) { "README.tr.md" } else { "README.md" }
    $Errors.Add("Asymmetric root README: README.md and README.tr.md must be updated in lockstep. Missing: $Missing")
}

if ($PkgReadmeEn -xor $PkgReadmeTr) {
    $Missing = if ($PkgReadmeEn) { "packages/unpeek/README.tr.md" } else { "packages/unpeek/README.md" }
    $Errors.Add("Asymmetric package README: packages/unpeek/README.md and packages/unpeek/README.tr.md must be updated in lockstep. Missing: $Missing")
}

if ($WebI18n) {
    $I18nSymmetric = Test-I18nSymmetry -RepoRoot $RepoRoot -CommitSha $CommitSha -Base $Base
    if (-not $I18nSymmetric) {
        $Errors.Add("Asymmetric apps/web/src/content/i18n.ts: Changes detected in only one language. Both 'en' and 'tr' dictionaries must be updated symmetrically.")
    }
}

# --- Tier 1: Deterministic Contract Failures ---
if ($CliChanged.Count -gt 0) {
    $HasCliDoc = ($ReadmeEn -and $ReadmeTr) -or ($PkgReadmeEn -and $PkgReadmeTr) -or ($SkillChanged.Count -gt 0) -or $WebI18nHasDocChanges
    if (-not $HasCliDoc) {
        $Errors.Add("CLI source code changed ($($CliChanged -join ', ')), but no CLI documentation was updated.`n  Action required: Surgically update CLI flags/commands in README.md/README.tr.md, skills/unpeek/references/, or apps/web/src/content/i18n.ts.")
    }
}

if ($ApiChanged.Count -gt 0) {
    $HasApiDoc = ($ReadmeEn -and $ReadmeTr) -or ($PkgReadmeEn -and $PkgReadmeTr) -or ($SkillChanged.Count -gt 0) -or $WebI18nHasDocChanges
    if (-not $HasApiDoc) {
        $Errors.Add("Public options/API changed ($($ApiChanged -join ', ')), but no API/Options documentation was updated.`n  Action required: Surgically update options table in README.md/README.tr.md, skills/unpeek/references/api.md, or apps/web/src/content/i18n.ts.")
    }
}

if ($AdapterChanged.Count -gt 0) {
    $HasAdapterDoc = ($SkillChanged.Count -gt 0) -or $WebI18nHasDocChanges -or ($ReadmeEn -and $ReadmeTr) -or ($PkgReadmeEn -and $PkgReadmeTr)
    if (-not $HasAdapterDoc) {
        $Errors.Add("Framework/bundler adapter changed ($($AdapterChanged -join ', ')), but integration documentation was not updated.`n  Action required: Surgically update skills/unpeek/references/frameworks.md, apps/web/src/content/i18n.ts, or README.md.")
    }
}

if ($BenchChanged.Count -gt 0) {
    $HasBenchDoc = ($ReadmeEn -and $ReadmeTr) -or $WebI18nHasDocChanges
    if (-not $HasBenchDoc) {
        $Errors.Add("Benchmark code changed ($($BenchChanged -join ', ')), but performance metrics documentation was not updated.`n  Action required: Update benchmark numbers in README.md/README.tr.md or apps/web/src/content/i18n.ts.")
    }
}

# --- Tier 2: Source change & CHANGELOG check ---
if ($SrcChanged.Count -gt 0) {
    $HasAnyDocOrChangelog = $Changelog -or $ReadmeEn -or $PkgReadmeEn -or $WebI18nHasDocChanges -or ($SkillChanged.Count -gt 0)
    if (-not $HasAnyDocOrChangelog) {
        $Errors.Add("Source code in packages/unpeek/src changed ($($SrcChanged.Count) files), but neither CHANGELOG.md nor documentation was updated.`n  Action required: Document changes in CHANGELOG.md or update relevant docs.")
    }
}

# --- Skill reference integrity check ---
$SkillDir = Join-Path $RepoRoot "skills/unpeek"
$SkillMd = Join-Path $SkillDir "SKILL.md"
if (Test-Path -LiteralPath $SkillMd) {
    $SkillContent = [System.IO.File]::ReadAllText($SkillMd)
    $Matches = [regex]::Matches($SkillContent, 'references/[a-zA-Z0-9_\-]+\.md')
    foreach ($Match in $Matches) {
        $RefPath = Join-Path $SkillDir $Match.Value.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        if (-not (Test-Path -LiteralPath $RefPath)) {
            $Errors.Add("Broken skill reference in SKILL.md: '$($Match.Value)' does not exist.")
        }
    }
}

# Report results
if ($Errors.Count -gt 0) {
    Write-Host "[DOCS_VERIFY] FAIL: Documentation sync violations detected ($($Errors.Count) errors):" -ForegroundColor Red
    foreach ($Err in $Errors) {
        Write-Host "  * $Err" -ForegroundColor Red
    }
    Write-Host "`nToken-optimized remediation guidelines:" -ForegroundColor Yellow
    Write-Host "  1. Do NOT dump or read entire files into context." -ForegroundColor Yellow
    Write-Host "  2. Use git diff or targeted search (grep / Select-String) to locate the exact section." -ForegroundColor Yellow
    Write-Host "  3. For apps/web/src/content/i18n.ts, edit both 'en' and 'tr' dictionaries symmetrically." -ForegroundColor Yellow
    exit 1
}

Write-Host "[DOCS_VERIFY] PASS: Documentation is in sync across all surfaces." -ForegroundColor Green
exit 0
