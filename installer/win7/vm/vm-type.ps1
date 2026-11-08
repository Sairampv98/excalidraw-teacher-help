# Types text into the VM like a keyboard:  vm-type.ps1 -Text "dir C:\" [-NoEnter] [-Win R]
param([string]$Text = "", [switch]$NoEnter, [switch]$WinR, [string]$Name = "Win7Test")
$vm = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_ComputerSystem -Filter "ElementName='$Name'"
$kb = Get-CimInstance -Namespace root\virtualization\v2 -Query "SELECT * FROM Msvm_Keyboard WHERE SystemName='$($vm.Name)'"
if ($WinR) {
  # Windows key + R: press the Windows key (91) and R (82)
  Invoke-CimMethod -InputObject $kb -MethodName PressKey -Arguments @{ keyCode = [uint32]91 } | Out-Null
  Invoke-CimMethod -InputObject $kb -MethodName TypeKey -Arguments @{ keyCode = [uint32]82 } | Out-Null
  Invoke-CimMethod -InputObject $kb -MethodName ReleaseKey -Arguments @{ keyCode = [uint32]91 } | Out-Null
  Start-Sleep -Milliseconds 800
}
if ($Text) { Invoke-CimMethod -InputObject $kb -MethodName TypeText -Arguments @{ asciiText = $Text } | Out-Null }
if (-not $NoEnter -and ($Text -or $WinR)) { Start-Sleep -Milliseconds 300; Invoke-CimMethod -InputObject $kb -MethodName TypeKey -Arguments @{ keyCode = [uint32]13 } | Out-Null }
