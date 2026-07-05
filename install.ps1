<#
.SYNOPSIS
    Install reasonix — the Reasonix-Code CLI binary.
.DESCRIPTION
    Downloads the latest (or specified) release of reasonix-code from GitHub,
    installs as reasonix.exe, and adds it to PATH.
.PARAMETER Version
    Release tag to download (e.g. "v0.1.0"). Defaults to the latest release.
.PARAMETER InstallDir
    Directory to place the binary. Defaults to "$HOME\.reasonix-code\bin".
.PARAMETER Force
    Overwrite an existing binary without prompting.
.EXAMPLE
    .\install.ps1
    .\install.ps1 -Version v0.1.0
    .\install.ps1 -InstallDir C:\tools -Force
#>

param(
    [string]$Version = "",
    [string]$InstallDir = "",
    [switch]$Force
)

$RepoOwner = "Zehee"
$RepoName  = "Reasonix-Code"
$ExeName   = "reasonix.exe"

# ── Resolve install directory ──────────────────────────────────────────
if (-not $InstallDir) {
    $InstallDir = Join-Path (Join-Path $HOME ".reasonix-code") "bin"
}
$TargetExe = Join-Path $InstallDir $ExeName

# ── Resolve version ────────────────────────────────────────────────────
if (-not $Version) {
    Write-Host "Fetching latest release info..." -ForegroundColor Cyan
    $releases = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
    try {
        $latest = Invoke-RestMethod -Uri $releases -UseBasicParsing
        $Version = $latest.tag_name
    } catch {
        Write-Error "Failed to fetch latest release: $_"
        exit 1
    }
}
Write-Host "Downloading $RepoOwner/$RepoName $Version ..." -ForegroundColor Cyan

# ── Build download URL (versioned binary name) ─────────────────────────
$assetName = "reasonix-code-$Version.exe"
$downloadUrl = "https://github.com/$RepoOwner/$RepoName/releases/download/$Version/$assetName"

# ── Download ───────────────────────────────────────────────────────────
$null = New-Item -ItemType Directory -Path $InstallDir -Force

if ((Test-Path $TargetExe) -and -not $Force) {
    $confirm = Read-Host "Binary already exists at '$TargetExe'. Overwrite? [y/N]"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
}

try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $TargetExe -UseBasicParsing
} catch {
    Write-Error "Download failed: $_"
    exit 1
}

# ── Verify ─────────────────────────────────────────────────────────────
if (-not (Test-Path $TargetExe)) {
    Write-Error "Binary not found after download — unexpected."
    exit 1
}

$size = (Get-Item $TargetExe).Length
Write-Host "Downloaded $([math]::Round($size / 1MB, 1)) MB to $TargetExe" -ForegroundColor Green

# ── Add to PATH ────────────────────────────────────────────────────────
$pathVar = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($pathVar -split ";" -notcontains $InstallDir) {
    $newPath = "$pathVar;$InstallDir"
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    # Also update current session
    $env:PATH = "$env:PATH;$InstallDir"
    Write-Host "Added '$InstallDir' to user PATH." -ForegroundColor Green
    Write-Host "You may need to restart your terminal for the change to take effect." -ForegroundColor Yellow
} else {
    Write-Host "'$InstallDir' is already in your PATH." -ForegroundColor Green
}

Write-Host "Done! Run 'reasonix' in your project directory to get started." -ForegroundColor Green
