# Makes a disc image (UDF) of a folder, with the IMAPI that ships with Windows, to carry files into a machine that has no
# network: make-iso.ps1 -Folder <folder> -Out <file.iso> [-Label PACK]
param([Parameter(Mandatory = $true)][string]$Folder, [Parameter(Mandatory = $true)][string]$Out, [string]$Label = "PACK")

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices.ComTypes;
public static class IsoWriter {
  public static void Write(object stream, string path) {
    IStream s = (IStream)stream;
    System.Runtime.InteropServices.ComTypes.STATSTG st;
    s.Stat(out st, 1);
    long left = st.cbSize;
    byte[] buffer = new byte[1024 * 1024];
    IntPtr read = System.Runtime.InteropServices.Marshal.AllocHGlobal(4);
    using (FileStream f = File.Create(path)) {
      while (left > 0) {
        int want = (int)Math.Min(buffer.Length, left);
        s.Read(buffer, want, read);
        int n = System.Runtime.InteropServices.Marshal.ReadInt32(read);
        if (n <= 0) break;
        f.Write(buffer, 0, n);
        left -= n;
      }
    }
    System.Runtime.InteropServices.Marshal.FreeHGlobal(read);
  }
}
"@

$image = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
$image.VolumeName = $Label
$image.FileSystemsToCreate = 4   # UDF: files of any size, read by Windows 7
$image.FreeMediaBlocks = 0       # no limit: not a disc of 700 MB
$image.Root.AddTree((Resolve-Path $Folder).Path, $false)
$result = $image.CreateResultImage()
[IsoWriter]::Write($result.ImageStream, $Out)
"{0}  {1:N0} MB" -f $Out, ((Get-Item $Out).Length / 1MB)
