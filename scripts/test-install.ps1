# Tests scripts/install.ps1 against a folder of release files: the Windows
# archive and its SHA256SUMS. A good install must succeed and print the PATH
# hint, and a bad checksum must stop the install.
#
# Usage: pwsh scripts/test-install.ps1 <release folder>
#
# The script ends with an explicit exit code. The bad-checksum run leaves
# $LASTEXITCODE at 1 on purpose, and GitHub's pwsh shell exits with
# $LASTEXITCODE at the end of a step.
param([Parameter(Mandatory)] [string] $Release)

$ErrorActionPreference = 'Stop'

$release = (Resolve-Path -LiteralPath $Release).Path
$installer = Join-Path $PSScriptRoot 'install.ps1'
$work = Join-Path ([System.IO.Path]::GetTempPath()) "axonometric-test-$([System.Guid]::NewGuid())"
$server = $null

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

try {
  # Serve a good copy of the release and one with a bad checksum over HTTP,
  # the way the installer downloads from GitHub.
  $good = Join-Path $work 'served\good'
  $tampered = Join-Path $work 'served\tampered'
  New-Item -ItemType Directory -Path $good, $tampered | Out-Null
  Copy-Item -Path (Join-Path $release '*.zip'), (Join-Path $release 'SHA256SUMS') -Destination $good
  Copy-Item -Path (Join-Path $release '*.zip') -Destination $tampered
  (Get-Content -LiteralPath (Join-Path $release 'SHA256SUMS')) -replace '^[0-9a-f]{64}', ('0' * 64) |
    Set-Content -LiteralPath (Join-Path $tampered 'SHA256SUMS')

  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()

  # On Windows, `python3` can be the Microsoft Store stub, so try `python` first.
  $python = if (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { 'python3' }
  $server = Start-Process $python -ArgumentList '-m', 'http.server', $port, '--bind', '127.0.0.1', '--directory', (Join-Path $work 'served') -PassThru
  $url = "http://127.0.0.1:$port"

  $ready = $false
  for ($i = 0; $i -lt 50 -and -not $ready; $i++) {
    try {
      Invoke-WebRequest -Uri "$url/good/SHA256SUMS" -UseBasicParsing | Out-Null
      $ready = $true
    } catch {
      Start-Sleep -Milliseconds 200
    }
  }
  if (-not $ready) { throw "the test server didn't start." }

  Write-Host 'A good install'
  $result = Invoke-Installer "$url/good" (Join-Path $work 'bin')
  if ($result.Code -ne 0) { throw 'the good install failed.' }
  & (Join-Path $work 'bin\axonometric.exe') --version
  if ($LASTEXITCODE -ne 0) { throw "the installed binary didn't run." }
  if ($result.Output -notmatch "isn't on your PATH") { throw 'the installer printed no PATH hint.' }

  Write-Host 'A bad checksum'
  $result = Invoke-Installer "$url/tampered" (Join-Path $work 'tampered-bin')
  if ($result.Code -eq 0) { throw 'the installer accepted a bad checksum.' }
  if (Test-Path -LiteralPath (Join-Path $work 'tampered-bin\axonometric.exe')) {
    throw 'the installer wrote the binary despite the bad checksum.'
  }

  Write-Host 'The installer passed.'
  $exitCode = 0
} catch {
  Write-Host "test-install.ps1: $($_.Exception.Message)"
  $exitCode = 1
} finally {
  if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

exit $exitCode
