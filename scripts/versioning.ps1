Set-StrictMode -Version 3.0

function Get-ProductVersionFromJson {
    param([Parameter(Mandatory)][string]$Content)

    $Match = [regex]::Match(
        $Content,
        '(?m)^\s*"version"\s*:\s*"(?<version>\d+\.\d+\.\d+)"'
    )
    if (-not $Match.Success) {
        throw '"version" field was not found in package.json'
    }

    return $Match.Groups["version"].Value
}

function Set-ProductVersionInJson {
    param(
        [Parameter(Mandatory)][string]$Content,
        [Parameter(Mandatory)][string]$Version
    )

    $Pattern = '(?m)^(\s*"version"\s*:\s*")\d+\.\d+\.\d+(")'
    $Updated = [regex]::Replace($Content, $Pattern, "`${1}$Version`${2}", 1)
    if ($Updated -eq $Content -and (Get-ProductVersionFromJson $Content) -ne $Version) {
        throw "Failed to update version in package.json"
    }
    return $Updated
}

function Get-CliVersionFromTs {
    param([Parameter(Mandatory)][string]$Content)

    $Match = [regex]::Match(
        $Content,
        "(?m)^const\s+VERSION\s*=\s*'(?<version>\d+\.\d+\.\d+)';"
    )
    if (-not $Match.Success) {
        throw "const VERSION was not found in packages/unpeek/src/cli/index.ts"
    }

    return $Match.Groups["version"].Value
}

function Set-CliVersionInTs {
    param(
        [Parameter(Mandatory)][string]$Content,
        [Parameter(Mandatory)][string]$Version
    )

    $Pattern = "(?m)^(const\s+VERSION\s*=\s*')\d+\.\d+\.\d+(';)"
    $Updated = [regex]::Replace($Content, $Pattern, "`${1}$Version`${2}", 1)
    if ($Updated -eq $Content -and (Get-CliVersionFromTs $Content) -ne $Version) {
        throw "Failed to update const VERSION in packages/unpeek/src/cli/index.ts"
    }
    return $Updated
}

function Get-WebVersionsFromI18n {
    param([Parameter(Mandatory)][string]$Content)

    $MatchesList = [regex]::Matches(
        $Content,
        '\bversion:\s*"v(?<version>\d+\.\d+\.\d+)"'
    )
    if ($MatchesList.Count -lt 2) {
        throw "Expected at least 2 locale version entries in apps/web/src/content/i18n.ts"
    }

    return @($MatchesList | ForEach-Object { $_.Groups["version"].Value })
}

function Set-WebVersionsInI18n {
    param(
        [Parameter(Mandatory)][string]$Content,
        [Parameter(Mandatory)][string]$Version
    )

    $Pattern = '(\bversion:\s*"v)\d+\.\d+\.\d+(")'
    $Updated = [regex]::Replace($Content, $Pattern, "`${1}$Version`${2}")
    $Current = @(Get-WebVersionsFromI18n $Updated)
    if (@($Current | Where-Object { $_ -cne $Version }).Count -gt 0) {
        throw "Failed to update version entries in apps/web/src/content/i18n.ts"
    }
    return $Updated
}

function Get-VersionBump {
    param([Parameter(Mandatory)][string]$Message)

    $Header = ($Message -split '\r?\n', 2)[0]
    $Match = [regex]::Match(
        $Header,
        '^(?<type>feat|fix|perf|refactor|build|security|docs|ci|test|chore)(?:\((?<scope>[a-z0-9][a-z0-9._/-]*)\))?(?<breaking>!)?: (?<description>\S.*)$'
    )
    if (-not $Match.Success) {
        throw "Invalid Conventional Commit message: '$Header'"
    }

    if ($Match.Groups["breaking"].Success -or $Message -match '(?m)^BREAKING CHANGE:\s+\S') {
        return "major"
    }

    $Type = $Match.Groups["type"].Value
    $Scope = if ($Match.Groups["scope"].Success) { $Match.Groups["scope"].Value } else { "" }

    if ($Scope -in "deps", "deps-dev" -and $Type -in "build", "chore") {
        return "none"
    }

    switch ($Type) {
        "feat" { return "minor" }
        { $_ -in "fix", "perf", "refactor", "build", "security" } { return "patch" }
        default { return "none" }
    }
}

function Get-NextProductVersion {
    param(
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][ValidateSet("major", "minor", "patch", "none")][string]$Bump
    )

    if ($Version -notmatch '^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$') {
        throw "Unsupported product version: '$Version'"
    }

    $Major = [int]$Matches["major"]
    $Minor = [int]$Matches["minor"]
    $Patch = [int]$Matches["patch"]
    switch ($Bump) {
        "major" { return "$($Major + 1).0.0" }
        "minor" { return "$Major.$($Minor + 1).0" }
        "patch" { return "$Major.$Minor.$($Patch + 1)" }
        default { return $Version }
    }
}

