# Makes a Hyper-V virtual machine with a clean Windows 7 (Service Pack 1, from a disc image) installed with no one at the
# keyboard, and a checkpoint of it:   new-vm.ps1 -Name Win7x64 -Iso <Win7 disc.iso> -Arch x64 [-Folder D:\Hyper-V\VMs]
# The account is "tester" (password Test1234!, a throwaway): the machine has no network and is for tests only.
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string]$Iso,
  [ValidateSet("x86", "x64")][string]$Arch = "x64",
  [string]$Folder = "D:\Hyper-V\VMs",
  [int]$DiskGB = 30,
  [int]$MemoryMB = 2048,
  [string]$Checkpoint = "clean-win7sp1-installed"
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cpu = if ($Arch -eq "x64") { "amd64" } else { "x86" }

# the answers: the unattend file with this machine's architecture and name
$work = Join-Path $env:TEMP "unattend-$Name"
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $work | Out-Null
$xml = (Get-Content (Join-Path $here "Autounattend.xml") -Raw).Replace('processorArchitecture="x86"', "processorArchitecture=`"$cpu`"").Replace("WIN7TEST", $Name.ToUpper())
Set-Content (Join-Path $work "Autounattend.xml") $xml -Encoding utf8
$answers = Join-Path $Folder "$Name-answers.iso"
& (Join-Path $here "make-iso.ps1") -Folder $work -Out $answers -Label ANSWERS | Out-Null

New-Item -ItemType Directory -Force (Join-Path $Folder $Name) | Out-Null
$disk = Join-Path $Folder "$Name\$Name.vhdx"
New-VHD -Path $disk -SizeBytes ($DiskGB * 1GB) -Dynamic | Out-Null
New-VM -Name $Name -Generation 1 -MemoryStartupBytes ($MemoryMB * 1MB) -VHDPath $disk -Path $Folder -ErrorAction Stop | Out-Null
Set-VM -Name $Name -ProcessorCount 2 -AutomaticCheckpointsEnabled $false
Get-VMNetworkAdapter -VMName $Name | Remove-VMNetworkAdapter
Add-VMDvdDrive -VMName $Name -ControllerNumber 0 -ControllerLocation 1 -Path $Iso
Add-VMDvdDrive -VMName $Name -Path $answers
Set-VMBios -VMName $Name -StartupOrder @("CD", "IDE", "LegacyNetworkAdapter", "Floppy")
Start-VM $Name
"$Name started: the install takes about 30 minutes; when the desktop is up, take the checkpoint '$Checkpoint'."


