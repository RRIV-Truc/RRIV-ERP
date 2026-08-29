# Backup Supabase ve D:\BackupSQL — chay tren may Windows (khong can Render)
# Usage:  .\scripts\backup_to_D.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$dest = "D:\BackupSQL"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# Doc .env neu co BACKUP_LOCAL_DIR
$envFile = Join-Path $PWD ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*BACKUP_LOCAL_DIR\s*=\s*(.+)\s*$') {
            $dest = $Matches[1].Trim().Trim('"')
        }
    }
}

$env:BACKUP_LOCAL_DIR = $dest
Write-Host "Thu muc luu: $dest"
Write-Host "Dang backup tu Supabase..."

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
if (-not $py) { throw "Khong tim thay python. Cai Python 3 roi thu lai." }

& $py.Source "-m" "pip" "install" "-q" "psycopg2-binary" "python-dotenv" 2>$null
& $py.Source "scripts\backup_supabase_db.py"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Xong. Kiem tra thu muc: $dest"
