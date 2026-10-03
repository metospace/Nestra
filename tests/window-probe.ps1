param([uint32]$TargetProcessId)
$probeSource = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class NestraWindowProbe {
 public delegate bool EnumProc(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder t,int n);
 [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint cmd);
 [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h,int attr,out uint value,int size);
 [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr h,out uint value);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 public struct Rect { public int left,top,right,bottom; public override string ToString()=> $"{left},{top},{right},{bottom}"; }
 [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr h,IntPtr r);
 [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int a,int b,int c,int d);
 [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr p);
 public static string Run(uint pid) {
  var result=new StringBuilder(); int z=0;
  EnumWindows((h,p)=>{uint proc;GetWindowThreadProcessId(h,out proc);if(proc==pid || (z<28 && IsWindowVisible(h))){var name=new StringBuilder(200);GetWindowText(h,name,200);var r=CreateRectRgn(0,0,0,0);int region=GetWindowRgn(h,r);DeleteObject(r);uint cloaked;DwmGetWindowAttribute(h,14,out cloaked,4);uint affinity;GetWindowDisplayAffinity(h,out affinity);Rect rect;GetWindowRect(h,out rect);result.AppendLine($"HWND={h} title={name} z={z} visible={IsWindowVisible(h)} minimized={IsIconic(h)} style={GetWindowLongPtr(h,-16).ToInt64():X} ex={GetWindowLongPtr(h,-20).ToInt64():X} region={region} foreground={GetForegroundWindow()==h} cloaked={cloaked} bounds={rect} affinity={affinity}");}z++;return true;},IntPtr.Zero);return result.ToString();
 }
}
'@
Add-Type -TypeDefinition $probeSource
[NestraWindowProbe]::Run($TargetProcessId)
