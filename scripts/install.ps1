# Installs the axonometric binary from a GitHub Release.
#
#   irm https://github.com/mippbipp/axonometric/releases/latest/download/install.ps1 | iex
#
# Settings, all optional:
#   AXONOMETRIC_VERSION       a release such as 0.1.0. Defaults to the latest.
#   AXONOMETRIC_INSTALL_DIR   where the binary goes. Defaults to
#                             %LOCALAPPDATA%\Programs\axonometric.
#   AXONOMETRIC_DOWNLOAD_URL  a URL or folder holding the release files, used
#                             instead of GitHub. CI tests the script this way.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = 'mippbipp/axonometric'

function Fail([string] $message) {
  # Throwing, not exiting, so a failed `irm | iex` doesn't close the window.
  throw "axonometric install: $message"
}

# Copies $source (a URL, or a path when AXONOMETRIC_DOWNLOAD_URL is a folder)
# to $destination.
function Get-ReleaseFile([string] $source, [string] $destination) {
  try {
    if ($source -match '^(https?|file)://') {
      Invoke-WebRequest -Uri $source -OutFile $destination -UseBasicParsing
    } else {
      Copy-Item -LiteralPath $source -Destination $destination
    }
  } catch {
    Fail "could not download ${source}: $($_.Exception.Message)"
  }
}

$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }

# Windows on Arm runs the x64 binary through emulation.
if ($arch -ne 'AMD64' -and $arch -ne 'ARM64') {
  Fail "there's no binary for the $arch architecture."
}

$asset = 'axonometric-windows-x64.zip'

if ($env:AXONOMETRIC_DOWNLOAD_URL) {
  $base = $env:AXONOMETRIC_DOWNLOAD_URL.TrimEnd('/', '\')
} elseif ($env:AXONOMETRIC_VERSION) {
  $base = "https://github.com/$repo/releases/download/v$($env:AXONOMETRIC_VERSION.TrimStart('v'))"
} else {
  $base = "https://github.com/$repo/releases/latest/download"
}

$installDir = if ($env:AXONOMETRIC_INSTALL_DIR) {
  $env:AXONOMETRIC_INSTALL_DIR
} else {
  Join-Path $env:LOCALAPPDATA 'Programs\axonometric'
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) "axonometric-$([System.Guid]::NewGuid())"
New-Item -ItemType Directory -Path $work | Out-Null

try {
  $separator = if ($base -match '^(https?|file)://') { '/' } else { '\' }

  Write-Host "Downloading $asset from $base"
  Get-ReleaseFile "$base$separator$asset" (Join-Path $work $asset)
  Get-ReleaseFile "$base${separator}SHA256SUMS" (Join-Path $work 'SHA256SUMS')

  $expected = $null
  foreach ($line in Get-Content -LiteralPath (Join-Path $work 'SHA256SUMS')) {
    $fields = $line -split '\s+', 2
    if ($fields.Count -eq 2 -and $fields[1].TrimStart('*') -eq $asset) {
      $expected = $fields[0].ToLowerInvariant()
    }
  }

  if (-not $expected) {
    Fail "SHA256SUMS has no line for $asset."
  }

  $actual = (Get-FileHash -LiteralPath (Join-Path $work $asset) -Algorithm SHA256).Hash.ToLowerInvariant()

  if ($actual -ne $expected) {
    Fail "the checksum of $asset is $actual, but SHA256SUMS says $expected. Nothing was installed."
  }

  # ZipFile works in Windows PowerShell 5.1 and in PowerShell 7, with or
  # without the Archive module.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $work $asset), (Join-Path $work 'unpacked'))

  $binary = Join-Path $installDir 'axonometric.exe'
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $work 'unpacked\axonometric.exe') -Destination $binary -Force

  Write-Host "Installed $(& $binary --version) to $binary"

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $onPath = @(($userPath, $env:Path) -join ';' -split ';' | ForEach-Object { $_.TrimEnd('\') }) -contains $installDir.TrimEnd('\')

  if (-not $onPath) {
    Write-Host ''
    Write-Host "$installDir isn't on your PATH. To add it for your user, run this, then open a new terminal:"
    Write-Host ''
    Write-Host "  [Environment]::SetEnvironmentVariable('Path', `"$installDir;`$([Environment]::GetEnvironmentVariable('Path', 'User'))`", 'User')"
  }
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
