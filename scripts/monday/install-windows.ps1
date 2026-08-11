# Instaluje w Harmonogramie zadań Windows otwieranie raportu „Monday"
# w każdy poniedziałek o 07:00 (i opcjonalnie generowanie o 05:30).
#
# Uruchom w PowerShellu (nie trzeba administratora):
#   powershell -ExecutionPolicy Bypass -File scripts\monday\install-windows.ps1
# Bez generatora:
#   ... -File scripts\monday\install-windows.ps1 -BezGeneratora
# Odinstalowanie:
#   ... -File scripts\monday\install-windows.ps1 -Odinstaluj
param([switch]$Odinstaluj, [switch]$BezGeneratora)

$ErrorActionPreference = "Stop"
$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$OpenTask   = "Monday - otwarcie raportu"
$GenTask    = "Monday - generowanie raportu"

if ($Odinstaluj) {
  foreach ($t in @($OpenTask, $GenTask)) {
    Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "usunieto: $t"
  }
  return
}

# --- 1) otwieranie maila: poniedziałek 07:00 ---
$openAction  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RepoRoot\scripts\monday\open-monday.ps1`""
$openTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 7:00am
$settings    = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $OpenTask -Action $openAction -Trigger $openTrigger `
  -Settings $settings -Description "Otwiera tygodniowy raport AI Monday w Gmailu" -Force | Out-Null
Write-Host "OK: '$OpenTask' — poniedzialek 07:00."

# --- 2) generowanie raportu: poniedziałek 05:30 (opcjonalne) ---
if (-not $BezGeneratora) {
  $claude = (Get-Command claude -ErrorAction SilentlyContinue)
  if (-not $claude) {
    Write-Host "POMINIETO generator: brak CLI 'claude' w PATH (raport musi powstawac gdzie indziej)."
  } else {
    $genAction  = New-ScheduledTaskAction -Execute $claude.Source `
      -Argument '-p "/monday" --dangerously-skip-permissions' -WorkingDirectory $RepoRoot
    $genTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 5:30am
    Register-ScheduledTask -TaskName $GenTask -Action $genAction -Trigger $genTrigger `
      -Settings $settings -Description "Generuje i wysyla tygodniowy raport AI Monday" -Force | Out-Null
    Write-Host "OK: '$GenTask' — poniedzialek 05:30."
  }
}

Write-Host ""
Write-Host "Test bez czekania:  powershell -ExecutionPolicy Bypass -File `"$RepoRoot\scripts\monday\open-monday.ps1`""
Write-Host "Logi:               $env:USERPROFILE\.monday-open.log"
