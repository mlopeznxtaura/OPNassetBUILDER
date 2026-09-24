# Blob-tier OAuth (Supabase, Mongo, Vercel, Oracle, AWS) — Cloudflare Wrangler LAST / optional
#   .\scripts\setup-storage-oauth.ps1              # provider OAuth browsers + wrangler secrets
#   .\scripts\setup-storage-oauth.ps1 -OAuthOnly   # only provider logins (no wrangler, no secrets)
#   .\scripts\setup-storage-oauth.ps1 -SecretsOnly # paste secrets (assumes OAuth already done)
#   -Deploy  npm run deploy after secrets

param(
  [switch]$OAuthOnly,
  [switch]$SecretsOnly,
  [switch]$IncludeCloudflare,
  [switch]$Deploy
)

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

function Write-Step($n, $title) {
  Write-Host ""
  Write-Host "========== $n: $title ==========" -ForegroundColor Cyan
}

function Invoke-Browser($url, $hint) {
  Write-Host $hint
  Start-Process $url
}

function Run-OAuthCli($label, [scriptblock]$Login) {
  Write-Host ">>> $label — complete login in the browser, then return here." -ForegroundColor Yellow
  & $Login
  if ($LASTEXITCODE -ne 0) {
    Write-Host "    ($label exited $LASTEXITCODE — use the dashboard tab if CLI failed.)" -ForegroundColor DarkYellow
  }
}

function Put-WranglerSecret($name) {
  $v = Read-Host "  $name (Enter = skip)"
  if ([string]::IsNullOrWhiteSpace($v)) { return }
  $v | npx wrangler secret put $name
  if ($LASTEXITCODE -ne 0) { throw "wrangler secret put $name failed" }
  Write-Host "  -> set $name" -ForegroundColor Green
}

function Clear-CfTokenHijack {
  Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:CLOUDFLARE_API_KEY -ErrorAction SilentlyContinue
}

if (-not $SecretsOnly) {
  Write-Host ""
  Write-Host "STORAGE OAUTH — free tiers first (not Cloudflare unless you pass -IncludeCloudflare)" -ForegroundColor Green
  Write-Host ""

  Write-Step "1/5" "Supabase (GitHub OAuth)"
  Invoke-Browser "https://supabase.com/dashboard" "Dashboard: New project if needed. Storage -> bucket opn-meshes (private OK)."
  if (Get-Command supabase -ErrorAction SilentlyContinue) {
    Run-OAuthCli "Supabase CLI" { supabase login }
  } else {
    Run-OAuthCli "Supabase CLI" { npx --yes supabase@latest login }
  }
  Read-Host "ENTER when Supabase project exists"

  Write-Step "2/5" "MongoDB Atlas (Google / GitHub / email OAuth)"
  Invoke-Browser "https://account.mongodb.com/account/login" "Create free M0 cluster. Optional: Data API for Worker."
  if (Get-Command atlas -ErrorAction SilentlyContinue) {
    Run-OAuthCli "Atlas CLI" { atlas auth login }
  } else {
    Write-Host "    Install Atlas CLI for OAuth: winget install MongoDB.AtlasCLI"
    Write-Host "    Or finish signup in the browser only."
    Invoke-Browser "https://www.mongodb.com/docs/atlas/cli/stable/install-atlas-cli/" "Install guide"
  }
  Read-Host "ENTER when Atlas is ready"

  Write-Step "3/5" "Vercel Blob (GitHub OAuth)"
  Invoke-Browser "https://vercel.com/login" "Log in. Storage -> Blob store on Hobby if you use this tier."
  if (Get-Command vercel -ErrorAction SilentlyContinue) {
    Run-OAuthCli "Vercel CLI" { vercel login }
  } else {
    Run-OAuthCli "Vercel CLI" { npx --yes vercel@latest login }
  }
  Invoke-Browser "https://vercel.com/dashboard/stores" "Create Blob store -> copy BLOB_READ_WRITE_TOKEN for secrets step."
  Read-Host "ENTER when Vercel Blob token is copied (or skip tier)"

  Write-Step "4/5" "Oracle Cloud Always Free (account OAuth in browser)"
  Invoke-Browser "https://signup.cloud.oracle.com/" "Sign up / sign in. Object Storage -> bucket in home region."
  Invoke-Browser "https://cloud.oracle.com/identity/domains/my-profile/auth-tokens" "Customer secret keys (S3-compatible API)."
  if (Get-Command oci -ErrorAction SilentlyContinue) {
    Write-Host ">>> OCI CLI — browser session auth"
    Run-OAuthCli "OCI CLI" { oci session authenticate --region us-phoenix-1 }
  }
  Read-Host "ENTER when OCI bucket + S3 keys exist (or skip)"

  Write-Step "5/5" "AWS (console OAuth / IAM)"
  Invoke-Browser "https://signin.aws.amazon.com/" "Sign in. S3 bucket + IAM user access key (PutObject/GetObject)."
  if (Get-Command aws -ErrorAction SilentlyContinue) {
    Write-Host "    If you use IAM Identity Center: aws configure sso  then  aws sso login"
    $trySso = Read-Host "Run aws sso login now? (y/N)"
    if ($trySso -match '^[Yy]') { Run-OAuthCli "AWS SSO" { aws sso login } }
  }
  Read-Host "ENTER when AWS keys exist (or skip)"

  if ($IncludeCloudflare) {
    Write-Step "CF" "Cloudflare Wrangler + R2 (LAST tier — optional card)"
    Clear-CfTokenHijack
    Run-OAuthCli "Wrangler" { npx wrangler login }
    npx wrangler whoami
    $doR2 = Read-Host "Open R2 dashboard? (y/N)"
    if ($doR2 -match '^[Yy]') {
      Invoke-Browser "https://dash.cloudflare.com/?to=/:account/r2/overview" "Enable R2 / buckets opnassetbuilder-blobs"
    }
  } else {
    Write-Host ""
    Write-Host "Skipped Cloudflare OAuth (R2 is last in tier order). Add -IncludeCloudflare to run wrangler login." -ForegroundColor DarkGray
  }

  if ($OAuthOnly) {
    Write-Host ""
    Write-Host "OAuth-only done. Push keys to Worker:" -ForegroundColor Green
    Write-Host "  .\scripts\setup-storage-oauth.ps1 -SecretsOnly"
    exit 0
  }
}

