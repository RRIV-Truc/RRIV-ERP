# Backup Supabase về máy local — chạy thủ công hoặc lên lịch Task Scheduler
# Usage:  .\scripts\backup_supabase_db.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$logDir = Join-Path $PWD "supabase\backups\data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("backup-{0:yyyy-MM-dd_HHmmss}.log" -f (Get-Date))

function Write-Log($msg) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg
    Add-Content -Path $logFile -Value $line
    Write-Host $line
}

try {
    Write-Log "Bat dau backup Supabase..."

    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
    if (-not $py) { throw "Khong tim thay python. Cai Python 3 va thu lai." }

    & $py.Source "scripts\backup_supabase_db.py" 2>&1 | ForEach-Object { Write-Log $_ }
    if ($LASTEXITCODE -ne 0) { throw "backup_supabase_db.py loi (exit $LASTEXITCODE)" }

    Write-Log "Backup thanh cong."
}
catch {
    Write-Log "LOI: $_"
    exit 1
}
