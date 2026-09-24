# Push blob-backend secrets to Cloudflare Worker (free tiers, no payment).
# Sources (in order): auto from logged-in CLIs, then gitignored .secrets.local
#
# NOT per-session cloud tokens: one secret set on the Worker; isolation is
# POST /api/sessions -> random s_* id -> blob key {sessionId}/file.glb
#
# Run: npm run setup:sync-secrets

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue

function Set-WranglerSecret($name, $value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return $false }
  $value | npx wrangler secret put $name 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAIL $name (wrangler)" -ForegroundColor Red
    return $false
  }
  Write-Host "  OK   $name" -ForegroundColor Green
  return $true
}

$vars = @{}

# --- .secrets.local (KEY=value lines, # comments ok) ---
$localFile = Join-Path $Root ".secrets.local"
if (Test-Path $localFile) {
  Write-Host "Loading .secrets.local" -ForegroundColor Cyan
  Get-Content $localFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '^\s*([A-Za-z0-9_]+)\s*=\s*(.+)\s*$') { return }
    $vars[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
  }
}

# --- Supabase CLI ---
if (Get-Command supabase -ErrorAction SilentlyContinue) {
  Write-Host "Supabase CLI..." -ForegroundColor Cyan
  $json = supabase projects list -o json 2>$null | Out-String
  try {
    $projects = $json | ConvertFrom-Json
    $p = $projects | Select-Object -First 1
    if ($p.ref) {
      if (-not $vars.SUPABASE_URL) { $vars.SUPABASE_URL = "https://$($p.ref).supabase.co" }
      if ($p.status -eq "INACTIVE") {
        Write-Host "  Project $($p.name) is PAUSED (INACTIVE). Restore free project in dashboard, then re-run." -ForegroundColor Yellow
        Start-Process "https://supabase.com/dashboard/project/$($p.ref)"
      }
      $keysJson = supabase projects api-keys --project-ref $p.ref -o json 2>$null | Out-String
      $keys = $keysJson | ConvertFrom-Json -ErrorAction SilentlyContinue
      if ($keys -is [array]) {
        foreach ($k in $keys) {
          if ($k.name -eq "service_role" -and $k.api_key) { $vars.SUPABASE_SERVICE_ROLE_KEY = $k.api_key }
          if ($k.name -eq "anon" -and $k.api_key -and -not $vars.SUPABASE_ANON_KEY) { $vars.SUPABASE_ANON_KEY = $k.api_key }
        }
      }
      if (-not $vars.SUPABASE_BUCKET) { $vars.SUPABASE_BUCKET = "opn-meshes" }
    }
  } catch {
    Write-Host "  Could not parse supabase projects (run: supabase login)" -ForegroundColor Yellow
  }
}

# --- Vercel: token only from .secrets.local (CLI has no safe auto-export) ---
if (Get-Command vercel -ErrorAction SilentlyContinue) {
  $vercelJob = Start-Job { vercel whoami 2>&1 }
  $done = Wait-Job $vercelJob -Timeout 8
  if ($done) {
    $who = Receive-Job $vercelJob
    Remove-Job $vercelJob -Force -ErrorAction SilentlyContinue
    if ($who -and $who -notmatch 'not valid|Error') {
      Write-Host "Vercel CLI logged in as $who" -ForegroundColor Cyan
    } else {
      Write-Host "Vercel: run vercel login in your terminal" -ForegroundColor Yellow
    }
  } else {
    Stop-Job $vercelJob -ErrorAction SilentlyContinue
    Remove-Job $vercelJob -Force -ErrorAction SilentlyContinue
    Write-Host "Vercel CLI timed out - run vercel login locally" -ForegroundColor Yellow
  }
  if (-not $vars.BLOB_READ_WRITE_TOKEN) {
    Write-Host "  Add BLOB_READ_WRITE_TOKEN to .secrets.local (Vercel -> Storage -> Blob)" -ForegroundColor Yellow
  }
}

# --- AWS CLI profile (optional) ---
if (Get-Command aws -ErrorAction SilentlyContinue) {
  $id = aws sts get-caller-identity --query Account --output text 2>$null
  if ($LASTEXITCODE -eq 0 -and $id) {
    Write-Host "AWS CLI account $id" -ForegroundColor Cyan
    if (-not $vars.AWS_REGION) { $vars.AWS_REGION = "us-east-1" }
  }
}

Write-Host ""
Write-Host "Pushing to Worker nextaura-app14-us..." -ForegroundColor Cyan
$names = @(
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_BUCKET",
  "MONGODB_DATA_API_URL", "MONGODB_DATA_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "OCI_S3_ENDPOINT", "OCI_S3_BUCKET", "OCI_S3_ACCESS_KEY_ID", "OCI_S3_SECRET_ACCESS_KEY", "OCI_S3_REGION",
  "AWS_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"
)
$pushed = 0
foreach ($n in $names) {
  if ($vars.ContainsKey($n) -and $vars[$n]) {
    if (Set-WranglerSecret $n $vars[$n]) { $pushed++ }
  }
}

Write-Host ""
if ($pushed -eq 0) {
  Write-Host "Nothing pushed. Copy .secrets.local.example -> .secrets.local, fill values, re-run." -ForegroundColor Yellow
  Write-Host "Or restore Supabase project + supabase login, then re-run." -ForegroundColor Yellow
} else {
  Write-Host "Pushed $pushed secret(s). Check: curl https://app14.nextaura.us/api/storage" -ForegroundColor Green
}
