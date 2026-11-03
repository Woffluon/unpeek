param(
    [Parameter(Mandatory, HelpMessage = "Exact full commit message, including any BREAKING CHANGE body")][ValidateNotNullOrEmpty()][string]$Message,
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

$CurrentRootPkg = [System.IO.File]::ReadAllText($RootPkgPath)
$CurrentVersion = Get-ProductVersionFromJson $CurrentRootPkg

$HeadPkgLines = & git -C $RepoRoot show "HEAD:package.json"
if ($LASTEXITCODE -ne 0) {
    throw "Cannot read package.json from HEAD"
}
$HeadVersion = Get-ProductVersionFromJson ($HeadPkgLines -join "`n")
$Bump = Get-VersionBump $Message
$ExpectedVersion = Get-NextProductVersion -Version $HeadVersion -Bump $Bump

if ($CurrentVersion -eq $ExpectedVersion -and $Bump -ne "none") {
    Write-Host "Product version is already prepared: $CurrentVersion"
    return
}
if ($CurrentVersion -ne $HeadVersion) {
    throw "Product version is '$CurrentVersion'; expected HEAD version '$HeadVersion' or prepared version '$ExpectedVersion'."
}
if ($Bump -eq "none") {
    Write-Host "Commit type does not change the product version ($CurrentVersion)."
    return
}

$Snapshots = @{}
$TargetFiles = @($RootPkgPath, $UnpeekPkgPath, $WebPkgPath, $CliTsPath, $WebI18nPath)
foreach ($Path in $TargetFiles) {
    if (Test-Path -LiteralPath $Path) {
        $Snapshots[$Path] = [System.IO.File]::ReadAllText($Path)
    }
}

$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
try {
    foreach ($JsonPath in @($RootPkgPath, $UnpeekPkgPath, $WebPkgPath)) {
        if ($Snapshots.ContainsKey($JsonPath)) {
            $Updated = Set-ProductVersionInJson -Content $Snapshots[$JsonPath] -Version $ExpectedVersion
            [System.IO.File]::WriteAllText($JsonPath, $Updated, $Utf8NoBom)
        }
    }

    if ($Snapshots.ContainsKey($CliTsPath)) {
        $UpdatedCli = Set-CliVersionInTs -Content $Snapshots[$CliTsPath] -Version $ExpectedVersion
        [System.IO.File]::WriteAllText($CliTsPath, $UpdatedCli, $Utf8NoBom)
    }

    if ($Snapshots.ContainsKey($WebI18nPath)) {
        $UpdatedI18n = Set-WebVersionsInI18n -Content $Snapshots[$WebI18nPath] -Version $ExpectedVersion
        [System.IO.File]::WriteAllText($WebI18nPath, $UpdatedI18n, $Utf8NoBom)
    }
} catch {
    foreach ($Path in $Snapshots.Keys) {
        [System.IO.File]::WriteAllText($Path, $Snapshots[$Path], $Utf8NoBom)
    }
    throw
}

Write-Host "Prepared product version: $HeadVersion -> $ExpectedVersion ($Bump)" -ForegroundColor Green
