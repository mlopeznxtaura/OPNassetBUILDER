# OPNassetBUILDER — Cloudflare R2 + Wrangler (run in PowerShell)
# Right-click → Run with PowerShell, or:  cd gameforgev1\scripts  ;  .\setup-r2.ps1

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Write-Host ""
Write-Host "=== Step 1: Stop the broken API token from hijacking Wrangler ===" -ForegroundColor Cyan
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:CLOUDFLARE_API_KEY -ErrorAction SilentlyContinue

$userTok = [Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "User")
$machineTok = [Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "Machine")
if ($userTok -or $machineTok) {
  Write-Host "WARNING: CLOUDFLARE_API_TOKEN is saved in Windows Environment Variables." -ForegroundColor Yellow
  Write-Host "  Open: Settings -> System -> About -> Advanced system settings -> Environment Variables"
  Write-Host "  Delete CLOUDFLARE_API_TOKEN under User variables (and Machine if present)."
  Write-Host "  Then close ALL terminals and run this script again."
  Write-Host ""
}

Write-Host "=== Step 2: Log in to Cloudflare (browser will open — click Allow) ===" -ForegroundColor Cyan
Set-Location $Root
npx wrangler login
npx wrangler whoami

Write-Host ""
Write-Host "=== Step 3: Enable R2 in the browser (one-time, ~30 seconds) ===" -ForegroundColor Cyan
Write-Host "  A tab will open. On that page:"
Write-Host "    1) Pick account: Mlopez@nextaura.fit"
Write-Host "    2) Click 'Purchase R2' or 'Enable R2' or 'Get started' (free tier is OK)"
Write-Host "    3) Accept terms / add payment method if Cloudflare asks (often required even for free)"
Write-Host "  When the R2 overview shows (even empty), come back here and press ENTER."
Start-Process "https://dash.cloudflare.com/683f127c03af82423467b6fad679252c/r2/overview"
Read-Host "Press ENTER after R2 is enabled in the dashboard"

Write-Host ""
Write-Host "=== Step 4: Create buckets ===" -ForegroundColor Cyan
npx wrangler r2 bucket create opnassetbuilder-blobs
npx wrangler r2 bucket create opnassetbuilder-blobs-preview

Write-Host ""
Write-Host "=== Step 5: Turn on R2 in wrangler.toml ===" -ForegroundColor Cyan
$toml = Join-Path $Root "wrangler.toml"
$content = Get-Content $toml -Raw
if ($content -match '# \[\[r2_buckets\]\]') {
  $content = $content -replace '# \[\[r2_buckets\]\]', '[[r2_buckets]]'
  $content = $content -replace '# binding = "BLOBS"', 'binding = "BLOBS"'
  $content = $content -replace '# bucket_name = "opnassetbuilder-blobs"', 'bucket_name = "opnassetbuilder-blobs"'
  $content = $content -replace '# preview_bucket_name = "opnassetbuilder-blobs-preview"', 'preview_bucket_name = "opnassetbuilder-blobs-preview"'
  Set-Content -Path $toml -Value $content -NoNewline
  Write-Host "Uncommented [[r2_buckets]] in wrangler.toml"
}

Write-Host ""
Write-Host "=== Step 6: Deploy app14 ===" -ForegroundColor Cyan
npm run deploy

Write-Host ""
Write-Host "Done. Test: https://app14.nextaura.us/design/" -ForegroundColor Green
