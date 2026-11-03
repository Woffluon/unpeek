param(
    [Parameter(Mandatory)][string]$ReleaseSha,
    [Parameter(Mandatory)][string]$ReleaseTag,
    [Parameter(Mandatory)][string]$Version,
    [string]$RepoRoot,
    [string]$Repository = $env:GITHUB_REPOSITORY,
    [string]$Token = $env:GH_TOKEN,
    [switch]$NoOutput
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"
$RepoRoot = if ($RepoRoot) { (Resolve-Path $RepoRoot).Path } else { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
if ($ReleaseTag -cne "v$Version" -or $Version -notmatch '^\d+\.\d+\.\d+$') { throw "Release tag and version are inconsistent." }
if ([string]::IsNullOrWhiteSpace($Repository)) { throw "Repository is required." }

$RemoteTag = @(& git -C $RepoRoot ls-remote --tags origin "refs/tags/$ReleaseTag" "refs/tags/$ReleaseTag^{}")
if ($LASTEXITCODE -ne 0) { throw "Failed to query remote tag state for $ReleaseTag." }
$TagExists = $RemoteTag.Count -gt 0
if ($TagExists) {
    & git -C $RepoRoot fetch --force origin "refs/tags/${ReleaseTag}:refs/tags/${ReleaseTag}"
    if ($LASTEXITCODE -ne 0) { throw "Failed to fetch existing tag $ReleaseTag." }
    $TaggedCommit = (& git -C $RepoRoot rev-list -n 1 $ReleaseTag).Trim()
    if ($LASTEXITCODE -ne 0 -or $TaggedCommit -cne $ReleaseSha) {
        throw "Tag $ReleaseTag does not point to release commit $ReleaseSha."
    }
}

$Headers = @{
    Accept = "application/vnd.github+json"
    "User-Agent" = "unpeek-release-workflow"
    "X-GitHub-Api-Version" = "2022-11-28"
}
if (-not [string]::IsNullOrWhiteSpace($Token)) { $Headers.Authorization = "Bearer $Token" }
try {
    $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/tags/$ReleaseTag" -Headers $Headers
} catch {
    $Status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    if ($Status -ne 404) { throw }
    Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository" -Headers $Headers | Out-Null
    if ($TagExists) { throw "Tag $ReleaseTag exists without a published GitHub Release." }
    if (-not $NoOutput -and $env:GITHUB_OUTPUT) { "needed=true" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append }
    return
}

if (-not $TagExists) { throw "Release $ReleaseTag exists without a matching remote tag." }
if ($Release.tag_name -cne $ReleaseTag -or $Release.draft -or $Release.prerelease -or [string]::IsNullOrWhiteSpace($Release.published_at)) {
    throw "Existing release must be published, non-draft, and non-prerelease."
}
$ReleaseTarget = (& git -C $RepoRoot rev-parse "$($Release.target_commitish)^{commit}" 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $ReleaseTarget -cne $ReleaseSha) { throw "Existing release target does not match $ReleaseSha." }

$VersionedTarball = "unpeek-v$Version.tgz"
$VersionedChecksums = "unpeek-v$Version-SHA256SUMS.txt"
$Required = @($VersionedTarball, $VersionedChecksums)

$Assets = @($Release.assets)
$Names = @($Assets | ForEach-Object { $_.name })
$Missing = @($Required | Where-Object { $_ -notin $Names })
if ($Missing.Count -gt 0) { throw "Existing immutable release is incomplete: $($Missing -join ', ')" }
$Unexpected = @($Names | Where-Object { $_ -notin $Required })
if ($Unexpected.Count -gt 0) { throw "Existing immutable release contains unexpected assets: $($Unexpected -join ', ')" }

$BytesByName = @{}
$HashByName = @{}
Add-Type -AssemblyName System.Net.Http
$Client = [Net.Http.HttpClient]::new()
try {
    if (-not [string]::IsNullOrWhiteSpace($Token)) {
        $Client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Token)
    }
    $Client.DefaultRequestHeaders.UserAgent.ParseAdd("unpeek-release-workflow")
    foreach ($Name in $Required) {
        $Asset = @($Assets | Where-Object name -ceq $Name)
        if ($Asset.Count -ne 1) { throw "Release asset name must be unique: $Name" }
        if ($Asset[0].size -le 0) {
            throw "Release asset lacks required non-zero size: $Name"
        }
        $Request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, $Asset[0].url)
        $Request.Headers.Accept.ParseAdd("application/octet-stream")
        try {
            $Response = $Client.SendAsync($Request).GetAwaiter().GetResult()
            try {
                if (-not $Response.IsSuccessStatusCode) { throw "Asset download failed for $Name with HTTP $([int]$Response.StatusCode)." }
                $Bytes = $Response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
            } finally { $Response.Dispose() }
        } finally { $Request.Dispose() }
        if ($Bytes.Length -ne $Asset[0].size) { throw "Downloaded asset size differs from GitHub metadata: $Name" }
        $Hasher = [Security.Cryptography.SHA256]::Create()
        try { $Hash = ([BitConverter]::ToString($Hasher.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant() } finally { $Hasher.Dispose() }
        $BytesByName[$Name] = $Bytes
        $HashByName[$Name] = $Hash
    }
} finally { $Client.Dispose() }

function Read-ChecksumMap([byte[]]$Bytes, [string]$Name) {
    $Map = @{}
    foreach ($Line in ([Text.Encoding]::UTF8.GetString($Bytes) -split '\r?\n' | Where-Object { $_ })) {
        if ($Line -notmatch '^(?<hash>[a-f0-9]{64})  (?<file>[^\\/]+)$') { throw "Invalid checksum line in ${Name}: $Line" }
        if ($Map.ContainsKey($Matches.file)) { throw "Duplicate checksum entry in ${Name}: $($Matches.file)" }
        $Map[$Matches.file] = $Matches.hash
    }
    return $Map
}

$VersionedMap = Read-ChecksumMap $BytesByName[$VersionedChecksums] $VersionedChecksums
if (-not $VersionedMap.ContainsKey($VersionedTarball) -or $VersionedMap[$VersionedTarball] -cne $HashByName[$VersionedTarball]) {
    throw "Versioned checksum manifest does not match release tarball."
}

if (-not $NoOutput -and $env:GITHUB_OUTPUT) { "needed=false" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append }
Write-Host "Existing release integrity validated: $ReleaseTag" -ForegroundColor Green