function Assert-ReleaseBaseContract {
    param(
        [Parameter(Mandatory)][string]$Tag,
        [Parameter(Mandatory)][bool]$HasVersionContract
    )

    if (-not $HasVersionContract -and $Tag -cne "v1.0.0") {
        throw "Only the v1.0.0 release may predate the product-version contract."
    }
}

function Get-LatestReleaseSelection {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Candidates,
        [Parameter(Mandatory)][string]$TargetSha
    )

    if ($Candidates.Count -eq 0) { return }
    $Latest = $Candidates[-1]
    return [pscustomobject]@{
        sha = $TargetSha
        version = $Latest.version
        tag = $Latest.tag
    }
}

function Get-ValidatedVersionHistory {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$TargetSha
    )

    $Target = (& git -C $RepoRoot rev-parse "$TargetSha^{commit}" 2>$null).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Cannot resolve version-history target '$TargetSha'." }

    $Commits = @(& git -C $RepoRoot rev-list --reverse --first-parent $Target)
    if ($LASTEXITCODE -ne 0) { throw "Cannot read first-parent history for '$Target'." }
    $ContractStart = $Commits | Where-Object {
        $Path = @(& git -C $RepoRoot ls-tree -r --name-only $_ -- scripts/versioning.ps1)
        $LASTEXITCODE -eq 0 -and $Path -contains "scripts/versioning.ps1"
    } | Select-Object -First 1
    if (-not $ContractStart) { return }

    $SeenVersions = @{}
    $ParentLine = (& git -C $RepoRoot rev-list --parents -n 1 $ContractStart).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect parents for '$ContractStart'." }
    $ParentTokens = @($ParentLine -split '\s+' | Where-Object { $_ })
    $HasParent = ($ParentTokens.Count -gt 1)

    if ($HasParent) {
        $ContractCommits = @(& git -C $RepoRoot rev-list --reverse --first-parent "$ContractStart^..$Target")
        if ($LASTEXITCODE -ne 0) { throw "Cannot read version-contract history through '$Target'." }
    } else {
        $RootJson = (& git -C $RepoRoot show "${ContractStart}:package.json") -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "Cannot read package.json at $ContractStart." }
        $RootVersion = Get-ProductVersionFromJson $RootJson
        $RootMessage = (& git -C $RepoRoot show -s --format=%B $ContractStart) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "Cannot read commit message at $ContractStart." }
        $RootBump = Get-VersionBump $RootMessage
        if ($RootBump -ne "none") {
            $SeenVersions[$RootVersion] = $true
        }
        [pscustomobject]@{
            sha = $ContractStart
            version = $RootVersion
            tag = "v$RootVersion"
            bump = $RootBump
        }
        $ContractCommits = @(& git -C $RepoRoot rev-list --reverse --first-parent "$ContractStart..$Target")
        if ($LASTEXITCODE -ne 0) { throw "Cannot read version-contract history through '$Target'." }
    }

    foreach ($Commit in $ContractCommits) {
        $Parent = (& git -C $RepoRoot rev-parse "$Commit^" 2>$null).Trim()
        if ($LASTEXITCODE -ne 0) { throw "Version-contract commit $Commit has no parent." }
        $CurrentJson = (& git -C $RepoRoot show "${Commit}:package.json") -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "Cannot read package.json at $Commit." }
        $ParentJson = (& git -C $RepoRoot show "${Parent}:package.json") -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "Cannot read package.json at parent $Parent." }
        $CurrentVersion = Get-ProductVersionFromJson $CurrentJson
        $ParentVersion = Get-ProductVersionFromJson $ParentJson
        $Message = (& git -C $RepoRoot show -s --format=%B $Commit) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "Cannot read commit message at $Commit." }
        $Bump = Get-VersionBump $Message
        $ExpectedVersion = Get-NextProductVersion -Version $ParentVersion -Bump $Bump
        if ($CurrentVersion -ne $ExpectedVersion) {
            throw "Commit $Commit requires product version $ExpectedVersion ($Bump), but contains $CurrentVersion."
        }
        if ($Bump -ne "none") {
            if ($SeenVersions.ContainsKey($CurrentVersion)) {
                throw "Product version is reused in version-contract history: $CurrentVersion"
            }
            $SeenVersions[$CurrentVersion] = $true
        }
        [pscustomobject]@{
            sha = $Commit
            version = $CurrentVersion
            tag = "v$CurrentVersion"
            bump = $Bump
        }
    }
}
