param(
    [string]$Message,
    [string]$CommitSha = "HEAD",
    [string]$RepoRoot
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "versioning.ps1")

$RepoRoot = if ($RepoRoot) { $RepoRoot } else { Join-Path $PSScriptRoot ".." }
$RepoRoot = (Resolve-Path $RepoRoot).Path

$RootPkgPath = Join-Path $RepoRoot "package.json"
$UnpeekPkgPath = Join-Path $RepoRoot "packages\unpeek\package.json"
$WebPkgPath = Join-Path $RepoRoot "apps\web\package.json"
$CliTsPath = Join-Path $RepoRoot "packages\unpeek\src\cli\index.ts"
$WebI18nPath = Join-Path $RepoRoot "apps\web\src\content\i18n.ts"

$RootVersion = Get-ProductVersionFromJson ([System.IO.File]::ReadAllText($RootPkgPath))

if (Test-Path -LiteralPath $UnpeekPkgPath) {
    $UnpeekVersion = Get-ProductVersionFromJson ([System.IO.File]::ReadAllText($UnpeekPkgPath))
    if ($UnpeekVersion -cne $RootVersion) {
        throw "packages/unpeek/package.json version '$UnpeekVersion' does not match root package.json version '$RootVersion'."
    }
}

if (Test-Path -LiteralPath $WebPkgPath) {
    $WebVersion = Get-ProductVersionFromJson ([System.IO.File]::ReadAllText($WebPkgPath))
    if ($WebVersion -cne $RootVersion) {
        throw "apps/web/package.json version '$WebVersion' does not match root package.json version '$RootVersion'."
    }
}

if (Test-Path -LiteralPath $CliTsPath) {
    $CliVersion = Get-CliVersionFromTs ([System.IO.File]::ReadAllText($CliTsPath))
    if ($CliVersion -cne $RootVersion) {
        throw "packages/unpeek/src/cli/index.ts VERSION '$CliVersion' does not match root package.json version '$RootVersion'."
    }
}

if (Test-Path -LiteralPath $WebI18nPath) {
    $WebVersions = @(Get-WebVersionsFromI18n ([System.IO.File]::ReadAllText($WebI18nPath)))
    foreach ($Ver in $WebVersions) {
        if ($Ver -cne $RootVersion) {
            throw "apps/web/src/content/i18n.ts version 'v$Ver' does not match root package.json version '$RootVersion'."
        }
    }
}

$ResolvedCommit = (& git -C $RepoRoot rev-parse "$CommitSha^{commit}" 2>$null)
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve commit '$CommitSha'" }
$ResolvedCommit = $ResolvedCommit.Trim()
$CommitPkgLines = & git -C $RepoRoot show "${ResolvedCommit}:package.json"
if ($LASTEXITCODE -ne 0) { throw "Cannot read package.json at '$ResolvedCommit'" }
$CommitVersion = Get-ProductVersionFromJson ($CommitPkgLines -join "`n")

if ($Message) {
    $Bump = Get-VersionBump $Message
    $ExpectedVersion = Get-NextProductVersion -Version $CommitVersion -Bump $Bump
    if ($RootVersion -ne $ExpectedVersion) {
        throw "Working tree requires product version $ExpectedVersion ($Bump), but contains $RootVersion."
    }
    $ValidatedVersion = $RootVersion
} else {
    if ($RootVersion -ne $CommitVersion) {
        throw "Working tree version $RootVersion differs from $CommitSha version $CommitVersion. Pass -Message with the proposed full commit message before committing."
    }
    $ParentLine = (& git -C $RepoRoot rev-list --parents -n 1 $ResolvedCommit).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect parents for '$ResolvedCommit'" }
    $ParentTokens = @($ParentLine -split '\s+' | Where-Object { $_ })
    if ($ParentTokens.Count -gt 1) {
        $Parent = $ParentTokens[1]
        $ParentPkgLines = & git -C $RepoRoot show "${Parent}:package.json"
        if ($LASTEXITCODE -ne 0) { throw "Cannot read package.json at parent '$Parent'" }
        $ParentVersion = Get-ProductVersionFromJson ($ParentPkgLines -join "`n")
        $CommitMessage = (& git -C $RepoRoot show -s --format=%B $ResolvedCommit) -join "`n"
        $Bump = Get-VersionBump $CommitMessage
        $ExpectedVersion = Get-NextProductVersion -Version $ParentVersion -Bump $Bump
        if ($CommitVersion -ne $ExpectedVersion) {
            throw "Commit $ResolvedCommit requires product version $ExpectedVersion ($Bump), but contains $CommitVersion."
        }
    }
    $ValidatedVersion = $CommitVersion
    Get-ValidatedVersionHistory -RepoRoot $RepoRoot -TargetSha $ResolvedCommit | Out-Null
}

if ($env:GITHUB_REF_TYPE -eq "tag") {
    $ExpectedTag = "v$ValidatedVersion"
    if ($env:GITHUB_REF_NAME -cne $ExpectedTag) {
        throw "Git tag '$env:GITHUB_REF_NAME' must match product version '$ExpectedTag'."
    }
}

Write-Host "Product version validation passed: $ValidatedVersion" -ForegroundColor Green
