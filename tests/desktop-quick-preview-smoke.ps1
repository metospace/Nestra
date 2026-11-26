param([Parameter(Mandatory)][uint32]$AppProcessId)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NestraQuickSmoke {
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  public static IntPtr Find(uint processId, string title) {
    IntPtr found=IntPtr.Zero;
    EnumWindows((window, data) => {
      uint pid;
      GetWindowThreadProcessId(window, out pid);
      if (pid != processId || !IsWindowVisible(window)) return true;
      var text = new StringBuilder(256);
      GetWindowText(window, text, text.Capacity);
      if (text.ToString() != title) return true;
      found=window;
      return false;
    }, IntPtr.Zero);
    return found;
  }
  public static void Key(byte key, bool release) { keybd_event(key, 0, release ? 2u : 0u, UIntPtr.Zero); }
}
'@
function Wait-Condition($callback, [string]$message) {
  $deadline = [DateTime]::UtcNow.AddSeconds(12)
  do {
    if (& $callback) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw $message
}
Add-Type -AssemblyName System.Windows.Forms
$other = New-Object System.Windows.Forms.Form
$other.Text = 'Nestra quick smoke foreground fixture'
try {
  $other.Show()
  [System.Windows.Forms.Application]::DoEvents()
  $other.Activate()
  [void][NestraQuickSmoke]::SetForegroundWindow($other.Handle)
  Wait-Condition { [NestraQuickSmoke]::GetForegroundWindow() -eq $other.Handle } 'A normal foreground window could not be activated on this runner'
  $title = 'Nestra 桌面快开'
  if ([NestraQuickSmoke]::Find($AppProcessId, $title) -ne [IntPtr]::Zero) { throw 'Popup should start hidden' }
  try {
    [NestraQuickSmoke]::Key(0x11, $false)
    [NestraQuickSmoke]::Key(0x12, $false)
    [NestraQuickSmoke]::Key(0x20, $false)
  } finally {
    [NestraQuickSmoke]::Key(0x20, $true)
    [NestraQuickSmoke]::Key(0x12, $true)
    [NestraQuickSmoke]::Key(0x11, $true)
  }
  Wait-Condition {
    $quick = [NestraQuickSmoke]::Find($AppProcessId, $title)
    $quick -ne [IntPtr]::Zero -and [NestraQuickSmoke]::GetForegroundWindow() -eq $quick
  } 'Ctrl+Alt+Space did not show and focus the popup over a different window'
  Start-Sleep -Seconds 2
  [NestraQuickSmoke]::Key(0x1B, $false)
  [NestraQuickSmoke]::Key(0x1B, $true)
  Wait-Condition { [NestraQuickSmoke]::Find($AppProcessId, $title) -eq [IntPtr]::Zero } 'Escape did not dismiss the popup'
  Write-Host 'Global Ctrl+Alt+Space displayed and focused the popup over a normal foreground window; Escape dismissed it.'
} finally {
  $other.Dispose()
}
