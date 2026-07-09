<#
.SYNOPSIS
    Install reasonix-code via npm.
.DESCRIPTION
    Requires Node.js >= 22 and npm. Installs the reasonix-code npm package
    globally and ensures the npm global bin directory is on the user PATH.
.PARAMETER Version
    Version to install (e.g. "0.1.0"). Defaults to the latest npm dist-tag.
.PARAMETER Silent
    Suppress non-essential output.
.EXAMPLE
    .\install.ps1
    .\install.ps1 -Version 0.1.0
    .\install.ps1 -Silent
#>

param(
    [string]$Version = "",
    [switch]$Silent
)

$PackageName = "reasonix-code"

function Write-Info($msg) {
    if (-not $Silent) { Write-Host $msg -ForegroundColor Cyan }
}
function Write-Success($msg) {
    if (-not $Silent) { Write-Host $msg -ForegroundColor Green }
}
function Write-Warn($msg) {
    if (-not $Silent) { Write-Host $msg -ForegroundColor Yellow }
}

function Test-NodeAvailable {
    try {
        $nodeOut = (& node --version 2>$null).Trim()
        if ($nodeOut -match 'v?(\d+)') {
            $major = [int]$Matches[1]
            $npmOut = (& npm --version 2>$null).Trim()
            if ($major -ge 22 -and $npmOut) {
                return @{ Ok = $true; NodeVersion = $nodeOut; NpmVersion = $npmOut }
            }
        }
    } catch {}
    return @{ Ok = $false }
}

function Get-NpmGlobalPrefix {
    try {
        $prefix = (& npm config get prefix 2>$null).Trim()
        if ($prefix) { return $prefix }
    } catch {}
    return $null
}

function Get-NpmGlobalBin {
    $prefix = Get-NpmGlobalPrefix
    if (-not $prefix) { return $null }
    # On Windows npm shims live directly in the prefix; on Unix they live in prefix/bin.
    $bin = Join-Path $prefix "bin"
    if (Test-Path $bin) { return $bin }
    return $prefix
}

function Add-ToUserPath($dir) {
    $pathVar = [Environment]::GetEnvironmentVariable("PATH", "User")
    $parts = $pathVar -split ";" | Where-Object { $_ -and ($_ -ne $dir) }
    $newPath = ($parts + $dir) -join ";"
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    $env:PATH = ($env:PATH -split ";" | Where-Object { $_ -ne $dir }) -join ";"
    $env:PATH = "$env:PATH;$dir"
}

function Find-InstalledBinary {
    try {
        $found = (& where.exe reasonix-code 2>$null | Select-Object -First 1).Trim()
        if ($found -and (Test-Path $found)) { return $found }
    } catch {}

    $npmBin = Get-NpmGlobalBin
    if ($npmBin) {
        $candidate = Join-Path $npmBin "reasonix-code.exe"
        if (Test-Path $candidate) { return $candidate }
        $candidateCmd = Join-Path $npmBin "reasonix-code.cmd"
        if (Test-Path $candidateCmd) { return $candidateCmd }
    }
    return $null
}

# ── Validate environment ───────────────────────────────────────────────
$nodeInfo = Test-NodeAvailable
if (-not $nodeInfo.Ok) {
    Write-Error @"
Node.js >= 22 and npm are required to install reasonix-code.
Please install Node.js first: https://nodejs.org/en/download
"@
    exit 1
}
Write-Info "Node.js $($nodeInfo.NodeVersion) / npm $($nodeInfo.NpmVersion) detected."

# ── Resolve version ────────────────────────────────────────────────────
$versionSpec = if ($Version) { "$PackageName@$Version" } else { $PackageName }
Write-Info "Installing $versionSpec via npm..."

# ── Install ────────────────────────────────────────────────────────────
try {
    $proc = Start-Process -FilePath "npm" -ArgumentList "install", "-g", $versionSpec -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        throw "npm install exited with code $($proc.ExitCode)"
    }
} catch {
    Write-Error "npm install failed: $_"
    exit 1
}

# ── Ensure PATH contains npm global bin ────────────────────────────────
$npmBin = Get-NpmGlobalBin
if ($npmBin -and ($env:PATH -split ";" -notcontains $npmBin)) {
    Add-ToUserPath $npmBin
    Write-Success "Added '$npmBin' to user PATH."
}

# ── Verify ─────────────────────────────────────────────────────────────
$binary = Find-InstalledBinary
if (-not $binary) {
    Write-Error "reasonix-code was installed but cannot be found on PATH."
    exit 1
}

try {
    $verify = (& $binary --version 2>$null).Trim()
    if (-not $verify) { throw "empty version output" }
    Write-Success "Verified: $verify"
} catch {
    Write-Error "Installed package does not run correctly: $_"
    exit 1
}

Write-Success "Done! Run 'reasonix-code' in your project directory to get started."
