Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "versioning.ps1")

function Assert-Equal($Expected, $Actual, [string]$Case) {
    if ($Expected -cne $Actual) {
        throw "$Case failed: expected '$Expected', got '$Actual'"
    }
}

Assert-Equal "minor" (Get-VersionBump "feat: add cold-flow guard") "feat bump"
Assert-Equal "minor" (Get-VersionBump "feat(ast): add cold-flow guard") "scoped feat bump"
Assert-Equal "patch" (Get-VersionBump "fix: preserve hot loop") "fix bump"
Assert-Equal "patch" (Get-VersionBump "perf(vault): cache decoded strings") "perf bump"
Assert-Equal "patch" (Get-VersionBump "refactor: simplify mangler") "refactor bump"
Assert-Equal "patch" (Get-VersionBump "build: update tsconfig") "build bump"
Assert-Equal "patch" (Get-VersionBump "security: tighten sourcemap strip") "security bump"
Assert-Equal "none" (Get-VersionBump "docs: update README") "docs bump"
Assert-Equal "none" (Get-VersionBump "ci: pin workflow action") "ci bump"
Assert-Equal "none" (Get-VersionBump "test: add rea test") "test bump"
Assert-Equal "none" (Get-VersionBump "chore: format files") "chore bump"
Assert-Equal "none" (Get-VersionBump "chore(deps): bump acorn from 8.14.0 to 8.14.1") "deps chore bump"
Assert-Equal "none" (Get-VersionBump "build(deps-dev): bump typescript") "deps-dev build bump"
Assert-Equal "major" (Get-VersionBump "feat!: change protect API") "breaking header bump"
Assert-Equal "major" (Get-VersionBump "fix: change behavior`n`nBREAKING CHANGE: CLI flag renamed") "breaking body bump"

Assert-Equal "1.0.1" (Get-NextProductVersion -Version "1.0.0" -Bump "patch") "patch increment"
Assert-Equal "1.1.0" (Get-NextProductVersion -Version "1.0.9" -Bump "minor") "minor increment"
Assert-Equal "2.0.0" (Get-NextProductVersion -Version "1.4.2" -Bump "major") "major increment"
Assert-Equal "1.4.2" (Get-NextProductVersion -Version "1.4.2" -Bump "none") "no increment"

$EmptySelection = @(Get-LatestReleaseSelection -Candidates @() -TargetSha "deadbeef")
Assert-Equal 0 $EmptySelection.Count "empty release selection"
$LatestSelection = @(Get-LatestReleaseSelection -Candidates @(
    [pscustomobject]@{ sha = "1111111"; version = "1.0.1"; tag = "v1.0.1" },
    [pscustomobject]@{ sha = "2222222"; version = "1.1.0"; tag = "v1.1.0" }
) -TargetSha "3333333")
Assert-Equal 1 $LatestSelection.Count "collapsed release selection count"
Assert-Equal "3333333" $LatestSelection[0].sha "collapsed release selection sha"
Assert-Equal "1.1.0" $LatestSelection[0].version "collapsed release selection version"
Assert-Equal "v1.1.0" $LatestSelection[0].tag "collapsed release selection tag"

$PreparePath = Join-Path $PSScriptRoot "prepare-version.ps1"
$ValidatePath = Join-Path $PSScriptRoot "validate-version.ps1"
$TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("unpeek-version-test-" + [Guid]::NewGuid().ToString("N"))

