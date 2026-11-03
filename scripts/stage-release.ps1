param(
    [string]$RepoRoot,
    [string]$OutDir
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "versioning.ps1")

$RepoRoot = if ($RepoRoot) { (Resolve-Path $RepoRoot).Path } else { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$OutDir = if ($OutDir) { $OutDir } else { Join-Path $RepoRoot "artifacts" }
if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}
$OutDir = (Resolve-Path $OutDir).Path

$RootPkgPath = Join-Path $RepoRoot "package.json"
$Version = Get-ProductVersionFromJson ([System.IO.File]::ReadAllText($RootPkgPath))
$PkgDir = Join-Path $RepoRoot "packages\unpeek"

Copy-Item -LiteralPath (Join-Path $RepoRoot "README.md") -Destination (Join-Path $PkgDir "README.md") -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot "LICENSE") -Destination (Join-Path $PkgDir "LICENSE") -Force

& pnpm --dir $RepoRoot --filter unpeek run build
if ($LASTEXITCODE -ne 0) { throw "Failed to build packages/unpeek" }

Get-ChildItem -LiteralPath $OutDir -Filter "unpeek-*.tgz" -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem -LiteralPath $OutDir -Filter "unpeek-*-SHA256SUMS.txt" -ErrorAction SilentlyContinue | Remove-Item -Force

Push-Location $PkgDir
try {
    & npm pack --pack-destination $OutDir | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm pack failed for packages/unpeek" }
} finally {
    Pop-Location
}

$RawPack = Join-Path $OutDir "unpeek-$Version.tgz"
$TargetTarballName = "unpeek-v$Version.tgz"
$TargetTarballPath = Join-Path $OutDir $TargetTarballName
if ((Test-Path -LiteralPath $RawPack) -and ($RawPack -cne $TargetTarballPath)) {
    Move-Item -LiteralPath $RawPack -Destination $TargetTarballPath -Force
}
if (-not (Test-Path -LiteralPath $TargetTarballPath)) {
    throw "Expected release tarball was not created: $TargetTarballPath"
}

$Hash = (Get-FileHash -LiteralPath $TargetTarballPath -Algorithm SHA256).Hash.ToLowerInvariant()
$ChecksumFile = Join-Path $OutDir "unpeek-v$Version-SHA256SUMS.txt"
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($ChecksumFile, "$Hash  $TargetTarballName`n", $Utf8NoBom)

Write-Host "Staged release artifacts in ${OutDir}:" -ForegroundColor Green
Write-Host "  $Hash  $TargetTarballName"
