param([string]$RepoRoot)

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

$RepoRoot = if ($RepoRoot) { $RepoRoot } else { Join-Path $PSScriptRoot ".." }
$RepoRoot = (Resolve-Path $RepoRoot).Path
$ScriptPath = Join-Path $PSScriptRoot "verify-docs.ps1"

Write-Host "Running verify-docs.ps1 automated suite..." -ForegroundColor Cyan

# Test 1: Historical commit 28766ef (Asymmetric package README)
$Out1 = & powershell -File $ScriptPath -CommitSha 28766ef 2>&1
if ($LASTEXITCODE -ne 1 -or ($Out1 -join "`n") -notmatch "Asymmetric package README") {
    throw "Test 1 Failed: Expected exit code 1 with Asymmetric package README error."
}
Write-Host "  PASS: Detected asymmetric package README on historical commit 28766ef" -ForegroundColor Green

# Test 2: Historical commit 5022b18 (CLI changed without doc update, version bump only)
$Out2 = & powershell -File $ScriptPath -CommitSha 5022b18 2>&1
if ($LASTEXITCODE -ne 1 -or ($Out2 -join "`n") -notmatch "CLI source code changed") {
    throw "Test 2 Failed: Expected exit code 1 with CLI doc sync failure on commit 5022b18."
}
Write-Host "  PASS: Detected CLI doc drift on commit 5022b18 (ignored pure version bump)" -ForegroundColor Green

# Test 3: Historical commit af80844 (Chore web SEO doc/meta)
$Out3 = & powershell -File $ScriptPath -CommitSha af80844 2>&1
if ($LASTEXITCODE -ne 0 -or ($Out3 -join "`n") -notmatch "PASS") {
    throw "Test 3 Failed: Expected clean pass on commit af80844."
}
Write-Host "  PASS: Clean pass on non-src commit af80844" -ForegroundColor Green

Write-Host "`nAll verify-docs tests PASSED successfully." -ForegroundColor Green