function Write-TestFile([string]$Path, [string]$Content) {
    $Parent = Split-Path -Parent $Path
    if ($Parent -and -not (Test-Path -LiteralPath $Parent)) {
        New-Item -ItemType Directory -Path $Parent -Force | Out-Null
    }
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Initialize-TestRepo([string]$RepoPath) {
    & git -C $RepoPath init --quiet
    if ($LASTEXITCODE -ne 0) { throw "Failed to initialize test git repository." }
    & git -C $RepoPath config core.autocrlf false
    & git -C $RepoPath add .
    if ($LASTEXITCODE -ne 0) { throw "Failed to stage test git repository." }
    & git -C $RepoPath -c user.name=unpeek-Test -c user.email=test@example.invalid commit --quiet --no-gpg-sign -m "chore: initial version fixture"
    if ($LASTEXITCODE -ne 0) { throw "Failed to commit test git repository." }
}

try {
    $SuccessRepo = Join-Path $TestRoot "success"
    New-Item -ItemType Directory -Path $SuccessRepo | Out-Null
    Write-TestFile (Join-Path $SuccessRepo "package.json") "{`n  `"name`": `"unpeek-monorepo`",`n  `"version`": `"1.0.0`"`n}`n"
    Write-TestFile (Join-Path $SuccessRepo "packages\unpeek\package.json") "{`n  `"name`": `"unpeek`",`n  `"version`": `"1.0.0`"`n}`n"
    Write-TestFile (Join-Path $SuccessRepo "apps\web\package.json") "{`n  `"name`": `"web`",`n  `"version`": `"1.0.0`"`n}`n"
    Write-TestFile (Join-Path $SuccessRepo "packages\unpeek\src\cli\index.ts") "const VERSION = '1.0.0';`n"
    Write-TestFile (Join-Path $SuccessRepo "apps\web\src\content\i18n.ts") "export const D = { en: { meta: { version: `"v1.0.0`" } }, tr: { meta: { version: `"v1.0.0`" } } };`n"
    Initialize-TestRepo $SuccessRepo

    & $PreparePath -Message "feat: add unplugin support" -RepoRoot $SuccessRepo
    Assert-Equal "1.1.0" (Get-ProductVersionFromJson ([IO.File]::ReadAllText((Join-Path $SuccessRepo "package.json")))) "prepare root version"
    Assert-Equal "1.1.0" (Get-ProductVersionFromJson ([IO.File]::ReadAllText((Join-Path $SuccessRepo "packages\unpeek\package.json")))) "prepare pkg version"
    Assert-Equal "1.1.0" (Get-CliVersionFromTs ([IO.File]::ReadAllText((Join-Path $SuccessRepo "packages\unpeek\src\cli\index.ts")))) "prepare cli version"
    & $ValidatePath -Message "feat: add unplugin support" -RepoRoot $SuccessRepo

    $PreparedRoot = [IO.File]::ReadAllText((Join-Path $SuccessRepo "package.json"))
    & $PreparePath -Message "feat: add unplugin support" -RepoRoot $SuccessRepo
    Assert-Equal $PreparedRoot ([IO.File]::ReadAllText((Join-Path $SuccessRepo "package.json"))) "prepare idempotency"

    Write-TestFile (Join-Path $SuccessRepo "package.json") (Set-ProductVersionInJson -Content $PreparedRoot -Version "1.2.0")
    $ConflictFailed = $false
    try { & $PreparePath -Message "fix: conflicting version" -RepoRoot $SuccessRepo } catch { $ConflictFailed = $true }
    if (-not $ConflictFailed) { throw "prepare version accepted a conflicting product version" }

    Write-TestFile (Join-Path $SuccessRepo "package.json") $PreparedRoot
    Write-TestFile (Join-Path $SuccessRepo "scripts\versioning.ps1") ([IO.File]::ReadAllText((Join-Path $PSScriptRoot "versioning.ps1")))
    & git -C $SuccessRepo add .
    & git -C $SuccessRepo -c user.name=unpeek-Test -c user.email=test@example.invalid commit --quiet --no-gpg-sign -m "feat: add unplugin support"
    if ($LASTEXITCODE -ne 0) { throw "Failed to commit prepared test version." }

    & $ValidatePath -RepoRoot $SuccessRepo
    $History = @(Get-ValidatedVersionHistory -RepoRoot $SuccessRepo -TargetSha HEAD)
    Assert-Equal 1 $History.Count "version history count"
    Assert-Equal "1.1.0" $History[0].version "version history release"

    $RootContractRepo = Join-Path $TestRoot "root-contract"
    New-Item -ItemType Directory -Path $RootContractRepo | Out-Null
    Write-TestFile (Join-Path $RootContractRepo "package.json") "{`n  `"name`": `"unpeek-monorepo`",`n  `"version`": `"1.0.0`"`n}`n"
    Write-TestFile (Join-Path $RootContractRepo "scripts\versioning.ps1") ([IO.File]::ReadAllText((Join-Path $PSScriptRoot "versioning.ps1")))
    & git -C $RootContractRepo init --quiet
    & git -C $RootContractRepo config core.autocrlf false
    & git -C $RootContractRepo add .
    & git -C $RootContractRepo -c user.name=unpeek-Test -c user.email=test@example.invalid commit --quiet --no-gpg-sign -m "feat: initial release"
    $RootHistory = @(Get-ValidatedVersionHistory -RepoRoot $RootContractRepo -TargetSha HEAD)
    Assert-Equal 1 $RootHistory.Count "root contract history count"
    Assert-Equal "1.0.0" $RootHistory[0].version "root contract version"
    Assert-Equal "v1.0.0" $RootHistory[0].tag "root contract tag"

    Write-TestFile (Join-Path $SuccessRepo "package.json") (Set-ProductVersionInJson -Content $PreparedRoot -Version "1.2.0")
    & git -C $SuccessRepo add package.json
    & git -C $SuccessRepo -c user.name=unpeek-Test -c user.email=test@example.invalid commit --quiet --no-gpg-sign -m "docs: invalid version bump"
    if ($LASTEXITCODE -ne 0) { throw "Failed to commit invalid history fixture." }
    $HistoryFailed = $false
    try { Get-ValidatedVersionHistory -RepoRoot $SuccessRepo -TargetSha HEAD | Out-Null } catch { $HistoryFailed = $true }
    if (-not $HistoryFailed) { throw "version history accepted an invalid transition" }
} finally {
    $ResolvedTemp = [IO.Path]::GetFullPath($TestRoot)
    if ($ResolvedTemp.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $ResolvedTemp)) {
        Remove-Item -LiteralPath $ResolvedTemp -Recurse -Force
    }
}

Write-Host "Versioning tests passed." -ForegroundColor Green
