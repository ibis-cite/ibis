# Owned native file-dialog actions for check-native-chooser.py. No app test API.
param(
  [ValidateSet('state', 'cancel', 'confirm', 'location-state')] [string] $Action = 'state',
  [int] $AppId,
  [long] $PickerHandle,
  [string] $Text,
  [switch] $SelfTest
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$ChooserTitle = 'Choose a BibTeX or BibLaTeX library'

function Invoke-OwnershipTests {
  function Window([long] $Handle, [int] $ProcessId = 41, [long] $Owner = 10) {
    @{Handle=$Handle;ProcessId=$ProcessId;Owner=$Owner;Visible=$true;ClassName='#32770';Title=$ChooserTitle}
  }
  function Reject([scriptblock] $Operation, [string] $Expected) {
    $rejected = $false
    try { & $Operation | Out-Null } catch { $rejected = $_.Exception.Message -eq $Expected }
    if (!$rejected) { throw 'Chooser ownership regression failed' }
  }
  $windows = [System.Collections.Generic.Dictionary[long,object]]::new()
  $windows[10] = Window 10 41 0
  $windows[20] = Window 20
  $resolve = { param($Handle) $windows[[long] $Handle] }.GetNewClosure()
  if ((Resolve-OwnedDialog @($windows[20]) 41 10 $resolve).Handle -ne 20) { throw 'Owned chooser was rejected' }
  $windows[21] = Window 21 41 20
  if ((Resolve-OwnedDialog @($windows[21]) 41 10 $resolve).Handle -ne 21) { throw 'Owned chooser chain was rejected' }
  if ($null -ne (Resolve-OwnedDialog @() 41 10 $resolve)) { throw 'Absent chooser was accepted' }
  Reject { Resolve-OwnedDialog @((Window 20 42)) 41 10 $resolve } 'Native chooser ownership is unavailable'
  $windows[30] = Window 30 41 0
  Reject { Resolve-OwnedDialog @((Window 22 41 30)) 41 10 $resolve } 'Native chooser ownership is unavailable'
  $windows[30].Owner = 30
  Reject { Resolve-OwnedDialog @((Window 22 41 30)) 41 10 $resolve } 'Native chooser owner chain exceeded bound'
  $windows[31] = Window 31 42 10
  Reject { Resolve-OwnedDialog @((Window 22 41 31)) 41 10 $resolve } 'Native chooser ownership is unavailable'
  foreach ($handle in 100..132) { $windows[$handle] = Window $handle 41 ($handle + 1) }
  $windows[132].Owner = 10
  Reject { Resolve-OwnedDialog @((Window 22 41 100)) 41 10 $resolve } 'Native chooser owner chain exceeded bound'
  Reject { Resolve-OwnedDialog @($windows[20], $windows[21]) 41 10 $resolve } 'Native chooser is ambiguous'
  Reject { Resolve-OwnedDialog @($windows[20], (Window 23 42)) 41 10 $resolve } 'Native chooser is ambiguous'
  Reject { Resolve-OwnedDialog @($windows[20]) 42 10 $resolve } 'Verified picker window identity was lost'
  Reject { Resolve-OwnedDialog (@($windows[20]) * 513) 41 10 $resolve } 'Native chooser enumeration exceeded bound'
  $true
}

# This pure ownership check is also exercised without touching any OS windows.
function Resolve-OwnedDialog([object[]] $Windows, [int] $ProcessId, [long] $Picker, [scriptblock] $Resolve) {
  $pickerWindow = & $Resolve $Picker
  if ($ProcessId -le 0 -or $Picker -le 0 -or !$pickerWindow -or $pickerWindow.ProcessId -ne $ProcessId) {
    throw 'Verified picker window identity was lost'
  }
  if ($Windows.Count -gt 512) { throw 'Native chooser enumeration exceeded bound' }
  $dialogs = @($Windows | Where-Object { $_.Visible -and $_.ClassName -ceq '#32770' -and $_.Title -ceq $ChooserTitle })
  if ($dialogs.Count -gt 1) { throw 'Native chooser is ambiguous' }
  if ($dialogs.Count -eq 0) { return $null }
  $dialog = $dialogs[0]
  if ($dialog.ProcessId -ne $ProcessId -or $dialog.Handle -eq $Picker) { throw 'Native chooser ownership is unavailable' }
  $seen = [System.Collections.Generic.HashSet[long]]::new()
  $owner = [long] $dialog.Owner
  for ($depth = 0; $depth -lt 32; $depth++) {
    if ($owner -eq 0) { throw 'Native chooser ownership is unavailable' }
    if (!$seen.Add($owner)) { throw 'Native chooser owner chain exceeded bound' }
    $ancestor = & $Resolve $owner
    if (!$ancestor -or $ancestor.ProcessId -ne $ProcessId) { throw 'Native chooser ownership is unavailable' }
    if ($owner -eq $Picker) { return $dialog }
    $owner = [long] $ancestor.Owner
  }
  throw 'Native chooser owner chain exceeded bound'
}

try {
  if ($SelfTest) {
    ConvertTo-Json -InputObject (Invoke-OwnershipTests) -Compress
    exit 0
  }
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class IbisChooser {
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder text, int length);
  public static long[] Windows() {
    var handles = new List<long>();
    bool complete = EnumWindows((window, data) => { handles.Add(window.ToInt64()); return handles.Count <= 512; }, IntPtr.Zero);
    if (!complete || handles.Count > 512) throw new InvalidOperationException("Window enumeration unavailable");
    return handles.ToArray();
  }
  public static uint ProcessId(IntPtr window) { uint process; GetWindowThreadProcessId(window, out process); return process; }
  public static string Title(IntPtr window) { var text = new StringBuilder(256); GetWindowText(window, text, text.Capacity); return text.ToString(); }
  public static string ClassName(IntPtr window) { var text = new StringBuilder(256); GetClassName(window, text, text.Capacity); return text.ToString(); }
}
'@
  function Get-WindowInfo([long] $Handle) {
    $window = [IntPtr]::new($Handle)
    if (![IbisChooser]::IsWindow($window)) { return $null }
    @{Handle=$Handle;ProcessId=[IbisChooser]::ProcessId($window);Owner=[IbisChooser]::GetWindow($window, 4).ToInt64();
      Visible=[IbisChooser]::IsWindowVisible($window);ClassName=[IbisChooser]::ClassName($window);Title=[IbisChooser]::Title($window)}
  }
  function Get-Dialog {
    $windows = @([IbisChooser]::Windows() | ForEach-Object { Get-WindowInfo $_ })
    Resolve-OwnedDialog $windows $AppId $PickerHandle { param($Handle) Get-WindowInfo $Handle }
  }
  function Get-DialogElements($Dialog) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($Dialog.Handle))
    if ($root.Current.ProcessId -ne $AppId) { throw 'Native chooser accessibility identity was lost' }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $queue = [System.Collections.Generic.Queue[object]]::new()
    $queue.Enqueue($root)
    $count = 0
    while ($queue.Count -gt 0) {
      $element = $queue.Dequeue()
      $count++
      if ($count -gt 4000) { throw 'Native chooser accessibility tree exceeded bound' }
      $element
      $child = $walker.GetFirstChild($element)
      while ($null -ne $child) {
        if ($queue.Count + $count -ge 4000) { throw 'Native chooser accessibility tree exceeded bound' }
        $queue.Enqueue($child)
        $child = $walker.GetNextSibling($child)
      }
    }
  }
  function Test-FilenameFocus($Elements) {
    $focused = @($Elements | Where-Object {
      $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.HasKeyboardFocus
    })
    if ($focused.Count -ne 1) { return $false }
    $element = $focused[0]
    for ($depth = 0; $depth -lt 32 -and $null -ne $element; $depth++) {
      if ($element.Equals($Elements[0])) { break }
      $current = $element.Current
      if ($current.AutomationId -ceq '1148' -or $current.AutomationId -ceq 'FileNameControlHost') { return $true }
      $element = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($element)
    }
    # The filename edit also has a fixed label in the English cloud image.
    $focused[0].Current.Name -ceq 'File name:' -or $focused[0].Current.Name -ceq 'File name'
  }
  $dialog = Get-Dialog
  $foreground = $null -ne $dialog -and [IbisChooser]::GetForegroundWindow().ToInt64() -eq $dialog.Handle
  $result = switch ($Action) {
    'state' { @{visible=($null -ne $dialog);foreground=[bool] $foreground;owned=($null -ne $dialog)} }
    'location-state' {
      $ready = $foreground -and (Test-FilenameFocus @(Get-DialogElements $dialog))
      @{ready=[bool] $ready;owned=($null -ne $dialog)}
    }
    default {
      if (!$dialog -or !$foreground) { throw 'Owned native chooser is not foreground' }
      $name = if ($Action -eq 'cancel') { 'Cancel' } else { 'Open' }
      $id = if ($Action -eq 'cancel') { '2' } else { '1' }
      $buttons = @(Get-DialogElements $dialog | Where-Object {
        $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
        !$_.Current.IsOffscreen -and
        ($_.Current.AutomationId -ceq $id -or $_.Current.Name -ceq $name)
      })
      if ($buttons.Count -ne 1 -or !$buttons[0].Current.IsEnabled) { throw 'Native chooser action is ambiguous or unavailable' }
      # Revalidate PID/owner/foreground immediately before the only mutation.
      $verified = Get-Dialog
      if (!$verified -or $verified.Handle -ne $dialog.Handle -or [IbisChooser]::GetForegroundWindow().ToInt64() -ne $dialog.Handle) {
        throw 'Native chooser ownership changed before action'
      }
      $buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      $true
    }
  }
  ConvertTo-Json -InputObject $result -Compress
} catch {
  # UIA exception text can contain filenames or accessible document text.
  [Console]::Error.WriteLine('Windows native chooser action failed')
  exit 1
}
