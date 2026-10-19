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
$script:ChooserFacts = @{stage='startup';matches=0;enumerated=0;owned=$false;foreground=$false;selector=@{buttons=0;exact_id=0;exact_name=0;offscreen=0;eligible=0}}

function Format-ChooserFailure([hashtable] $Facts, [string] $Failure) {
  $stages = @('startup', 'assembly', 'resolve', 'tree', 'target', 'verify', 'pattern', 'invoke')
  $reasons = @{
    'Verified picker window identity was lost'='picker-identity'
    'Native chooser enumeration exceeded bound'='enumeration-bound'
    'Native chooser is ambiguous'='dialog-ambiguous'
    'Native chooser ownership is unavailable'='dialog-ownership'
    'Native chooser owner chain exceeded bound'='owner-bound'
    'Native chooser accessibility identity was lost'='accessibility-identity'
    'Native chooser accessibility tree exceeded bound'='tree-bound'
    'Owned native chooser is not foreground'='not-foreground'
    'Native chooser action is ambiguous or unavailable'='target-unavailable'
    'Native chooser ownership changed before action'='ownership-changed'
  }
  $selector = @{}
  foreach ($key in @('buttons','exact_id','exact_name','offscreen','eligible')) {
    $value = if ($Facts.selector -is [hashtable]) { $Facts.selector[$key] } else { $null }
    $selector[$key] = if ($value -is [int] -and $value -ge 0 -and $value -le 4000) { $value } else { 0 }
  }
  $safe = @{
    stage=$(if ($Facts.stage -is [string] -and $Facts.stage -cin $stages) { $Facts.stage } else { 'startup' })
    reason=$(if ($reasons.ContainsKey($Failure)) { $reasons[$Failure] } else { 'provider-unavailable' })
    matches=$(if ($Facts.matches -is [int] -and $Facts.matches -ge 0 -and $Facts.matches -le 4000) { $Facts.matches } else { 0 })
    enumerated=$(if ($Facts.enumerated -is [int] -and $Facts.enumerated -ge 0 -and $Facts.enumerated -le 4000) { $Facts.enumerated } else { 0 })
    owned=$(if ($Facts.owned -is [bool]) { $Facts.owned } else { $false })
    foreground=$(if ($Facts.foreground -is [bool]) { $Facts.foreground } else { $false })
    selector=$selector
  }
  'NATIVE CHOOSER WINDOWS ' + (ConvertTo-Json -InputObject $safe -Compress)
}

# Readiness never retries the action. Every observation first revalidates the
# same owned foreground HWND, then reads the current accessibility tree.
function Wait-ChooserTarget([scriptblock] $Observe, [scriptblock] $Clock, [scriptblock] $Pause, [int] $Budget = 8000) {
  $deadline = (& $Clock) + $Budget
  while ($true) {
    $observation = & $Observe
    if (!$observation.Owned -or !$observation.Foreground -or !$observation.SameDialog) {
      throw 'Native chooser ownership changed before action'
    }
    $targets = @($observation.Targets)
    if ($targets.Count -gt 1) { throw 'Native chooser action is ambiguous or unavailable' }
    if ($targets.Count -eq 1 -and $targets[0].Enabled) { return $targets[0].Element }
    if ((& $Clock) -ge $deadline) { throw 'Native chooser action is ambiguous or unavailable' }
    & $Pause | Out-Null
  }
}

function Invoke-ReadyChooserAction([scriptblock] $Observe, [scriptblock] $Clock, [scriptblock] $Pause, [scriptblock] $Verify, [scriptblock] $Invoke, [int] $Budget = 8000) {
  $target = Wait-ChooserTarget $Observe $Clock $Pause $Budget
  & $Verify | Out-Null
  & $Invoke $target | Out-Null
}

