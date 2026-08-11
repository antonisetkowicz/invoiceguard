# Otwiera najnowszy raport „Monday" w Gmailu (Windows).
# Uruchamiany automatycznie w poniedziałek o 7:00 przez Harmonogram zadań —
# patrz install-windows.ps1. Ręcznie:
#   powershell -ExecutionPolicy Bypass -File scripts\monday\open-monday.ps1
param([string]$Adres = $env:MONDAY_REPORT_TO)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$LogFile  = Join-Path $env:USERPROFILE ".monday-open.log"

function Write-Log($msg) {
  "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg | Add-Content -Path $LogFile
}

if (-not $Adres) {
  $envFile = Join-Path $RepoRoot ".env"
  if (Test-Path $envFile) {
    $line = Select-String -Path $envFile -Pattern '^\s*(export\s+)?MONDAY_REPORT_TO=' |
            Select-Object -Last 1
    if ($line) {
      $Adres = ($line.Line -replace '^[^=]*=', '').Trim().Trim('"').Trim("'")
    }
  }
}

$query = 'subject%3A%22%5BMonday%5D%22+newer_than%3A8d'
if ($Adres) {
  $url = "https://mail.google.com/mail/u/$Adres/#search/$query"
} else {
  $url = "https://mail.google.com/mail/u/0/#search/$query"
  Write-Log "UWAGA: brak MONDAY_REPORT_TO — otwieram domyslne konto Gmail (u/0)."
}

Start-Process $url
Write-Log "otwarto raport Monday w przegladarce ($Adres)"

# Bonus: lokalna kopia raportu, jesli pipeline dziala na tym komputerze.
if ($env:MONDAY_OPEN_LOCAL -ne "0") {
  $latest = Get-ChildItem -Path (Join-Path $RepoRoot "run") -Recurse -Filter "report.html" `
            -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-8) } |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latest) {
    Start-Process $latest.FullName
    Write-Log "otwarto lokalna kopie: $($latest.FullName)"
  }
}
