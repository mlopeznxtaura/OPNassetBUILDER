# Local prompt for TYPESAFE_API_KEY. Writes .secrets.local. Never prints the key.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'package.json'))) { $root = $PSScriptRoot }
$dest = Join-Path $root '.secrets.local'

Add-Type -AssemblyName Microsoft.VisualBasic
$key = [Microsoft.VisualBasic.Interaction]::InputBox(
  "Paste your TypeSafe free-tier API key. It is saved to .secrets.local and is not printed.",
  "TYPESAFE_API_KEY"
)
if ([string]::IsNullOrWhiteSpace($key)) {
  Write-Host "No key entered."
  exit 2
}
$key = $key.Trim()
$lines = @()
if (Test-Path $dest) {
  $lines = Get-Content $dest | Where-Object { $_ -notmatch '^\s*TYPESAFE_API_KEY\s*=' }
}
$lines += "TYPESAFE_API_KEY=$key"
Set-Content -Path $dest -Value ($lines -join "`n") -Encoding utf8
Write-Host "Saved TYPESAFE_API_KEY to .secrets.local (length $($key.Length))."
