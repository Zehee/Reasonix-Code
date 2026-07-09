<#
.SYNOPSIS
    Install reasonix-code — the Reasonix-Code CLI binary.
.DESCRIPTION
    Downloads the latest (or specified) release of reasonix-code from GitHub,
    installs as reasonix-code.exe, and adds it to PATH.
    If a local installation already exists, its version is compared with the
    target release and the user is prompted to update (unless -Silent is used).
.PARAMETER Version
    Release tag to download (e.g. "v0.1.0"). Defaults to the latest release.
.PARAMETER InstallDir
    Directory to place the binary. Defaults to "$HOME\.reasonix-code\bin".
.PARAMETER Force
    Overwrite an existing binary without prompting.
.PARAMETER Silent
    Do not prompt and suppress non-essential output. Useful for installers.
.EXAMPLE
    .\install.ps1
    .\install.ps1 -Version v0.1.0
    .\install.ps1 -InstallDir C:\tools -Force
    .\install.ps1 -Silent
#>

param(
    [string]$Version = "",
    [string]$InstallDir = "",
    [switch]$Force,
    [switch]$Silent
)

$RepoOwner = "Zehee"
$RepoName  = "Reasonix-Code"
$ExeName   = "reasonix-code.exe"

# ── Resolve install directory ──────────────────────────────────────────
if (-not $InstallDir) {
    $InstallDir = Join-Path (Join-Path $HOME ".reasonix-code") "bin"
}
$TargetExe = Join-Path $InstallDir $ExeName

function Write-Info($msg) {
    if (-not $Silent) { Write-Host $msg -ForegroundColor Cyan }
}
function Write-Success($msg) {
    if (-not $Silent) { Write-Host $msg -ForegroundColor Green }
}
function Write-Warn($msg) {
    if (-not $Silent) { Write-Host $msg -ForegroundColor Yellow }
}

# ── Resolve target version ─────────────────────────────────────────────
if (-not $Version) {
    Write-Info "Fetching latest release info..."
    $releases = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
    try {
        $latest = Invoke-RestMethod -Uri $releases -UseBasicParsing
        $Version = $latest.tag_name
    } catch {
        Write-Error "Failed to fetch latest release: $_"
        exit 1
    }
}
Write-Info "Target version: $Version"

# ── Check existing installation ────────────────────────────────────────
$installedVersion = $null
if (Test-Path $TargetExe) {
    try {
        $installedVersion = (& $TargetExe --version 2>$null).Trim()
        # Version output may be "reasonix-code 0.1.5" or just "0.1.5"
        if ($installedVersion -match '(\d+\.\d+\.\d+)') {
            $installedVersion = $Matches[1]
        }
    } catch {
        $installedVersion = $null
    }
}

$targetPlain = $Version -replace '^v', ''
if ($installedVersion -and ($installedVersion -eq $targetPlain) -and -not $Force) {
    Write-Success "reasonix-code $installedVersion is already up to date at '$TargetExe'."
    exit 0
}

if ($installedVersion -and -not $Force) {
    if ($Silent) {
        Write-Info "Updating reasonix-code from $installedVersion to $targetPlain..."
    } else {
        $confirm = Read-Host "reasonix-code $installedVersion is installed. Update to $Version? [Y/n]"
        if ($confirm -and $confirm -notmatch '^[yY]$') {
            Write-Warn "Update skipped."
            exit 0
        }
    }
}

# ── Download ───────────────────────────────────────────────────────────
$assetName = "reasonix-code-$Version.exe"
$downloadUrl = "https://github.com/$RepoOwner/$RepoName/releases/download/$Version/$assetName"

$null = New-Item -ItemType Directory -Path $InstallDir -Force

$tmpExe = Join-Path $InstallDir "reasonix-code-$Version.tmp.exe"

try {
    Write-Info "Downloading $assetName ..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tmpExe -UseBasicParsing
} catch {
    Write-Error "Download failed: $_"
    if (Test-Path $tmpExe) { Remove-Item $tmpExe -Force }
    exit 1
}

# ── Atomic replace ─────────────────────────────────────────────────────
try {
    if (Test-Path $TargetExe) {
        Remove-Item $TargetExe -Force
    }
    Rename-Item -Path $tmpExe -NewName $ExeName -Force
} catch {
    Write-Error "Failed to install binary: $_"
    exit 1
}

# ── Verify ─────────────────────────────────────────────────────────────
try {
    $verify = (& $TargetExe --version 2>$null).Trim()
    if (-not $verify) { throw "empty version output" }
    Write-Success "Verified: $verify"
} catch {
    Write-Error "Installed binary does not run correctly: $_"
    exit 1
}

$size = (Get-Item $TargetExe).Length
Write-Success "Installed $ExeName ($([math]::Round($size / 1MB, 1)) MB) to $TargetExe"

# ── Add to PATH ────────────────────────────────────────────────────────
$pathVar = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($pathVar -split ";" -notcontains $InstallDir) {
    $newPath = "$pathVar;$InstallDir"
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    # Also update current session
    $env:PATH = "$env:PATH;$InstallDir"
    Write-Success "Added '$InstallDir' to user PATH."
    if (-not $Silent) {
        Write-Warn "You may need to restart your terminal for the change to take effect."
    }
} else {
    Write-Success "'$InstallDir' is already in your PATH."
}

Write-Success "Done! Run 'reasonix-code' in your project directory to get started."
