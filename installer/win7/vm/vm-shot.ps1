# Saves a picture of the VM's screen: vm-shot.ps1 [-Out path.png]
param([string]$Name = "Win7Test", [string]$Out = (Join-Path $env:TEMP "vm-screen.png"))
$vm = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_ComputerSystem -Filter "ElementName='$Name'"
$svc = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_VirtualSystemManagementService
$vs = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_VideoHead -ErrorAction SilentlyContinue | Select-Object -First 1
$w = 1024; $h = 768
$settings = Get-CimAssociatedInstance -InputObject $vm -Association Msvm_SettingsDefineState -ResultClassName Msvm_VirtualSystemSettingData | Select-Object -First 1
$r = Invoke-CimMethod -InputObject $svc -MethodName GetVirtualSystemThumbnailImage -Arguments @{ TargetSystem = $settings; WidthPixels = [uint16]$w; HeightPixels = [uint16]$h }
if (-not $r.ImageData) { "no image (return $($r.ReturnValue))"; exit 1 }
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format16bppRgb565)
$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $bmp.PixelFormat)
$n = [Math]::Min($r.ImageData.Length, [Math]::Abs($data.Stride) * $h); [System.Runtime.InteropServices.Marshal]::Copy([byte[]]$r.ImageData, 0, $data.Scan0, $n)
$bmp.UnlockBits($data); $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
$Out
