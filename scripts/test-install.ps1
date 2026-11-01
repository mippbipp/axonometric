# Tests scripts/install.ps1 against a folder of release files: the Windows
# archive and its SHA256SUMS. A good install must succeed and print the PATH
# hint, and a bad checksum must stop the install.
#
# Usage: pwsh scripts/test-install.ps1 <release folder>
param([Parameter(Mandatory)] [string] $Release)

$ErrorActionPreference = 'Stop'

$release = (Resolve-Path -LiteralPath $Release).Path
$installer = Join-Path $PSScriptRoot 'install.ps1'
$work = Join-Path ([System.IO.Path]::GetTempPath()) "axonometric-test-$([System.Guid]::NewGuid())"
New-Item -ItemType Directory -Path $work | Out-Null

# Runs the installer in a new PowerShell, the way `irm | iex` would, and
# returns its exit code and output.
function Invoke-Installer([string] $downloadUrl, [string] $installDir) {
  $env:AXONOMETRIC_DOWNLOAD_URL = $downloadUrl
  $env:AXONOMETRIC_INSTALL_DIR = $installDir
  $output = & pwsh -NoProfile -File $installer 2>&1 | Out-String
  $code = $LASTEXITCODE
  Write-Host $output
  return @{ Code = $code; Output = $output }
}

# Serve the release over HTTP, the way the installer downloads from GitHub.
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()

# On Windows, `python3` can be the Microsoft Store stub, so try `python` first.
$python = if (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { 'python3' }
$server = Start-Process $python -ArgumentList '-m', 'http.server', $port, '--bind', '127.0.0.1', '--directory', $release -PassThru

try {
  $ready = $false
  for ($i = 0; $i -lt 50 -and -not $ready; $i++) {
    try {
      Invoke-WebRequest -Uri "http://127.0.0.1:$port/SHA256SUMS" -UseBasicParsing | Out-Null
      $ready = $true
    } catch {
      Start-Sleep -Milliseconds 200
    }
  }
  if (-not $ready) { throw "The test server didn't start." }

  Write-Host 'A good install'
  $good = Invoke-Installer "http://127.0.0.1:$port" (Join-Path $work 'bin')
  if ($good.Code -ne 0) { throw 'The installer failed.' }
  & (Join-Path $work 'bin\axonometric.exe') --version
  if ($LASTEXITCODE -ne 0) { throw 'The installed binary failed.' }
  if ($good.Output -notmatch "isn't on your PATH") { throw 'The installer printed no PATH hint.' }

  Write-Host 'A bad checksum'
  $tampered = Join-Path $work 'tampered'
  New-Item -ItemType Directory -Path $tampered | Out-Null
  Copy-Item -Path (Join-Path $release '*.zip') -Destination $tampered
  (Get-Content -LiteralPath (Join-Path $release 'SHA256SUMS')) -replace '^[0-9a-f]{64}', ('0' * 64) |
    Set-Content -LiteralPath (Join-Path $tampered 'SHA256SUMS')

  $bad = Invoke-Installer $tampered (Join-Path $work 'tampered-bin')
  if ($bad.Code -eq 0) { throw 'The installer accepted a bad checksum.' }
  if (Test-Path -LiteralPath (Join-Path $work 'tampered-bin\axonometric.exe')) {
    throw 'The installer wrote the binary despite the bad checksum.'
  }

  Write-Host 'The installer passed.'
} finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