if ($OAuthOnly) { exit 0 }

Write-Step "secrets" "Wrangler secrets (needs wrangler auth once — use -IncludeCloudflare on OAuth pass)"
Clear-CfTokenHijack
$who = npx wrangler whoami 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "Not logged into Wrangler. Run: .\scripts\setup-storage-oauth.ps1 -IncludeCloudflare" -ForegroundColor Yellow
  Write-Host "Or: npx wrangler login"
} else {
  Write-Host $who
}

Write-Host "Paste from each dashboard. Enter skips."
Write-Host "--- Supabase ---"
Put-WranglerSecret "SUPABASE_URL"
Put-WranglerSecret "SUPABASE_SERVICE_ROLE_KEY"
$sbBucket = Read-Host "  SUPABASE_BUCKET (default opn-meshes, Enter = skip)"
if (-not [string]::IsNullOrWhiteSpace($sbBucket)) { $sbBucket | npx wrangler secret put SUPABASE_BUCKET }

Write-Host "--- MongoDB Data API (optional) ---"
Put-WranglerSecret "MONGODB_DATA_API_URL"
Put-WranglerSecret "MONGODB_DATA_API_KEY"

Write-Host "--- Vercel Blob ---"
Put-WranglerSecret "BLOB_READ_WRITE_TOKEN"

Write-Host "--- Oracle S3-compatible ---"
Put-WranglerSecret "OCI_S3_ENDPOINT"
Put-WranglerSecret "OCI_S3_BUCKET"
Put-WranglerSecret "OCI_S3_ACCESS_KEY_ID"
Put-WranglerSecret "OCI_S3_SECRET_ACCESS_KEY"
Put-WranglerSecret "OCI_S3_REGION"

Write-Host "--- AWS S3 ---"
Put-WranglerSecret "AWS_S3_BUCKET"
Put-WranglerSecret "AWS_ACCESS_KEY_ID"
Put-WranglerSecret "AWS_SECRET_ACCESS_KEY"
Put-WranglerSecret "AWS_REGION"

if ($Deploy) {
  npm run deploy
  Write-Host "Live: https://app14.nextaura.us/agent.json" -ForegroundColor Green
} else {
  Write-Host "Done. npm run deploy when ready." -ForegroundColor Green
}
