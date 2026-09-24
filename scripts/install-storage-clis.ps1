# Install CLIs for free-tier blob backends (no payment). Idempotent via winget + npm.
# Run in PowerShell:  npm run setup:clis

$ErrorActionPreference = "Continue"

function Try-Winget($id, $label) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host ">> winget install $label ($id)" -ForegroundColor Cyan
    winget install --id $id -e --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
  } else {
    Write-Host "  winget missing — install $label manually: $id" -ForegroundColor Yellow
  }
}

Write-Host "=== Storage CLIs (free tier signup still needs your browser once) ===" -ForegroundColor Green

Try-Winget "Supabase.CLI" "Supabase CLI"
Try-Winget "Vercel.CLI" "Vercel CLI"
Try-Winget "Amazon.AWSCLI" "AWS CLI"
Try-Winget "MongoDB.MongoDBAtlasCLI" "MongoDB Atlas CLI"
# Oracle: winget id varies; OCI CLI optional
Try-Winget "Oracle.OCI.CLI" "Oracle OCI CLI"

Write-Host ">> npm wrangler (repo devDependency)" -ForegroundColor Cyan
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root
npm install

Write-Host ""
Write-Host "Next (interactive terminal — not Cursor agent shell):" -ForegroundColor Green
Write-Host "  npm run setup:storage:oauth     # browser OAuth per provider"
Write-Host "  npm run setup:sync-secrets      # push keys to Worker from CLIs / .secrets.local"
