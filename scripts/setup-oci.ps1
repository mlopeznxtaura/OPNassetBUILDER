# Oracle OCI object storage — secrets only (after console signup is live)
# Run: npm run setup:oci

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

Write-Host ""
Write-Host "=== Oracle OCI (S3-compatible) for app14 ===" -ForegroundColor Cyan
Write-Host "Skip if tenancy is not active yet — other tiers already work."
Write-Host ""

Start-Process "https://cloud.oracle.com/object-storage/buckets"
Start-Process "https://cloud.oracle.com/identity/domains/my-profile/auth-tokens"

$region = Read-Host "OCI home region (e.g. us-phoenix-1, us-ashburn-1)"
$namespace = Read-Host "Object Storage namespace (from bucket details)"
if ([string]::IsNullOrWhiteSpace($region) -or [string]::IsNullOrWhiteSpace($namespace)) {
  Write-Host "Need region + namespace. See docs/ORACLE_OCI_SETUP.md" -ForegroundColor Yellow
  exit 1
}

$endpoint = "https://$namespace.compat.objectstorage.$region.oraclecloud.com"
Write-Host "Endpoint: $endpoint" -ForegroundColor Green

$bucket = Read-Host "Bucket name (e.g. opn-meshes)"
$access = Read-Host "Customer secret key — Access Key"
$secret = Read-Host "Customer secret key — Secret Key"

function Put-Secret($name, $value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return }
  $value | npx wrangler secret put $name
  if ($LASTEXITCODE -ne 0) { throw "wrangler secret put $name failed" }
  Write-Host "  set $name" -ForegroundColor Green
}

Put-Secret "OCI_S3_REGION" $region
Put-Secret "OCI_S3_ENDPOINT" $endpoint
Put-Secret "OCI_S3_BUCKET" $bucket
Put-Secret "OCI_S3_ACCESS_KEY_ID" $access
Put-Secret "OCI_S3_SECRET_ACCESS_KEY" $secret

Write-Host ""
Write-Host "Done. Test upload; response backend should be oci when this tier is reached." -ForegroundColor Green
Write-Host "Doc: docs/ORACLE_OCI_SETUP.md"