function Select-ChooserTargets([object[]] $Candidates, [string] $Id, [string] $Name) {
  $counts = @{buttons=0;exact_id=0;exact_name=0;offscreen=0;eligible=0}
  $targets = [System.Collections.Generic.List[object]]::new()
  foreach ($candidate in $Candidates) {
    if (!$candidate.IsButton) { continue }
    $counts.buttons++
    $sameId = $candidate.Id -ceq $Id
    $sameName = $candidate.Name -ceq $Name
    if ($sameId) { $counts.exact_id++ }
    if ($sameName) { $counts.exact_name++ }
    if (!$sameId -and !$sameName) { continue }
    if ($candidate.Offscreen) { $counts.offscreen++; continue }
    if ($candidate.Enabled) { $counts.eligible++ }
    $targets.Add(@{Element=$candidate.Element;Enabled=$candidate.Enabled})
  }
  @{Selector=$counts;Targets=@($targets.ToArray())}
}

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
  $target = @{Element='owned-button';Enabled=$true}
  $script:observations = 0
  $script:elapsed = 0
  $script:invocations = 0
  $script:verifications = 0
  $observe = {
    $script:observations++
    if ($script:invocations -ne 0) { throw 'Chooser invoked before readiness' }
    @{Owned=$true;Foreground=$true;SameDialog=$true;Targets=$(if ($script:observations -eq 1) { @() } else { @($target) })}
  }
  $clock = { $script:elapsed }
  $pause = { $script:elapsed += 100 }
  $selected = Wait-ChooserTarget $observe $clock $pause 200
  if ($selected -cne 'owned-button' -or $script:observations -ne 2) { throw 'Chooser readiness regression failed' }
  $script:observations = 0
  $script:elapsed = 0
  $verify = { $script:verifications++ }
  $invoke = { param($Element) if ($Element -cne 'owned-button') { throw 'Wrong chooser target' }; $script:invocations++ }
  Invoke-ReadyChooserAction $observe $clock $pause $verify $invoke 200
  if ($script:invocations -ne 1 -or $script:verifications -ne 1 -or $script:observations -ne 2) { throw 'Chooser action count regression failed' }
  $duplicate = { @{Owned=$true;Foreground=$true;SameDialog=$true;Targets=@($target,$target)} }
  Reject { Wait-ChooserTarget $duplicate $clock $pause 200 } 'Native chooser action is ambiguous or unavailable'
  foreach ($property in @('Owned','Foreground','SameDialog')) {
    $lost = @{Owned=$true;Foreground=$true;SameDialog=$true;Targets=@($target)}
    $lost[$property] = $false
    $readLost = { $lost }
    Reject { Wait-ChooserTarget $readLost $clock $pause 200 } 'Native chooser ownership changed before action'
  }
  $script:elapsed = 0
  $never = { @{Owned=$true;Foreground=$true;SameDialog=$true;Targets=@()} }
  Reject { Wait-ChooserTarget $never $clock $pause 200 } 'Native chooser action is ambiguous or unavailable'
  if ($script:elapsed -ne 200) { throw 'Chooser readiness deadline regression failed' }
  $script:elapsed = 0
  $disabled = { @{Owned=$true;Foreground=$true;SameDialog=$true;Targets=@(@{Element='disabled';Enabled=$false})} }
  Reject { Wait-ChooserTarget $disabled $clock $pause 200 } 'Native chooser action is ambiguous or unavailable'
  foreach ($failure in @('ambiguous','ownership')) {
    $script:observations = 0
    $script:elapsed = 0
    $pendingThenUnsafe = {
      $script:observations++
      if ($script:observations -eq 1) { return @{Owned=$true;Foreground=$true;SameDialog=$true;Targets=@()} }
      @{Owned=($failure -ne 'ownership');Foreground=$true;SameDialog=$true;Targets=@($target,$target)}
    }
    $expected = if ($failure -eq 'ownership') { 'Native chooser ownership changed before action' } else { 'Native chooser action is ambiguous or unavailable' }
    Reject { Invoke-ReadyChooserAction $pendingThenUnsafe $clock $pause $verify $invoke 200 } $expected
    if ($script:invocations -ne 1 -or $script:verifications -ne 1 -or $script:observations -ne 2) {
      throw 'Chooser unsafe readiness invoked an action'
    }
  }
  $candidates = @(
    @{IsButton=$true;Id='2';Name='Cancel';Offscreen=$false;Enabled=$true;Element='owned-button'},
    @{IsButton=$true;Id='2';Name='other';Offscreen=$true;Enabled=$true;Element='hidden'},
    @{IsButton=$true;Id='other';Name='Cancel';Offscreen=$false;Enabled=$false;Element='disabled'},
    @{IsButton=$false;Id='2';Name='Cancel';Offscreen=$false;Enabled=$true;Element='not-button'}
  )
  $selection = Select-ChooserTargets $candidates '2' 'Cancel'
  if ($selection.Targets.Count -ne 2 -or $selection.Selector.buttons -ne 3 -or
      $selection.Selector.exact_id -ne 2 -or $selection.Selector.exact_name -ne 2 -or
      $selection.Selector.offscreen -ne 1 -or $selection.Selector.eligible -ne 1) { throw 'Chooser selector regression failed' }
  $facts = @{stage='target';matches=2;enumerated=12;owned=$true;foreground=$true;selector=$selection.Selector}
  $line = Format-ChooserFailure $facts 'Native chooser action is ambiguous or unavailable'
  $prefix = 'NATIVE CHOOSER WINDOWS '
  if (!$line.StartsWith($prefix)) { throw 'Chooser safe diagnostic regression failed' }
  $diagnostic = $line.Substring($prefix.Length) | ConvertFrom-Json
  $keys = @($diagnostic.PSObject.Properties.Name | Sort-Object)
  if ([string]::Join(',', $keys) -cne 'enumerated,foreground,matches,owned,reason,selector,stage') { throw 'Chooser diagnostic schema regression failed' }
  if ([string]::Join(',', @($diagnostic.selector.PSObject.Properties.Name | Sort-Object)) -cne 'buttons,eligible,exact_id,exact_name,offscreen' -or
      $diagnostic.selector.buttons -ne 3 -or $diagnostic.selector.eligible -ne 1) { throw 'Chooser selector diagnostic regression failed' }
  if ($diagnostic.stage -cne 'target' -or $diagnostic.reason -cne 'target-unavailable' -or
      $diagnostic.matches -ne 2 -or $diagnostic.enumerated -ne 12 -or
      $diagnostic.owned -isnot [bool] -or !$diagnostic.owned -or
      $diagnostic.foreground -isnot [bool] -or !$diagnostic.foreground) { throw 'Chooser safe diagnostic regression failed' }
  $private = 'private provider payload /private/synthetic-path'
  $line = Format-ChooserFailure @{stage=$private;matches=$private;enumerated=4001;owned=$private;foreground=1;selector=@{buttons=$private;eligible=4001;exact_id=-1;exact_name=$true;offscreen=1.5}} $private
  $diagnostic = $line.Substring($prefix.Length) | ConvertFrom-Json
  if ($line.Contains($private) -or $diagnostic.stage -cne 'startup' -or $diagnostic.reason -cne 'provider-unavailable' -or
      $diagnostic.matches -ne 0 -or $diagnostic.enumerated -ne 0 -or
      $diagnostic.owned -isnot [bool] -or $diagnostic.owned -or
      $diagnostic.foreground -isnot [bool] -or $diagnostic.foreground) { throw 'Chooser private diagnostic regression failed' }
  foreach ($property in $diagnostic.selector.PSObject.Properties) {
    if ($property.Value -ne 0) { throw 'Chooser private selector diagnostic regression failed' }
  }
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
  $script:ChooserFacts.stage = 'assembly'
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
      $script:ChooserFacts.enumerated = [Math]::Min($count, 4000)
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
  $script:ChooserFacts.stage = 'resolve'
  $dialog = Get-Dialog
  $script:ChooserFacts.owned = [bool] ($null -ne $dialog)
  $foreground = $null -ne $dialog -and [IbisChooser]::GetForegroundWindow().ToInt64() -eq $dialog.Handle
  $script:ChooserFacts.foreground = [bool] $foreground
  $result = switch ($Action) {
    'state' { @{visible=($null -ne $dialog);foreground=[bool] $foreground;owned=($null -ne $dialog)} }
    'location-state' {
      $script:ChooserFacts.stage = 'tree'
      $ready = $foreground -and (Test-FilenameFocus @(Get-DialogElements $dialog))
      @{ready=[bool] $ready;owned=($null -ne $dialog)}
    }
    default {
      if (!$dialog -or !$foreground) { throw 'Owned native chooser is not foreground' }
      $name = if ($Action -eq 'cancel') { 'Cancel' } else { 'Open' }
      $id = if ($Action -eq 'cancel') { '2' } else { '1' }
      $observe = {
        $script:ChooserFacts.stage = 'verify'
        $currentDialog = Get-Dialog
        $script:ChooserFacts.owned = [bool] ($null -ne $currentDialog)
        $script:ChooserFacts.foreground = $null -ne $currentDialog -and [IbisChooser]::GetForegroundWindow().ToInt64() -eq $currentDialog.Handle
        $observation = @{Owned=$script:ChooserFacts.owned;Foreground=$script:ChooserFacts.foreground;
          SameDialog=($null -ne $currentDialog -and $currentDialog.Handle -eq $dialog.Handle);Targets=@()}
        if (!$observation.Owned -or !$observation.Foreground -or !$observation.SameDialog) { return $observation }
        $script:ChooserFacts.stage = 'tree'
        $elements = @(Get-DialogElements $currentDialog)
        $script:ChooserFacts.stage = 'target'
        $candidates = @($elements | ForEach-Object {
          $current = $_.Current
          if ($current.ControlType -eq [System.Windows.Automation.ControlType]::Button) {
            @{IsButton=$true;Id=$current.AutomationId;Name=$current.Name;Offscreen=$current.IsOffscreen;Enabled=$current.IsEnabled;Element=$_}
          }
        })
        $selection = Select-ChooserTargets $candidates $id $name
        $script:ChooserFacts.selector = $selection.Selector
        $script:ChooserFacts.matches = [Math]::Min($selection.Targets.Count, 4000)
        $observation.Targets = $selection.Targets
        $observation
      }
      # Revalidate PID/owner/foreground immediately before the only mutation.
      $verify = {
        $script:ChooserFacts.stage = 'verify'
        $verified = Get-Dialog
        $script:ChooserFacts.owned = [bool] ($null -ne $verified)
        $script:ChooserFacts.foreground = [IbisChooser]::GetForegroundWindow().ToInt64() -eq $dialog.Handle
        if (!$verified -or $verified.Handle -ne $dialog.Handle -or !$script:ChooserFacts.foreground) {
          throw 'Native chooser ownership changed before action'
        }
      }
      $invoke = {
        param($Button)
        $script:ChooserFacts.stage = 'pattern'
        $pattern = $Button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $script:ChooserFacts.stage = 'invoke'
        $pattern.Invoke()
      }
      Invoke-ReadyChooserAction $observe { [Environment]::TickCount64 } { Start-Sleep -Milliseconds 100 } $verify $invoke
      $true
    }
  }
  ConvertTo-Json -InputObject $result -Compress
} catch {
  # UIA exception text can contain filenames or accessible document text.
  [Console]::Error.WriteLine((Format-ChooserFailure $script:ChooserFacts $_.Exception.Message))
  [Console]::Error.WriteLine('Windows native chooser action failed')
  exit 1
}
