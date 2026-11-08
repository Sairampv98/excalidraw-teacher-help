# Moves the VM's mouse and clicks:  vm-click.ps1 -X 512 -Y 384 [-Double] [-Right] [-MoveOnly]
# X and Y are pixels of the 1024x768 screen that vm-shot.ps1 shows.
param([int]$X, [int]$Y, [switch]$Double, [switch]$Right, [switch]$MoveOnly, [string]$Name = "Win7Test")
$vm = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_ComputerSystem -Filter "ElementName='$Name'"
$mouse = Get-CimInstance -Namespace root\virtualization\v2 -Query "SELECT * FROM Msvm_SyntheticMouse WHERE SystemName='$($vm.Name)'"
# the absolute position is in 0..65535 of the whole screen
$ax = [int]([Math]::Round($X * 65535 / 1023)); $ay = [int]([Math]::Round($Y * 65535 / 767))
Invoke-CimMethod -InputObject $mouse -MethodName SetAbsolutePosition -Arguments @{ HorizontalPosition = [int]$ax; VerticalPosition = [int]$ay } | Out-Null
Start-Sleep -Milliseconds 250
if (-not $MoveOnly) {
  $button = 0; if ($Right) { $button = 1 }
  Invoke-CimMethod -InputObject $mouse -MethodName ClickButton -Arguments @{ ButtonIndex = [uint32]$button } | Out-Null
  if ($Double) { Start-Sleep -Milliseconds 120; Invoke-CimMethod -InputObject $mouse -MethodName ClickButton -Arguments @{ ButtonIndex = [uint32]$button } | Out-Null }
}
