# Run BEFORE a virtual machine is started (the test machines have filled the system drive before):
#   check-host-disk.ps1 [-Path D:\Hyper-V] [-MinGB 15]
# It stops (exit 2) when the drive of the machine's folder, or the system drive, has less than -MinGB free, and it lists the
# throwaway editors and dev servers that are running and should be stopped first. It changes nothing and starts nothing.
param(
  [string]$Path = 'D:\Hyper-V',
  [double]$MinGB = 15
)

$bad = $false

foreach ($drive in @((Split-Path -Qualifier $Path), $env:SystemDrive) | Select-Object -Unique) {
  $disk = Get-WmiObject Win32_LogicalDisk -Filter ("DeviceID='" + $drive + "'")

  if (-not $disk) { Write-Output ('no drive ' + $drive); $bad = $true; continue }

  $free = [math]::Round($disk.FreeSpace / 1GB, 1)

  if ($free -lt $MinGB) {
    Write-Output ('NOT OK  ' + $drive + ' has ' + $free + ' GB free, less than ' + $MinGB + ' GB: free some space before a machine is started')
    $bad = $true
  } else {
    Write-Output ('ok      ' + $drive + ' has ' + $free + ' GB free')
  }
}

# what is worth stopping first: throwaway editors and dev servers (never the owner's own editor: it is not listed as ours)
$running = @(Get-WmiObject Win32_Process | Where-Object {
    ($_.Name -match '^(Code|VSCodium)\.exe$' -and $_.CommandLine -match '--user-data-dir') -or
    ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'vite|--strictPort')
  })

foreach ($process in $running) {
  Write-Output ('running  ' + $process.Name + ' (pid ' + $process.ProcessId + ') - stop it if it is a throwaway of yours')
}

if ($bad) { exit 2 }

exit 0
