# Owned native file-dialog actions for check-native-chooser.py. No app test API.
param(
  [ValidateSet('state', 'cancel', 'confirm', 'location-state', 'verify-key', 'capture-failure')] [string] $Action = 'state',
  [int] $AppId,
  [long] $PickerHandle,
  [long] $ExpectedDialogHandle,
  [string] $Text,
  [string] $FailureImage,
  [ValidateSet('chooser','picker')] [string] $CaptureKind = 'chooser',
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

# These operations only authorize a keyboard plan. The existing native input
# adapter rechecks the same dialog immediately before sending one key chord.
function Get-ChooserKeyHandle($Dialog, [bool] $Foreground) {
  if (!$Dialog -or !$Foreground) { throw 'Owned native chooser is not foreground' }
  if (($Dialog.Handle -isnot [long] -and $Dialog.Handle -isnot [int]) -or $Dialog.Handle -le 0) {
    throw 'Native chooser ownership changed before action'
  }
  [long] $Dialog.Handle
}

function Get-ChooserKeyPlan([string] $RequestedAction, $Dialog, [bool] $Foreground) {
  if ($RequestedAction -cnotin @('cancel','confirm')) { throw 'Unsupported native chooser key action' }
  $handle = Get-ChooserKeyHandle $Dialog $Foreground
  @{dialog_handle=$handle;key=$(if ($RequestedAction -ceq 'cancel') { 'escape' } else { 'return' })}
}

function Confirm-ChooserKeyWindow($Dialog, [bool] $Foreground, [long] $ExpectedHandle) {
  $handle = Get-ChooserKeyHandle $Dialog $Foreground
  if ($ExpectedHandle -le 0 -or $handle -ne $ExpectedHandle) { throw 'Native chooser ownership changed before action' }
  $true
}

function Get-CommonDialogFocusFacts([long] $Dialog, [int] $Process, [uint32] $Thread, [bool] $Available,
    [uint32] $Flags, [long] $Focus, [bool] $IsChild, [scriptblock] $Resolve) {
  $facts = @{gui_available=($Available -and $Thread -gt 0 -and $Process -gt 0);gui_idle=$false;
    focus_live=$false;focus_visible=$false;focus_enabled=$false;focus_same_pid=$false;focus_same_thread=$false;
    focus_edit=$false;focus_descendant=$false;ancestry_reaches_dialog=$false;filename_id=$false}
  if (!$facts.gui_available) { return $facts }
  $facts.gui_idle = ($Flags -band 30) -eq 0 # move/size and all three menu modes
  $facts.focus_descendant = $IsChild
  if ($Focus -le 0) { return $facts }
  $current = & $Resolve $Focus
  if (!$current) { return $facts }
  $facts.focus_live = $true
  $facts.focus_visible = $current.Visible -is [bool] -and $current.Visible
  $facts.focus_enabled = $current.Enabled -is [bool] -and $current.Enabled
  $facts.focus_same_pid = $current.ProcessId -eq $Process
  $facts.focus_same_thread = $current.Thread -eq $Thread
  $facts.focus_edit = $current.ClassName -ceq 'Edit'
  $seen = [System.Collections.Generic.HashSet[long]]::new()
  for ($depth = 0; $depth -lt 32 -and $current; $depth++) {
    if ($current.Handle -le 0 -or !$seen.Add([long] $current.Handle) -or $current.ProcessId -ne $Process) { break }
    if ($current.Handle -eq $Dialog) { $facts.ancestry_reaches_dialog = $true; break }
    # SDK dlg.h: edt1=1152, cmb13=1148. Modern dialogs are not assumed to
    # expose these legacy IDs: an unknown observed identity stays false.
    if (($current.ControlId -eq 1152 -and $current.ClassName -ceq 'Edit') -or
        ($current.ControlId -eq 1148 -and $current.ClassName -cin @('ComboBox','ComboBoxEx32'))) { $facts.filename_id = $true }
    if ($current.Parent -le 0 -or $depth -eq 31) { break }
    $current = & $Resolve ([long] $current.Parent)
  }
  $facts
}

function Complete-FilenameFocusFacts([hashtable] $Facts) {
  function All([string[]] $Keys) {
    foreach ($key in $Keys) { if ($Facts[$key] -isnot [bool] -or !$Facts[$key]) { return $false } }
    $true
  }
  $guard = All @('owned_before','foreground_before','owned_after','foreground_after')
  $physical = @('gui_idle','focus_live','focus_visible','focus_enabled','focus_same_pid','focus_same_thread','focus_descendant','ancestry_reaches_dialog')
  $Facts.native_ready = $guard -and (All (@('gui_available','focus_edit','filename_id') + $physical))
  # A fresh native query that proves a foreign or invalid recipient must not
  # be overruled by retained accessibility focus. Unknown native IDs alone do
  # not invalidate an independently identified, focused filename UIA edit.
  $conflict = $Facts.gui_available -is [bool] -and $Facts.gui_available -and !(All $physical)
  $Facts.uia_ready = $guard -and !$conflict -and (All @('uia_unique_edit','uia_owned','uia_visible','uia_enabled','uia_filename'))
  $Facts
}

function Observe-FilenameFocus($ExpectedDialog, [scriptblock] $ReadDialog, [scriptblock] $IsForeground,
    [scriptblock] $ReadUia, [scriptblock] $ReadNative) {
  $facts = @{}
  foreach ($key in Filename-FactKeys) { $facts[$key] = $false }
  $before = & $ReadDialog
  $facts.owned_before = $null -ne $before -and $null -ne $ExpectedDialog -and $before.Handle -eq $ExpectedDialog.Handle
  if ($facts.owned_before) {
    $foreground = & $IsForeground $before
    $facts.foreground_before = $foreground -is [bool] -and $foreground
  }
  if ($facts.foreground_before) {
    try {
      $uia = & $ReadUia $before
      foreach ($key in $uia.Keys) { $facts[$key] = $uia[$key] }
    } catch { # The native alternative still needs its complete independent proof.
    }
    $native = & $ReadNative $before
    foreach ($key in $native.Keys) { $facts[$key] = $native[$key] }
  }
  $after = & $ReadDialog
  $facts.owned_after = $null -ne $after -and $null -ne $ExpectedDialog -and $after.Handle -eq $ExpectedDialog.Handle
  if ($facts.owned_after) {
    $foreground = & $IsForeground $after
    $facts.foreground_after = $foreground -is [bool] -and $foreground
  }
  Complete-FilenameFocusFacts $facts
}

function Filename-FactKeys {
  @('owned_before','foreground_before','owned_after','foreground_after','gui_available','gui_idle',
    'focus_live','focus_visible','focus_enabled','focus_same_pid','focus_same_thread','focus_edit','focus_descendant',
    'ancestry_reaches_dialog','filename_id','uia_unique_edit','uia_owned','uia_visible','uia_enabled','uia_filename','native_ready','uia_ready')
}

function Format-FilenameFacts([hashtable] $Facts) {
  $safe = @{}
  foreach ($key in Filename-FactKeys) { $safe[$key] = $Facts[$key] -is [bool] -and $Facts[$key] }
  'NATIVE CHOOSER WINDOWS LOCATION ' + (ConvertTo-Json -InputObject $safe -Compress)
}

function Test-OwnedCaptureView($View) {
  foreach ($key in @('Owned','Foreground','SameDialog')) {
    if ($View[$key] -isnot [bool] -or !$View[$key]) { return $false }
  }
  foreach ($key in @('Left','Top','Width','Height')) { if ($View[$key] -isnot [int]) { return $false } }
  $View.Width -gt 0 -and $View.Height -gt 0 -and $View.Width -le 8192 -and $View.Height -le 8192 -and
    [long] $View.Width * $View.Height -le 33554432
}
function Test-SameCaptureView($First, $Second) {
  if (!(Test-OwnedCaptureView $First) -or !(Test-OwnedCaptureView $Second)) { return $false }
  foreach ($key in @('Left','Top','Width','Height')) { if ($First[$key] -ne $Second[$key]) { return $false } }
  $true
}
function Read-CaptureSubject([string] $Kind, [scriptblock] $Chooser, [scriptblock] $Picker) {
  switch -CaseSensitive ($Kind) {
    'chooser' { & $Chooser }
    'picker' { & $Picker }
    default { throw 'Unknown failure capture kind' }
  }
}
function Save-OwnedChooserFailure([string] $Destination, [scriptblock] $Observe, [scriptblock] $Capture) {
  if ([string]::IsNullOrWhiteSpace($Destination)) { return }
  try {
    $view = & $Observe
    if (!(Test-OwnedCaptureView $view)) { return }
    $fresh = & $Observe
    if (!(Test-SameCaptureView $view $fresh)) { return }
    & $Capture $fresh $Destination | Out-Null
  } catch {
    # Failure evidence must never replace the original helper failure.
  }
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
  foreach ($action in @('cancel','confirm')) {
    $plan = Get-ChooserKeyPlan $action $windows[20] $true
    $expectedKey = if ($action -ceq 'cancel') { 'escape' } else { 'return' }
    if ([string]::Join(',', @($plan.Keys | Sort-Object)) -cne 'dialog_handle,key' -or
        $plan.dialog_handle -isnot [long] -or $plan.dialog_handle -ne 20 -or $plan.key -cne $expectedKey) {
      throw 'Chooser keyboard plan regression failed'
    }
  }
  if (!(Confirm-ChooserKeyWindow $windows[20] $true 20)) { throw 'Owned chooser keyboard guard failed' }
  Reject { Get-ChooserKeyPlan 'other' $windows[20] $true } 'Unsupported native chooser key action'
  Reject { Get-ChooserKeyPlan 'cancel' $null $true } 'Owned native chooser is not foreground'
  Reject { Get-ChooserKeyPlan 'cancel' $windows[20] $false } 'Owned native chooser is not foreground'
  Reject { Confirm-ChooserKeyWindow $windows[20] $true 21 } 'Native chooser ownership changed before action'
  Reject { Confirm-ChooserKeyWindow $windows[20] $true 0 } 'Native chooser ownership changed before action'
  Reject { Confirm-ChooserKeyWindow $null $true 20 } 'Owned native chooser is not foreground'
  Reject { Confirm-ChooserKeyWindow $windows[20] $false 20 } 'Owned native chooser is not foreground'
  foreach ($badHandle in @(0,-1,'20',$true,$null)) {
    $invalidWindow = @{Handle=$badHandle}
    Reject { Get-ChooserKeyPlan 'cancel' $invalidWindow $true } 'Native chooser ownership changed before action'
  }
  $focusWindows = @{
    20=@{Handle=20;ProcessId=41;Thread=7;ClassName='#32770';ControlId=0;Parent=0;Visible=$true;Enabled=$true}
    90=@{Handle=90;ProcessId=41;Thread=7;ClassName='ComboBox';ControlId=1148;Parent=20;Visible=$true;Enabled=$true}
    100=@{Handle=100;ProcessId=41;Thread=7;ClassName='Edit';ControlId=1001;Parent=90;Visible=$true;Enabled=$true}
  }
  $resolveFocus = { param($Handle) $focusWindows[[int] $Handle] }.GetNewClosure()
  function Readiness($Native, [bool] $Uia = $false) {
    $facts = $Native.Clone()
    foreach ($key in @('owned_before','foreground_before','owned_after','foreground_after')) { $facts[$key] = $true }
    foreach ($key in @('uia_unique_edit','uia_owned','uia_visible','uia_enabled','uia_filename')) { $facts[$key] = $Uia }
    Complete-FilenameFocusFacts $facts
  }
  $native = Get-CommonDialogFocusFacts 20 41 7 $true 0 100 $true $resolveFocus
  if (!(Readiness $native).native_ready) { throw 'Common dialog filename combo focus was rejected' }
  $focusWindows[100].ControlId = 1152; $focusWindows[100].Parent = 20
  if (!(Readiness (Get-CommonDialogFocusFacts 20 41 7 $true 0 100 $true $resolveFocus)).native_ready) {
    throw 'Common dialog filename edit focus was rejected'
  }
  $focusWindows[100].ControlId = 1001; $focusWindows[100].Parent = 90
  $focusWindows[90].ControlId = 42
  if ((Readiness (Get-CommonDialogFocusFacts 20 41 7 $true 0 100 $true $resolveFocus)).native_ready) { throw 'Unknown filename identity was accepted' }
  $focusWindows[90].ControlId = 1148
  foreach ($property in @('ProcessId','Thread','Visible','Enabled','ClassName')) {
    $original = $focusWindows[100][$property]
    $focusWindows[100][$property] = switch ($property) { 'ProcessId' {42} 'Thread' {8} 'ClassName' {'Button'} default {$false} }
    if ((Readiness (Get-CommonDialogFocusFacts 20 41 7 $true 0 100 $true $resolveFocus)).native_ready) { throw 'Foreign or invalid focused edit was accepted' }
    $focusWindows[100][$property] = $original
  }
  foreach ($flags in @(2,4,8,16)) {
    $facts = Readiness (Get-CommonDialogFocusFacts 20 41 7 $true $flags 100 $true $resolveFocus) $true
    if ($facts.native_ready -or $facts.uia_ready) { throw 'Menu or move mode was accepted as filename focus' }
  }
  $outside = Readiness (Get-CommonDialogFocusFacts 20 41 7 $true 0 100 $false $resolveFocus) $true
  if ($outside.native_ready -or $outside.uia_ready) { throw 'A focused edit outside the exact dialog was accepted' }
  $focusWindows[90].Parent = 90
  if ((Readiness (Get-CommonDialogFocusFacts 20 41 7 $true 0 100 $true $resolveFocus)).native_ready) { throw 'Cyclic filename ancestry was accepted' }
  $focusWindows[90].Parent = 20
  $focusWindows[90].ProcessId = 42
  if ((Readiness (Get-CommonDialogFocusFacts 20 41 7 $true 0 100 $true $resolveFocus) $true).uia_ready) { throw 'Foreign filename ancestry was accepted through stale UIA focus' }
  $focusWindows[90].ProcessId = 41
  $fresh = Readiness $native
  foreach ($key in @('owned_before','foreground_before','owned_after','foreground_after')) {
    $changed = $fresh.Clone(); $changed[$key] = $false
    $changed = Complete-FilenameFocusFacts $changed
    if ($changed.native_ready -or $changed.uia_ready) { throw 'Lost dialog identity or foreground after focus query was accepted' }
  }
  $unavailable = Get-CommonDialogFocusFacts 20 41 7 $false 0 0 $false $resolveFocus
  if (!(Readiness $unavailable $true).uia_ready) { throw 'Strict UIA filename focus was rejected' }
  $ambiguous = Readiness $unavailable $true; $ambiguous.uia_unique_edit = $false
  if ((Complete-FilenameFocusFacts $ambiguous).uia_ready) { throw 'Ambiguous UIA filename focus was accepted' }
  $observations = [System.Collections.Generic.List[string]]::new()
  $readChangingDialog = {
    [void] $observations.Add('dialog')
    @{Handle=$(if ($observations.Count -eq 1) { 20 } else { 21 })}
  }
  $readUia = { param($Window) [void] $observations.Add('uia'); @{} }
  $readNative = { param($Window) [void] $observations.Add('native'); $native }
  $observed = Observe-FilenameFocus @{Handle=20} $readChangingDialog { param($Window) $true } $readUia $readNative
  if ($observed.native_ready -or $observed.uia_ready -or ($observations -join ',') -cne 'dialog,uia,native,dialog') {
    throw 'Filename focus omitted the fresh dialog guard after its queries'
  }
  $observations.Clear()
  $readStableDialog = { [void] $observations.Add('dialog'); @{Handle=20} }
  $changedForeground = { param($Window) $observations.Count -eq 1 }
  $observed = Observe-FilenameFocus @{Handle=20} $readStableDialog $changedForeground $readUia $readNative
  if ($observed.native_ready -or $observed.uia_ready) { throw 'Filename focus accepted lost foreground after its queries' }
  $deep = @{}
  foreach ($handle in 100..134) {
    $deep[$handle] = @{Handle=$handle;ProcessId=41;Thread=7;ClassName='Edit';ControlId=1152;Parent=($handle+1);Visible=$true;Enabled=$true}
  }
  $deep[134].Parent = 20
  $script:focusReads = 0
  $resolveDeep = { param($Handle) $script:focusReads++; $deep[[int] $Handle] }
  if ((Readiness (Get-CommonDialogFocusFacts 20 41 7 $true 0 100 $true $resolveDeep)).native_ready -or $script:focusReads -gt 32) {
    throw 'Filename focus accepted an unbounded ancestor chain'
  }
  $safeFacts = Format-FilenameFacts @{focus_edit='private provider text';payload='private'}
  if ($safeFacts.Contains('private')) { throw 'Filename focus diagnostic exposed provider text' }
  $safeFields = $safeFacts.Substring('NATIVE CHOOSER WINDOWS LOCATION '.Length) | ConvertFrom-Json
  if ([string]::Join(',', @($safeFields.PSObject.Properties.Name | Sort-Object)) -cne
      [string]::Join(',', @(Filename-FactKeys | Sort-Object))) { throw 'Filename focus diagnostic schema changed' }
  foreach ($property in $safeFields.PSObject.Properties) {
    if ($property.Value -isnot [bool] -or $property.Value) { throw 'Filename focus diagnostic coerced provider text' }
  }
  $facts = @{stage='target';matches=2;enumerated=12;owned=$true;foreground=$true;selector=@{buttons=3;exact_id=2;exact_name=2;offscreen=1;eligible=1}}
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
  $script:chooserReads=0; $script:pickerReads=0
  $chooserCapture = { $script:chooserReads++; throw 'No chooser' }
  $pickerCapture = { $script:pickerReads++; @{Owned=$true} }
  if (!(Read-CaptureSubject 'picker' $chooserCapture $pickerCapture).Owned -or $script:chooserReads -ne 0 -or $script:pickerReads -ne 1) {
    throw 'Explicit picker capture inspected the chooser'
  }
  try { Read-CaptureSubject 'chooser' $chooserCapture $pickerCapture | Out-Null } catch { }
  if ($script:pickerReads -ne 1) { throw 'Chooser capture fell back to picker' }
  $script:readNumber = 0; $script:unsafeCaptures = 0
  $moving = { $script:readNumber++; @{Owned=$true;Foreground=$true;SameDialog=$true;Left=$script:readNumber;Top=0;Width=800;Height=600} }
  Save-OwnedChooserFailure 'synthetic.png' $moving { $script:unsafeCaptures++ }
  if ($script:unsafeCaptures -ne 0) { throw 'Changed failure rectangle was captured' }
  $script:readNumber = 0
  $lostForeground = { $script:readNumber++; @{Owned=$true;Foreground=($script:readNumber -eq 1);SameDialog=$true;Left=0;Top=0;Width=800;Height=600} }
  Save-OwnedChooserFailure 'synthetic.png' $lostForeground { $script:unsafeCaptures++ }
  if ($script:unsafeCaptures -ne 0) { throw 'Failure capture omitted fresh foreground guard' }
  $script:captures = 0
  $script:captureObservations = 0
  $captureView = @{Owned=$true;Foreground=$true;SameDialog=$true;Left=0;Top=0;Width=800;Height=600}
  $readCapture = { $script:captureObservations++; $captureView }
  $capture = { param($View,$Destination) $script:captures++; if ($Destination -cne 'synthetic.png') { throw 'Wrong failure destination' } }
  Save-OwnedChooserFailure 'synthetic.png' $readCapture $capture
  if ($script:captures -ne 1) { throw 'Owned chooser failure image was not captured' }
  foreach ($key in @('Owned','Foreground','SameDialog')) {
    $captureView[$key] = $false
    Save-OwnedChooserFailure 'synthetic.png' $readCapture $capture
    $captureView[$key] = $true
  }
  foreach ($size in @(@(0,600),@(-1,600),@(8193,600),@(8192,8192))) {
    $captureView.Width = $size[0]; $captureView.Height = $size[1]
    Save-OwnedChooserFailure 'synthetic.png' $readCapture $capture
  }
  $captureView.Width = 800; $captureView.Height = 600
  $beforeMissingDestination = $script:captureObservations
  Save-OwnedChooserFailure '' $readCapture $capture
  if ($script:captureObservations -ne $beforeMissingDestination) { throw 'Missing destination inspected windows' }
  Save-OwnedChooserFailure 'synthetic.png' { throw 'Unavailable provider' } $capture
  Save-OwnedChooserFailure 'synthetic.png' $readCapture { throw 'Unavailable screenshot' }
  if ($script:captures -ne 1) { throw 'Unverified chooser failure image was captured' }
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
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct GuiThreadInfo {
    public uint Size, Flags;
    public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
    public Rect CaretRect;
  }
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rectangle);
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
  public static uint ThreadId(IntPtr window) { uint process; return GetWindowThreadProcessId(window, out process); }
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
  function Get-OwnedCaptureView {
    $subject = Read-CaptureSubject $CaptureKind {
      $currentDialog = Get-Dialog
      if (!$currentDialog -or !$dialog -or $currentDialog.Handle -ne $dialog.Handle) { return $null }
      $currentDialog
    } {
      $picker = Get-WindowInfo $PickerHandle
      if (!$picker -or $AppId -le 0 -or $picker.ProcessId -ne $AppId -or !$picker.Visible) { return $null }
      $picker
    }
    if (!$subject -or !$subject.Visible -or [IbisChooser]::GetForegroundWindow().ToInt64() -ne $subject.Handle) { return @{} }
    $rectangle = [IbisChooser+Rect]::new()
    if (![IbisChooser]::GetWindowRect([IntPtr]::new($subject.Handle),[ref] $rectangle)) { return @{} }
    # Re-read the same exact live HWND and PID after the rectangle query.
    $fresh = Get-WindowInfo $subject.Handle
    if (!$fresh -or $fresh.ProcessId -ne $AppId -or !$fresh.Visible -or
        [IbisChooser]::GetForegroundWindow().ToInt64() -ne $subject.Handle) { return @{} }
    @{Owned=$true;SameDialog=$true;Foreground=$true;Left=$rectangle.Left;Top=$rectangle.Top;
      Width=($rectangle.Right - $rectangle.Left);Height=($rectangle.Bottom - $rectangle.Top)}
  }
  function Save-ChooserFailureImage {
    Save-OwnedChooserFailure $FailureImage { Get-OwnedCaptureView } {
      param($View,$Destination)
      Add-Type -AssemblyName System.Drawing
      $bitmap = $null; $graphics = $null; $stream = $null
      try {
        $bitmap = [System.Drawing.Bitmap]::new($View.Width,$View.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        # Assembly/bitmap setup may take time; guard again adjacent to capture.
        if (!(Test-SameCaptureView $View (Get-OwnedCaptureView))) { return }
        $graphics.CopyFromScreen([System.Drawing.Point]::new($View.Left,$View.Top),[System.Drawing.Point]::Empty,$bitmap.Size)
        $stream = [System.IO.File]::Open($Destination,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None)
        $bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
        $script:CaptureSucceeded = $true
      } finally {
        if ($stream) { $stream.Dispose() }
        if ($graphics) { $graphics.Dispose() }
        if ($bitmap) { $bitmap.Dispose() }
      }
    }
  }
  function Get-UiaFilenameFocusFacts($Elements) {
    $facts = @{uia_unique_edit=$false;uia_owned=$false;uia_visible=$false;uia_enabled=$false;uia_filename=$false}
    $focused = @($Elements | Where-Object {
      $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.HasKeyboardFocus
    })
    $facts.uia_unique_edit = $focused.Count -eq 1
    if (!$facts.uia_unique_edit) { return $facts }
    $info = $focused[0].Current
    $facts.uia_owned = $info.ProcessId -eq $AppId
    $facts.uia_visible = !$info.IsOffscreen
    $facts.uia_enabled = $info.IsEnabled
    $filename = $info.Name -ceq 'File name:' -or $info.Name -ceq 'File name'
    $withinRoot = $false
    $element = $focused[0]
    for ($depth = 0; $depth -lt 32 -and $null -ne $element; $depth++) {
      if ($element.Equals($Elements[0])) { $withinRoot = $true; break }
      $current = $element.Current
      if ($current.AutomationId -ceq '1148' -or $current.AutomationId -ceq 'FileNameControlHost') { $filename = $true }
      $element = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($element)
    }
    $facts.uia_filename = $withinRoot -and $filename
    $facts
  }
  function Get-FocusWindowInfo([long] $Handle) {
    $window = [IntPtr]::new($Handle)
    if (![IbisChooser]::IsWindow($window)) { return $null }
    @{Handle=$Handle;ProcessId=[IbisChooser]::ProcessId($window);Thread=[IbisChooser]::ThreadId($window);
      ClassName=[IbisChooser]::ClassName($window);ControlId=[IbisChooser]::GetDlgCtrlID($window);
      Parent=[IbisChooser]::GetAncestor($window,1).ToInt64();
      Visible=[IbisChooser]::IsWindowVisible($window);Enabled=[IbisChooser]::IsWindowEnabled($window)}
  }
  function Get-FilenameFocusFacts($ExpectedDialog) {
    Observe-FilenameFocus $ExpectedDialog { Get-Dialog } {
      param($Window) [IbisChooser]::GetForegroundWindow().ToInt64() -eq $Window.Handle
    } {
      param($Window) Get-UiaFilenameFocusFacts @(Get-DialogElements $Window)
    } {
      param($Window)
      $thread = [IbisChooser]::ThreadId([IntPtr]::new($Window.Handle))
      $info = [IbisChooser+GuiThreadInfo]::new()
      $info.Size = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
      $available = $thread -gt 0 -and [IbisChooser]::GetGUIThreadInfo($thread,[ref] $info)
      $isChild = $available -and [IbisChooser]::IsChild([IntPtr]::new($Window.Handle),$info.Focus)
      Get-CommonDialogFocusFacts $Window.Handle $AppId $thread $available $info.Flags $info.Focus.ToInt64() $isChild {
        param($Handle) Get-FocusWindowInfo $Handle
      }
    }
  }
  $script:ChooserFacts.stage = 'resolve'
  $dialog = if ($Action -ceq 'capture-failure' -and $CaptureKind -ceq 'picker') { $null } else { Get-Dialog }
  $script:ChooserFacts.owned = [bool] ($null -ne $dialog)
  $foreground = $null -ne $dialog -and [IbisChooser]::GetForegroundWindow().ToInt64() -eq $dialog.Handle
  $script:ChooserFacts.foreground = [bool] $foreground
  $result = switch ($Action) {
    'state' { @{visible=($null -ne $dialog);foreground=[bool] $foreground;owned=($null -ne $dialog)} }
    'location-state' {
      $script:ChooserFacts.stage = 'tree'
      $facts = Get-FilenameFocusFacts $dialog
      [Console]::Error.WriteLine((Format-FilenameFacts $facts))
      @{ready=($facts.native_ready -or $facts.uia_ready);owned=$facts.owned_after}
    }
    'capture-failure' {
      $script:CaptureSucceeded = $false
      Save-ChooserFailureImage
      @{captured=$script:CaptureSucceeded}
    }
    'cancel' { Get-ChooserKeyPlan 'cancel' $dialog $foreground }
    'confirm' { Get-ChooserKeyPlan 'confirm' $dialog $foreground }
    'verify-key' {
      $script:ChooserFacts.stage = 'verify'
      Confirm-ChooserKeyWindow $dialog $foreground $ExpectedDialogHandle
    }
  }
  ConvertTo-Json -InputObject $result -Compress
} catch {
  # UIA exception text can contain filenames or accessible document text.
  $originalFailure = $_.Exception.Message
  [Console]::Error.WriteLine((Format-ChooserFailure $script:ChooserFacts $originalFailure))
  if (Get-Command Save-ChooserFailureImage -ErrorAction SilentlyContinue) { Save-ChooserFailureImage }
  [Console]::Error.WriteLine('Windows native chooser action failed')
  exit 1
}
