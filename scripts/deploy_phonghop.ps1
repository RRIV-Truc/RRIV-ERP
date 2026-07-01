# Deploy Phòng họp (e-Cabinet) lên Firebase Hosting + Cloud Run
# Chạy từ thư mục gốc dự án:  .\scripts\deploy_phonghop.ps1
param(
    [switch]$SkipSql,
    [switch]$SkipHosting
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "=== RRIV-ERP — Deploy Phòng họp ===" -ForegroundColor Cyan

if (-not (Test-Path ".env")) {
    Write-Error "Thiếu file .env — copy từ .env.example và điền Supabase + Firebase"
}

foreach ($cmd in @("gcloud", "firebase", "python")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Error "Chưa cài $cmd. Cần: Google Cloud SDK, firebase-tools, Python 3.11+"
    }
}

$Project = if ($env:FIREBASE_PROJECT) { $env:FIREBASE_PROJECT } else { "rriv-erp" }
$Region  = if ($env:CLOUD_RUN_REGION) { $env:CLOUD_RUN_REGION } else { "asia-southeast1" }
$Service = if ($env:CLOUD_RUN_SERVICE) { $env:CLOUD_RUN_SERVICE } else { "rriv-erp" }

Write-Host "Project: $Project | Region: $Region | Service: $Service"

if (-not $SkipSql) {
    Write-Host "`n[1/4] Áp schema Phòng họp lên Supabase..." -ForegroundColor Yellow
    python scripts/apply_phonghop_schema.py
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Host "`n[1/4] Bỏ qua SQL (-SkipSql)" -ForegroundColor DarkGray
}

Write-Host "`n[2/4] Tạo env.cloudrun.yaml..." -ForegroundColor Yellow
python scripts/build_cloudrun_env.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`n[3/4] Deploy Flask lên Cloud Run (gồm modules/meetings)..." -ForegroundColor Yellow
gcloud config set project $Project
gcloud run deploy $Service `
    --source . `
    --region $Region `
    --allow-unauthenticated `
    --env-vars-file env.cloudrun.yaml `
    --timeout 120 `
    --memory 512Mi

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $SkipHosting) {
    Write-Host "`n[4/4] Deploy Firebase Hosting..." -ForegroundColor Yellow
    firebase use $Project
    firebase deploy --only hosting
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Host "`n[4/4] Bỏ qua Hosting (-SkipHosting)" -ForegroundColor DarkGray
}

$RunUrl = gcloud run services describe $Service --region $Region --format="value(status.url)" 2>$null
Write-Host ""
Write-Host "=== Xong ===" -ForegroundColor Green
Write-Host "Phòng họp:  https://${Project}.web.app/app/phonghop"
Write-Host "Vào bằng mã: https://${Project}.web.app/app/phonghop/join?code=MTG-..."
if ($RunUrl) { Write-Host "Cloud Run:  $RunUrl" }
Write-Host ""
Write-Host "Kiểm tra:" -ForegroundColor Cyan
Write-Host "  • Hub ERP có thẻ Phòng họp"
Write-Host "  • Tạo cuộc họp → vào phòng → upload tài liệu"
Write-Host "  • Firebase Storage có folder sessions/ sau khi tick chia sẻ tài liệu"
