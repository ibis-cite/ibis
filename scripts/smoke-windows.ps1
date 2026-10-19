# UI Automation reads/invokes controls; SendInput exercises the actual shortcut
# and typing path. Called by smoke-native.py, not a test-mode application API.
param([string] $Action, [int] $AppId, [int] $EditorId, [string] $Text, [switch] $SelfTest)
$ErrorActionPreference = 'Stop'

function Invoke-GuardedDialogKey([string] $Payload, [scriptblock] $Verify, [scriptblock] $Send) {
  try { $plan = ConvertFrom-Json -InputObject $Payload -AsHashtable -ErrorAction Stop }
  catch { throw 'Invalid native dialog keyboard plan' }
  if ($plan -isnot [System.Collections.IDictionary] -or $plan.Count -ne 3 -or
      $plan.Keys -cnotcontains 'dialog_handle' -or $plan.Keys -cnotcontains 'picker_handle' -or $plan.Keys -cnotcontains 'key') {
    throw 'Invalid native dialog keyboard plan'
  }
  foreach ($field in @('dialog_handle','picker_handle')) {
    if (($plan[$field] -isnot [int] -and $plan[$field] -isnot [long]) -or $plan[$field] -le 0) {
      throw 'Invalid native dialog keyboard plan'
    }
  }
  if ($plan.key -isnot [string] -or $plan.key -cnotin @('escape','return')) { throw 'Invalid native dialog keyboard plan' }
  $verified = & $Verify $plan
  if ($verified -isnot [bool] -or !$verified) { throw 'Native dialog keyboard ownership was not acknowledged' }
  & $Send $plan.key | Out-Null
  $true
}

function Test-GuardedDialogKey {
  $events = [System.Collections.Generic.List[string]]::new()
  $verify = { param($Plan) [void] $events.Add('verify'); $true }.GetNewClosure()
  $send = { param($Key) [void] $events.Add("send:$Key") }.GetNewClosure()
  foreach ($key in @('escape','return')) {
    $events.Clear()
    $plan = @{dialog_handle=20;picker_handle=10;key=$key} | ConvertTo-Json -Compress
    if ((Invoke-GuardedDialogKey $plan $verify $send) -isnot [bool] -or
        ($events -join ',') -cne "verify,send:$key") { throw 'Guarded native key order regression failed' }
  }
  foreach ($invalid in @('null','true','{}','{"dialog_handle":true,"picker_handle":10,"key":"escape"}',
      '{"dialog_handle":20,"picker_handle":0,"key":"escape"}',
      '{"dialog_handle":20,"picker_handle":10,"key":"alt+f4"}',
      '{"dialog_handle":20,"picker_handle":10,"key":"return","extra":1}')) {
    $events.Clear()
    $rejected = $false
    try { Invoke-GuardedDialogKey $invalid $verify $send | Out-Null } catch { $rejected = $true }
    if (!$rejected -or $events.Count -ne 0) { throw 'Invalid dialog plan reached native input' }
  }
  foreach ($ack in @($false,1,'true',$null)) {
    $events.Clear()
    $badVerify = { param($Plan) [void] $events.Add('verify'); $ack }.GetNewClosure()
    $rejected = $false
    try { Invoke-GuardedDialogKey '{"dialog_handle":20,"picker_handle":10,"key":"return"}' $badVerify $send | Out-Null } catch { $rejected = $true }
    if (!$rejected -or ($events -join ',') -cne 'verify') { throw 'Unverified dialog reached native input' }
  }
  $events.Clear()
  $rejected = $false
  $lost = { param($Plan) [void] $events.Add('verify'); throw 'Owned dialog changed' }.GetNewClosure()
  try { Invoke-GuardedDialogKey '{"dialog_handle":20,"picker_handle":10,"key":"escape"}' $lost $send | Out-Null } catch { $rejected = $true }
  if (!$rejected -or ($events -join ',') -cne 'verify') { throw 'Lost dialog reached native input' }
}
# Keyboard readiness is separate from the diagnostic UIA role/name snapshot.
# Every positive path requires stable native child focus around fresh UIA reads.
function New-PickerKeyboardFacts {
  @{available=$false;owned_picker=$false;native_child_focus=$false;unique_search=$false;unique_results=$false;
    direct_search_focus=$false;controller_for_results=$false;controlled_results_focus=$false;ready=$false}
}
# Observation fields are never readiness inputs. False can mean unqueried when
# an earlier original guard short-circuited; stage/exception retain that context.
function New-NativeKeyboardObservation {
  @{stage='unobserved';exception=$false;owned=$false;gui_available=$false;gui_idle=$false;active_picker=$false;
    focus_present=$false;focus_is_picker=$false;focus_live=$false;focus_visible=$false;focus_strict_child=$false;
    focus_pid_matches=$false;focus_thread_matches=$false}
}
function New-UiaKeyboardObservation {
  @{stage='unobserved';exception=$false;root_identity=$false;enumeration_complete=$false;search_matches=0;results_matches=0;
    search_owned=$false;results_owned=$false;focused_present=$false;focused_owned=$false;focused_is_search=$false;
    focused_is_results=$false;focused_is_picker=$false;final_focus_same=$false;final_owned=$false;
    ownership_pid_mismatch=$false;ownership_offscreen=$false;ownership_disabled=$false;ownership_walk_failed=$false}
}
function New-KeyboardObservation {
  @{native_before=(New-NativeKeyboardObservation);native_after=(New-NativeKeyboardObservation);focus_stable=$false;uia=(New-UiaKeyboardObservation)}
}
function Set-KeyboardIdentityObservation($Observation,[string] $Field,[scriptblock] $Compare) {
  try { $value=& $Compare; $Observation[$Field]=$value -is [bool] -and $value }
  catch { $Observation.exception=$true }
}
function Observe-PickerKeyboardFocus([scriptblock] $ReadNative, [scriptblock] $ReadUia, $Observation = $null) {
  if ($null -eq $Observation) { $Observation=New-KeyboardObservation }
  $facts = New-PickerKeyboardFacts
  try {
    $before = & $ReadNative $Observation.native_before
    if (!$before.owned) { return $facts }
    $uia = & $ReadUia $Observation.uia
    $after = & $ReadNative $Observation.native_after
    $Observation.focus_stable = $before.focus -gt 0 -and $before.focus -eq $after.focus
    if (!$after.owned -or $before.handle -ne $after.handle -or $before.thread -ne $after.thread) { return $facts }
    $facts.owned_picker = $true
    $facts.native_child_focus = $before.available -and $after.available -and $before.child -and $after.child -and
      $before.focus -gt 0 -and $before.focus -ne $before.handle -and $before.focus -eq $after.focus
    foreach ($field in @('available','unique_search','unique_results','direct_search_focus','controller_for_results','controlled_results_focus')) {
      $facts[$field] = $uia[$field] -is [bool] -and $uia[$field]
    }
    $facts.available = $facts.available -and $before.available -and $after.available
    $facts.ready = $facts.available -and $facts.owned_picker -and $facts.native_child_focus -and $facts.unique_search -and
      ($facts.direct_search_focus -or ($facts.unique_results -and $facts.controller_for_results -and $facts.controlled_results_focus))
    $facts
  } catch { New-PickerKeyboardFacts }
}
function Test-FocusedAncestry($Focused, $Target, [scriptblock] $Parent, [scriptblock] $Same, [scriptblock] $Owned) {
  $seen = [System.Collections.Generic.List[object]]::new()
  $current = $Focused
  for ($depth = 0; $depth -le 32 -and $null -ne $current; $depth++) {
    if (!(& $Owned $current)) { return $false }
    foreach ($previous in $seen) { if (& $Same $current $previous) { return $false } }
    if (& $Same $current $Target) { return $true }
    [void] $seen.Add($current)
    if ($depth -eq 32) { return $false }
    $current = & $Parent $current
  }
  $false
}
function Observe-PickerUiaFocus([object[]] $Searches, [object[]] $Results, [scriptblock] $ReadFocused,
    [scriptblock] $Controllers, [scriptblock] $Parent, [scriptblock] $Same, [scriptblock] $Owned,
    $Observation = $null, $Root = $null) {
  if ($null -eq $Observation) { $Observation=New-UiaKeyboardObservation }
  $facts = New-PickerKeyboardFacts
  try {
    $Observation.search_matches = if ($Searches.Count -le 4000) { [int] $Searches.Count } else { 0 }
    $Observation.results_matches = if ($Results.Count -le 4000) { [int] $Results.Count } else { 0 }
    $Observation.stage='focused'
    $focused = & $ReadFocused
    $Observation.focused_present = $null -ne $focused
    if ($null -ne $focused) {
      if ($null -ne $Root) { Set-KeyboardIdentityObservation $Observation 'focused_is_picker' { & $Same $focused $Root } }
      if ($Searches.Count -eq 1) { Set-KeyboardIdentityObservation $Observation 'focused_is_search' { & $Same $focused $Searches[0] } }
      if ($Results.Count -eq 1) { Set-KeyboardIdentityObservation $Observation 'focused_is_results' { & $Same $focused $Results[0] } }
    }
    $Observation.stage='ownership'
    $facts.unique_search = $Searches.Count -eq 1 -and (& $Owned $Searches[0])
    $Observation.search_owned = $facts.unique_search
    $facts.unique_results = $Results.Count -eq 1 -and (& $Owned $Results[0])
    $Observation.results_owned = $facts.unique_results
    $focusedOwned = $facts.unique_search -and $null -ne $focused -and (& $Owned $focused)
    $Observation.focused_owned = [bool] $focusedOwned
    if ($focusedOwned) {
      $facts.direct_search_focus = [bool] (& $Same $focused $Searches[0])
      if ($facts.unique_results -and !$facts.direct_search_focus) {
        $Observation.stage='relation'
        # Missing ControllerFor capability disables only the virtual-focus path.
        $targets = $null
        try { $targets = & $Controllers $Searches[0] $Results[0] $focused } catch { $Observation.exception=$true }
        $facts.controller_for_results = $targets -is [bool] -and $targets
        if ($facts.controller_for_results) {
          $Observation.stage='ancestry'
          $facts.controlled_results_focus = Test-FocusedAncestry $focused $Results[0] $Parent $Same $Owned
          if (!$facts.controlled_results_focus) { $Observation.ownership_walk_failed=$true }
        }
      }
    }
    $Observation.stage='final'
    $last = & $ReadFocused
    $sameFocus = $null -ne $focused -and $null -ne $last -and (& $Same $focused $last)
    $Observation.final_focus_same = [bool] $sameFocus
    $finalOwned = $sameFocus -and (& $Owned $last) -and
      (!$facts.unique_search -or (& $Owned $Searches[0])) -and (!$facts.unique_results -or (& $Owned $Results[0]))
    $Observation.final_owned = [bool] $finalOwned
    if (!$finalOwned) { return (New-PickerKeyboardFacts) }
    $facts.available = $true
    $Observation.stage='complete'
    $facts
  } catch { $Observation.exception=$true; New-PickerKeyboardFacts }
}

function Read-PickerNativeFocus([IntPtr] $Handle, $Observation = $null) {
  if ($null -eq $Observation) { $Observation=New-NativeKeyboardObservation }
  $state = @{owned=$false;available=$false;handle=$Handle.ToInt64();thread=0;focus=0;child=$false}
  try {
    $Observation.stage='picker'
    if ($AppId -le 0 -or $Handle.ToInt64() -le 0 -or ![IbisSmoke]::IsWindow($Handle) -or
        [IbisSmoke]::OwnerPid($Handle) -ne $AppId -or ![IbisSmoke]::IsWindowVisible($Handle) -or
        [IbisSmoke]::GetForegroundWindow() -ne $Handle) { return $state }
    [uint32] $owner = 0
    $thread = [IbisSmoke]::GetWindowThreadProcessId($Handle,[ref] $owner)
    if ($owner -ne $AppId -or $thread -eq 0) { return $state }
    $state.owned = $true; $state.thread = $thread
    $info = [IbisSmoke+GUITHREADINFO]::new()
    $info.Size = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
    $Observation.stage='gui'
    # Zero queries the foreground thread, never a remembered background queue.
    $state.available = [IbisSmoke]::GetGUIThreadInfo(0,[ref] $info)
    $Observation.gui_available=$state.available
    if ($state.available) {
      $Observation.stage='focus'
      $state.focus = $info.Focus.ToInt64()
      [uint32] $focusOwner = 0
      $focusThread = [IbisSmoke]::GetWindowThreadProcessId($info.Focus,[ref] $focusOwner)
      $Observation.focus_present=$info.Focus -ne [IntPtr]::Zero
      $Observation.focus_is_picker=$info.Focus -eq $Handle
      $Observation.active_picker=$info.Active -eq $Handle
      $Observation.gui_idle=($info.Flags -band 30) -eq 0
      $Observation.focus_pid_matches=$focusOwner -eq $AppId
      $Observation.focus_thread_matches=$focusThread -eq $thread
      # Assign only where the original expression queried the predicate. An
      # earlier false guard must not cause extra Win32 observations.
      $state.child = $info.Focus -ne [IntPtr]::Zero -and $info.Focus -ne $Handle -and
        $info.Active -eq $Handle -and ($info.Flags -band 30) -eq 0 -and
        ($Observation.focus_live=[IbisSmoke]::IsWindow($info.Focus)) -and
        ($Observation.focus_visible=[IbisSmoke]::IsWindowVisible($info.Focus)) -and
        $focusOwner -eq $AppId -and $focusThread -eq $thread -and
        ($Observation.focus_strict_child=[IbisSmoke]::IsChild($Handle,$info.Focus))
    }
    $phase=$Observation.stage
    $Observation.stage='picker'
    [uint32] $lastOwner = 0
    $lastThread = [IbisSmoke]::GetWindowThreadProcessId($Handle,[ref] $lastOwner)
    $state.owned = [IbisSmoke]::IsWindow($Handle) -and [IbisSmoke]::IsWindowVisible($Handle) -and
      $lastOwner -eq $AppId -and $lastThread -eq $thread -and [IbisSmoke]::GetForegroundWindow() -eq $Handle
    if (!$state.owned) { $state.child = $false }
    $Observation.stage=if ($state.child) { 'complete' } elseif ($state.owned) { $phase } else { 'picker' }
    $state
  } catch { $Observation.exception=$true; throw }
  finally { $Observation.owned=[bool] $state.owned }
}
function Initialize-PickerProjection([string] $SelfTestDefinitions = '') {
  # Public Windows SDK UIAutomationClient.idl prefixes; unused pointer arguments
  # retain their ABI types. No mutating method in these prefixes is called.
  $definition = @'
using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct IbisUiaPoint { public int X,Y; }
[ComImport,Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IbisUiaAutomation {
  [PreserveSig] int CompareElements(IbisUiaElement left,IbisUiaElement right,[MarshalAs(UnmanagedType.Bool)] out bool same);
  [PreserveSig] int CompareRuntimeIds([MarshalAs(UnmanagedType.SafeArray,SafeArraySubType=VarEnum.VT_I4)] int[] left,[MarshalAs(UnmanagedType.SafeArray,SafeArraySubType=VarEnum.VT_I4)] int[] right,[MarshalAs(UnmanagedType.Bool)] out bool same);
  [PreserveSig] int GetRootElement(out IbisUiaElement element);
  [PreserveSig] int ElementFromHandle(IntPtr hwnd,out IbisUiaElement element);
  [PreserveSig] int ElementFromPoint(IbisUiaPoint point,out IbisUiaElement element);
  [PreserveSig] int GetFocusedElement(out IbisUiaElement element);
}
[ComImport,Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IbisUiaElement {
  [PreserveSig] int SetFocus();
  [PreserveSig] int GetRuntimeId([MarshalAs(UnmanagedType.SafeArray,SafeArraySubType=VarEnum.VT_I4)] out int[] id);
  [PreserveSig] int FindFirst(int scope,IntPtr condition,out IbisUiaElement element);
  [PreserveSig] int FindAll(int scope,IntPtr condition,out IbisUiaArray elements);
  [PreserveSig] int FindFirstBuildCache(int scope,IntPtr condition,IntPtr cache,out IbisUiaElement element);
  [PreserveSig] int FindAllBuildCache(int scope,IntPtr condition,IntPtr cache,out IbisUiaArray elements);
  [PreserveSig] int BuildUpdatedCache(IntPtr cache,out IbisUiaElement element);
  [PreserveSig] int GetCurrentPropertyValue(int property,[MarshalAs(UnmanagedType.Struct)] out object value);
  [PreserveSig] int GetCurrentPropertyValueEx(int property,[MarshalAs(UnmanagedType.Bool)] bool ignoreDefault,[MarshalAs(UnmanagedType.Struct)] out object value);
}
[ComImport,Guid("14314595-b4bc-4055-95f2-58f2e42c9855"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IbisUiaArray {
  [PreserveSig] int get_Length(out int length);
  [PreserveSig] int GetElement(int index,out IbisUiaElement element);
}
public static class IbisPickerProjection {
  static bool ValidId(int[] id) { return id!=null && id.Length>0 && id.Length<=64; }
  static bool SameId(int[] left,int[] right) {
    if(!ValidId(left) || !ValidId(right) || left.Length!=right.Length) return false;
    for(int i=0;i<left.Length;i++) if(left[i]!=right[i]) return false;
    return true;
  }
  static bool Bound(IbisUiaElement element,int pid,int[] expected) {
    if(element==null) return false;
    int[] id; object owner;
    return element.GetRuntimeId(out id)>=0 && SameId(id,expected) &&
      element.GetCurrentPropertyValueEx(30002,true,out owner)>=0 && owner is int && (int)owner==pid;
  }
  public static bool TryPoint(double x,double y,double width,double height,out IbisUiaPoint point) {
    point=new IbisUiaPoint();
    if(double.IsNaN(x)||double.IsNaN(y)||double.IsNaN(width)||double.IsNaN(height)||
      double.IsInfinity(x)||double.IsInfinity(y)||double.IsInfinity(width)||double.IsInfinity(height)||
      width<=0||height<=0||width>8192||height>8192||width*height>33554432) return false;
    double cx=Math.Floor(x+width/2), cy=Math.Floor(y+height/2);
    if(cx<int.MinValue||cx>int.MaxValue||cy<int.MinValue||cy>int.MaxValue) return false;
    point.X=(int)cx; point.Y=(int)cy; return true;
  }
  static void Release(object value,List<object> released) {
    if(value==null || !Marshal.IsComObject(value)) return;
    foreach(object prior in released) if(object.ReferenceEquals(prior,value)) return;
    released.Add(value);
    try { Marshal.ReleaseComObject(value); } catch { }
  }
  public static bool Verify(IbisUiaAutomation automation,int pid,IbisUiaPoint point,int[] searchId,int[] resultsId,int[] focusedId) {
    IbisUiaElement search=null,focused=null,target=null;
    object relation=null;
    try {
      if(automation==null || pid<=0 || !ValidId(searchId)||!ValidId(resultsId)||!ValidId(focusedId)) return false;
      if(automation.ElementFromPoint(point,out search)<0 || !Bound(search,pid,searchId)) return false;
      if(automation.GetFocusedElement(out focused)<0 || !Bound(focused,pid,focusedId)) return false;
      if(search.GetCurrentPropertyValueEx(30104,true,out relation)<0) return false;
      // This cast performs QueryInterface for the SDK array IID. A CLR object[]
      // or an unrelated IUnknown cannot become a controller relationship.
      var array=relation as IbisUiaArray;
      int length;
      if(array==null || array.get_Length(out length)<0 || length!=1 || array.GetElement(0,out target)<0) return false;
      return Bound(target,pid,resultsId);
    } catch { return false; }
    finally {
      var released=new List<object>(); Release(target,released); Release(relation,released);
      Release(focused,released); Release(search,released);
    }
  }
  public static bool Read(int pid,double x,double y,double width,double height,int[] searchId,int[] resultsId,int[] focusedId) {
    object automation=null;
    try {
      IbisUiaPoint point;
      if(!TryPoint(x,y,width,height,out point)) return false;
      automation=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("ff48dba4-60ef-4201-aa87-54103eef594e")));
      return Verify(automation as IbisUiaAutomation,pid,point,searchId,resultsId,focusedId);
    } catch { return false; }
    finally { Release(automation,new List<object>()); }
  }
}
'@
  Add-Type -TypeDefinition ($definition + $SelfTestDefinitions)
}

function Test-PickerProjection {
  $definitions = @'
public class IbisFakeElement : IbisUiaElement {
  public int[] Id; public int Pid=41, IdHr=0, PropertyHr=0; public object Relation;
  public int SetFocus() { throw new Exception("Input must never be called"); }
  public int GetRuntimeId(out int[] id) { id=Id; return IdHr; }
  public int FindFirst(int scope,IntPtr condition,out IbisUiaElement element) { throw new Exception(); }
  public int FindAll(int scope,IntPtr condition,out IbisUiaArray elements) { throw new Exception(); }
  public int FindFirstBuildCache(int scope,IntPtr condition,IntPtr cache,out IbisUiaElement element) { throw new Exception(); }
  public int FindAllBuildCache(int scope,IntPtr condition,IntPtr cache,out IbisUiaArray elements) { throw new Exception(); }
  public int BuildUpdatedCache(IntPtr cache,out IbisUiaElement element) { throw new Exception(); }
  public int GetCurrentPropertyValue(int property,out object value) { throw new Exception(); }
  public int GetCurrentPropertyValueEx(int property,bool ignoreDefault,out object value) {
    if(!ignoreDefault) throw new Exception();
    value=property==30002 ? (object)Pid : Relation; return PropertyHr;
  }
}
public class IbisFakeArray : IbisUiaArray {
  public IbisUiaElement Element; public int Length=1, LengthHr=0, ElementHr=0;
  public int get_Length(out int count) { count=Length; return LengthHr; }
  public int GetElement(int index,out IbisUiaElement element) { if(index!=0) throw new Exception(); element=Element; return ElementHr; }
}
public class IbisFakeAutomation : IbisUiaAutomation {
  public IbisUiaElement Search, Focus; public int PointHr=0, FocusHr=0;
  public int CompareElements(IbisUiaElement left,IbisUiaElement right,out bool same) { throw new Exception(); }
  public int CompareRuntimeIds(int[] left,int[] right,out bool same) { throw new Exception(); }
  public int GetRootElement(out IbisUiaElement element) { throw new Exception(); }
  public int ElementFromHandle(IntPtr hwnd,out IbisUiaElement element) { throw new Exception(); }
  public int ElementFromPoint(IbisUiaPoint point,out IbisUiaElement element) { element=Search; return PointHr; }
  public int GetFocusedElement(out IbisUiaElement element) { element=Focus; return FocusHr; }
}
public static class IbisProjectionTests {
  static void Require(bool value,[System.Runtime.CompilerServices.CallerLineNumber] int line=0) { if(!value) throw new Exception("Native UIA projection contract failed at synthetic fixture line " + line); }
  public static void Run() {
    var search=new IbisFakeElement {Id=new[]{1,2}};
    var result=new IbisFakeElement {Id=new[]{3,4}};
    var focus=new IbisFakeElement {Id=new[]{5,6}};
    var array=new IbisFakeArray {Element=result}; search.Relation=array;
    var automation=new IbisFakeAutomation {Search=search,Focus=focus};
    Func<bool> read=()=>IbisPickerProjection.Verify(automation,41,new IbisUiaPoint(),new[]{1,2},new[]{3,4},new[]{5,6});
    Require(read());
    foreach(var bad in new[]{new int[0],new int[65],new[]{9,9}}) { search.Id=bad; Require(!read()); } search.Id=new[]{1,2};
    result.Id=new[]{9,9}; Require(!read()); result.Id=new[]{3,4};
    focus.Id=new[]{9,9}; Require(!read()); focus.Id=new[]{5,6};
    foreach(var element in new[]{search,result,focus}) { element.Pid=99; Require(!read()); element.Pid=41; element.IdHr=-1; Require(!read()); element.IdHr=0; element.PropertyHr=-1; Require(!read()); element.PropertyHr=0; }
    foreach(var length in new[]{0,2,65}) { array.Length=length; Require(!read()); } array.Length=1;
    array.LengthHr=-1; Require(!read()); array.LengthHr=0; array.ElementHr=-1; Require(!read()); array.ElementHr=0;
    search.Relation=new object[]{result}; Require(!read()); search.Relation=new object(); Require(!read()); search.Relation=array;
    automation.PointHr=-1; Require(!read()); automation.PointHr=0; automation.FocusHr=-1; Require(!read()); automation.FocusHr=0; Require(read());
    IbisUiaPoint point;
    Require(IbisPickerProjection.TryPoint(-200,-100,100,50,out point) && point.X==-150 && point.Y==-75);
    foreach(var bad in new[]{double.NaN,double.PositiveInfinity,double.NegativeInfinity,double.MaxValue}) Require(!IbisPickerProjection.TryPoint(bad,0,100,50,out point));
    Require(!IbisPickerProjection.TryPoint(int.MaxValue,0,100,50,out point));
    Require(!IbisPickerProjection.TryPoint(0,0,0,50,out point));
    Require(!IbisPickerProjection.TryPoint(0,0,8193,50,out point));
    Require(!IbisPickerProjection.TryPoint(0,0,8192,8192,out point));
    Require(typeof(IbisUiaAutomation).GUID.ToString()=="30cbe57d-d9d0-452a-ab13-7ac5ac4825ee");
    Require(typeof(IbisUiaElement).GUID.ToString()=="d22108aa-8ac5-49a5-837b-37bbb3d7591e");
    Require(typeof(IbisUiaArray).GUID.ToString()=="14314595-b4bc-4055-95f2-58f2e42c9855");
    Require(Marshal.SizeOf<IbisUiaPoint>()==8);
    var method=typeof(IbisUiaElement).GetMethod("GetRuntimeId");
    var marshal=method.GetParameters()[0].GetCustomAttribute<MarshalAsAttribute>();
    Require(marshal.Value==UnmanagedType.SafeArray && method.GetParameters()[0].ParameterType==typeof(int[]).MakeByRefType());
    // Unix CLR does not expose COM SAFEARRAY subtype metadata. The declared
    // VT_I4 contract is additionally checked by the PowerShell source fixture.
    if(RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) Require(marshal.SafeArraySubType==VarEnum.VT_I4);
    method=typeof(IbisUiaElement).GetMethod("GetCurrentPropertyValueEx");
    Require(method.GetParameters()[1].GetCustomAttribute<MarshalAsAttribute>().Value==UnmanagedType.Bool);
    Require(method.GetParameters()[2].GetCustomAttribute<MarshalAsAttribute>().Value==UnmanagedType.Struct);
    Slots(typeof(IbisUiaAutomation),new[]{"CompareElements","CompareRuntimeIds","GetRootElement","ElementFromHandle","ElementFromPoint","GetFocusedElement"});
    Slots(typeof(IbisUiaElement),new[]{"SetFocus","GetRuntimeId","FindFirst","FindAll","FindFirstBuildCache","FindAllBuildCache","BuildUpdatedCache","GetCurrentPropertyValue","GetCurrentPropertyValueEx"});
    Slots(typeof(IbisUiaArray),new[]{"get_Length","GetElement"});
  }
  static void Slots(Type type,string[] expected) {
    var methods=type.GetMethods(); Array.Sort(methods,(a,b)=>a.MetadataToken.CompareTo(b.MetadataToken));
    Require(methods.Length==expected.Length);
    for(int i=0;i<expected.Length;i++) Require(methods[i].Name==expected[i] && methods[i].ReturnType==typeof(int) && (methods[i].MethodImplementationFlags & MethodImplAttributes.PreserveSig)!=0);
  }
}
'@
  $source = Get-Content -LiteralPath $PSCommandPath -Raw
  if ($source -cnotmatch 'GetRuntimeId\(\[MarshalAs\(UnmanagedType.SafeArray,SafeArraySubType=VarEnum.VT_I4\)\] out int\[\] id\)') {
    throw 'SDK runtime ID SAFEARRAY contract changed'
  }
  Initialize-PickerProjection $definitions
  [IbisProjectionTests]::Run()
}
function Test-PickerKeyboardFocus {
  $native = @{owned=$true;available=$true;handle=10;thread=7;focus=11;child=$true}
  $semantic = @{available=$true;unique_search=$true;unique_results=$true;direct_search_focus=$false;
    controller_for_results=$true;controlled_results_focus=$true}
  $readNative = { $native }
  $readSemantic = { $semantic }
  if (!(Observe-PickerKeyboardFocus $readNative $readSemantic).ready) { throw 'Proven virtual focus was rejected' }
  foreach ($key in @('owned','available','child')) {
    $native[$key] = $false
    if ((Observe-PickerKeyboardFocus $readNative $readSemantic).ready) { throw 'Unproven native focus was accepted' }
    $native[$key] = $true
  }
  $native.child = $false
  $partial = Observe-PickerKeyboardFocus $readNative $readSemantic
  if (!$partial.owned_picker -or !$partial.available -or $partial.native_child_focus -or $partial.ready -or !$partial.unique_search) {
    throw 'Valid non-child focus observation lost its safe diagnostic facts'
  }
  $native.child = $true
  $native.available = $false
  $partial = Observe-PickerKeyboardFocus $readNative $readSemantic
  if (!$partial.owned_picker -or $partial.available -or $partial.native_child_focus -or $partial.ready -or !$partial.unique_search) {
    throw 'Unavailable GUI query authorized typing or lost its distinct facts'
  }
  $native.available = $true
  $native.focus = 10
  if ((Observe-PickerKeyboardFocus $readNative $readSemantic).ready) { throw 'Top-level picker focus was accepted' }
  $native.focus = 11
  foreach ($key in @('available','unique_search','unique_results','controller_for_results','controlled_results_focus')) {
    $semantic[$key] = $false
    if ((Observe-PickerKeyboardFocus $readNative $readSemantic).ready) { throw 'Unproven semantic focus was accepted' }
    $semantic[$key] = $true
  }
  $semantic.direct_search_focus = $true; $semantic.controller_for_results = $false; $semantic.unique_results = $false
  if (!(Observe-PickerKeyboardFocus $readNative $readSemantic).ready) { throw 'Direct focus required unsupported virtual focus' }
  $native.child = $false
  if ((Observe-PickerKeyboardFocus $readNative $readSemantic).ready) { throw 'Direct UIA focus bypassed native proof' }
  $native.child = $true
  foreach ($field in @('handle','thread','focus')) {
    $script:nativeReads = 0
    $changing = { $script:nativeReads++; $copy=$native.Clone(); if ($script:nativeReads -gt 1) { $copy[$field]++ }; $copy }
    if ((Observe-PickerKeyboardFocus $changing $readSemantic).ready) { throw 'Changed native identity or focus was accepted' }
  }
  if ((Observe-PickerKeyboardFocus { throw 'private provider data' } $readSemantic).ready) { throw 'Native exception was accepted' }
  $facts = Observe-PickerKeyboardFocus $readNative { throw 'private provider data' }
  if (($facts | ConvertTo-Json -Compress).Contains('private') -or @($facts.Values | Where-Object { $_ -isnot [bool] }).Count) {
    throw 'Keyboard facts exposed provider data'
  }
  if (($facts.Keys | Sort-Object) -join ',' -cne 'available,controlled_results_focus,controller_for_results,direct_search_focus,native_child_focus,owned_picker,ready,unique_results,unique_search') {
    throw 'Keyboard facts schema changed'
  }
  $same = { param($Left,$Right) $Left -ceq $Right }
  $owned = { param($Element) $Element -cne 'foreign' }
  $parentMap = @{option='results';results='root';root=$null;foreign='results'}
  $parent = { param($Element) $parentMap[$Element] }
  if (!(Test-FocusedAncestry 'option' 'results' $parent $same $owned)) { throw 'Exact focused descendant was rejected' }
  if (Test-FocusedAncestry 'foreign' 'results' $parent $same $owned) { throw 'Foreign focused ancestor was accepted' }
  $parentMap.option='option'
  if (Test-FocusedAncestry 'option' 'results' $parent $same $owned) { throw 'Cyclic focused ancestry was accepted' }
  $parentMap.option='other'
  if (Test-FocusedAncestry 'option' 'results' $parent $same $owned) { throw 'Unrelated focused node was accepted' }
  $script:parentReads=0
  $deep = { param($Element) $script:parentReads++; [string] ([int] $Element + 1) }
  if ((Test-FocusedAncestry '1' '34' $deep $same $owned) -or $script:parentReads -gt 32) { throw 'Focused ancestry bound was bypassed' }
  $script:focusReads=0
  $readFocused = { $script:focusReads++; if ($script:focusReads -eq 1) { 'option' } else { 'other' } }
  $parentMap.option='results'
  $uia = Observe-PickerUiaFocus @('search') @('results') $readFocused { $true } $parent $same $owned
  if ($uia.available) { throw 'Changing UIA focus was accepted' }
  foreach ($lostElement in @('option','search','results')) {
    $script:focusReads=0
    $readFocused = { $script:focusReads++; 'option' }
    $changingOwnership = { param($Element) !($script:focusReads -gt 1 -and $Element -ceq $lostElement) }
    $uia = Observe-PickerUiaFocus @('search') @('results') $readFocused { $true } $parent $same $changingOwnership
    if ($uia.available) { throw 'Ownership changed during UIA reads was accepted' }
  }
  $stableFocus = { 'option' }
  $uia = Observe-PickerUiaFocus @('search') @('results') $stableFocus { $true } $parent $same $owned
  if (!$uia.available -or !$uia.controller_for_results -or !$uia.controlled_results_focus -or $uia.direct_search_focus) {
    throw 'Exact controlled focused descendant was rejected'
  }
  foreach ($badRelation in @($false,1,'true',@($true),$null)) {
    $controller = { ,$badRelation }
    $uia = Observe-PickerUiaFocus @('search') @('results') $stableFocus $controller $parent $same $owned
    if ($uia.controller_for_results -or $uia.controlled_results_focus) { throw 'Unverified native relation proved virtual focus' }
  }
  $uia = Observe-PickerUiaFocus @('search','search') @('results') $stableFocus { $true } $parent $same $owned
  if ($uia.unique_search -or $uia.controlled_results_focus) { throw 'Ambiguous named search proved virtual focus' }
  $uia = Observe-PickerUiaFocus @('search') @('results','results') $stableFocus { $true } $parent $same $owned
  if ($uia.unique_results -or $uia.controlled_results_focus) { throw 'Ambiguous results proved virtual focus' }
  $uia = Observe-PickerUiaFocus @('search') @() { 'search' } { throw 'Unsupported ControllerFor' } $parent $same $owned
  if (!$uia.direct_search_focus -or !$uia.available) { throw 'Direct focus required ControllerFor capability' }
  $uia = Observe-PickerUiaFocus @('search') @('results') { 'option' } { $true } { throw 'Provider permission failure' } $same $owned
  if ($uia.available) { throw 'Focused ancestry exception proved focus' }
  # Execute the production native sampler against a fake Win32 boundary. No OS
  # input, UIA assemblies or desktop are used by these cross-platform tests.
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class IbisSmoke {
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public uint Size, Flags;
    public IntPtr Active, Focus;
  }
  public static bool Live=true, Visible=true, Child=true, Available=true;
  public static uint Pid=41, ChildPid=41, Thread=7, ChildThread=7, Flags=0;
  public static long Foreground=10, Focus=11, Active=10;
  public static int Queries=0, ForegroundReads=0, LoseForegroundAfter=0, FocusWindowReads=0, FocusVisibleReads=0, ChildReads=0, WindowReads=0, VisibleReads=0;
  public static bool IsWindow(IntPtr w) { WindowReads++; if(w.ToInt64()!=10) FocusWindowReads++; return Live; }
  public static bool IsWindowVisible(IntPtr w) { VisibleReads++; if(w.ToInt64()!=10) FocusVisibleReads++; return Visible; }
  public static uint OwnerPid(IntPtr w) { return Pid; }
  public static IntPtr GetForegroundWindow() {
    ForegroundReads++;
    return new IntPtr(LoseForegroundAfter>0 && ForegroundReads>LoseForegroundAfter ? 99 : Foreground);
  }
  public static uint GetWindowThreadProcessId(IntPtr w, out uint pid) {
    pid=w.ToInt64()==10 ? Pid : ChildPid; return w.ToInt64()==10 ? Thread : ChildThread;
  }
  public static bool IsChild(IntPtr parent, IntPtr child) { ChildReads++; return Child; }
  public static bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info) {
    if(thread!=0) throw new Exception("Background GUI thread query");
    Queries++; info.Focus=new IntPtr(Focus); info.Active=new IntPtr(Active); info.Flags=Flags; return Available;
  }
}
'@
  $AppId=41
  if (!(Read-PickerNativeFocus ([IntPtr]::new(10))).child) { throw 'Native strict-child focus was rejected' }
  foreach ($field in @('Live','Visible','Child','Available')) {
    [IbisSmoke].GetField($field).SetValue($null,$false)
    $observed = Observe-PickerKeyboardFocus { Read-PickerNativeFocus ([IntPtr]::new(10)) } $readSemantic
    if ($observed.ready) { throw 'Invalid native boundary proved keyboard readiness' }
    [IbisSmoke].GetField($field).SetValue($null,$true)
  }
  foreach ($field in @('Pid','ChildPid','ChildThread','Thread','Flags')) {
    $old=[IbisSmoke].GetField($field).GetValue($null)
    [IbisSmoke].GetField($field).SetValue($null,[uint32] 99)
    if ((Observe-PickerKeyboardFocus { Read-PickerNativeFocus ([IntPtr]::new(10)) } $readSemantic).ready) {
      throw 'Foreign native ownership, thread or mode proved readiness'
    }
    [IbisSmoke].GetField($field).SetValue($null,$old)
  }
  foreach ($focus in @(0,10)) {
    [IbisSmoke]::Focus=$focus
    if ((Read-PickerNativeFocus ([IntPtr]::new(10))).child) { throw 'Missing or top-window focus was accepted' }
  }
  [IbisSmoke]::Focus=11; [IbisSmoke]::ForegroundReads=0; [IbisSmoke]::LoseForegroundAfter=1
  if ((Read-PickerNativeFocus ([IntPtr]::new(10))).owned) { throw 'Lost foreground during native query was accepted' }
  [IbisSmoke]::LoseForegroundAfter=0; [IbisSmoke]::Foreground=99; [IbisSmoke]::Queries=0
  if ((Read-PickerNativeFocus ([IntPtr]::new(10))).owned -or [IbisSmoke]::Queries -ne 0) {
    throw 'Foreign foreground was queried for picker input focus'
  }

}
function Test-KeyboardObservation {
  $AppId=41
  [IbisSmoke]::Foreground=10; [IbisSmoke]::ForegroundReads=0; [IbisSmoke]::LoseForegroundAfter=0
  [IbisSmoke]::Focus=10; [IbisSmoke]::Available=$false
  [IbisSmoke]::FocusWindowReads=0; [IbisSmoke]::FocusVisibleReads=0; [IbisSmoke]::ChildReads=0
  [IbisSmoke]::WindowReads=0; [IbisSmoke]::VisibleReads=0
  $unavailable=New-KeyboardObservation
  $uiaFailure={ param($Observation) Observe-PickerUiaFocus @('search') @('results') { throw 'private provider text' } { $false } { $null } { $false } { $true } $Observation }
  $first=Observe-PickerKeyboardFocus { param($Observation) Read-PickerNativeFocus ([IntPtr]::new(10)) $Observation } $uiaFailure $unavailable
  [IbisSmoke]::Available=$true; [IbisSmoke]::Queries=0
  $topWindow=New-KeyboardObservation
  $second=Observe-PickerKeyboardFocus { param($Observation) Read-PickerNativeFocus ([IntPtr]::new(10)) $Observation } $uiaFailure $topWindow
  foreach ($key in $first.Keys) { if ($first[$key] -ne $second[$key]) { throw 'Diagnostics changed collapsed keyboard evidence' } }
  if (!$first.owned_picker -or $first.ready -or $second.ready) { throw 'Collapsed readiness regression was not reproduced' }
  if ($unavailable.native_before.gui_available -or !$topWindow.native_before.gui_available -or !$topWindow.native_before.focus_is_picker -or
      !$topWindow.native_after.focus_is_picker -or !$topWindow.uia.exception -or $topWindow.uia.stage -cne 'focused' -or [IbisSmoke]::Queries -ne 2) {
    throw 'Collapsed all-false readiness lost its distinguishing same-read facts'
  }
  if ($topWindow.native_before.stage -cne 'focus' -or $unavailable.native_before.stage -cne 'gui' -or
      [IbisSmoke]::FocusWindowReads -ne 0 -or [IbisSmoke]::FocusVisibleReads -ne 0 -or [IbisSmoke]::ChildReads -ne 0 -or [IbisSmoke]::WindowReads -ne 8 -or [IbisSmoke]::VisibleReads -ne 8) {
    throw 'Diagnostics queried original short-circuited native predicates'
  }
  [IbisSmoke]::Focus=11; [IbisSmoke]::ChildPid=99
  $foreign=New-NativeKeyboardObservation
  if ((Read-PickerNativeFocus ([IntPtr]::new(10)) $foreign).child -or $foreign.focus_pid_matches -or !$foreign.focus_present -or
      !$foreign.focus_live -or !$foreign.focus_visible -or $foreign.focus_strict_child -or [IbisSmoke]::ChildReads -ne 0) {
    throw 'Same-read foreign focus facts changed native short-circuiting'
  }
  [IbisSmoke]::ChildPid=41
  if (($topWindow | ConvertTo-Json -Depth 5 -Compress).Contains('private')) { throw 'Keyboard observation exposed provider text' }
  $same={param($Left,$Right) if ($Right -ceq 'picker') { throw 'private comparison payload' }; $Left -ceq $Right}
  $owned={param($Element) $true}
  $parent={param($Element) if ($Element -ceq 'option') { 'results' } else { $null }}
  $diagnostic=New-KeyboardObservation
  $ordinary=Observe-PickerUiaFocus @('search') @('results') { 'option' } { $true } $parent $same $owned
  $script:observedFocusReads=0
  $observed=Observe-PickerUiaFocus @('search') @('results') { $script:observedFocusReads++; 'option' } { $true } $parent $same $owned $diagnostic.uia 'picker'
  foreach ($key in $ordinary.Keys) { if ($ordinary[$key] -ne $observed[$key]) { throw 'Diagnostic comparison changed primary UIA evidence' } }
  if (!$observed.controlled_results_focus -or !$diagnostic.uia.exception -or $diagnostic.uia.focused_is_results -or $script:observedFocusReads -ne 2) { throw 'Comparison diagnostic did not preserve primary proof' }
  $blank=New-KeyboardObservation
  if (($blank.Keys | Sort-Object) -join ',' -cne 'focus_stable,native_after,native_before,uia') { throw 'Observation outer schema changed' }
  foreach ($native in @($blank.native_before,$blank.native_after)) {
    if (($native.Keys | Sort-Object) -join ',' -cne 'active_picker,exception,focus_is_picker,focus_live,focus_pid_matches,focus_present,focus_strict_child,focus_thread_matches,focus_visible,gui_available,gui_idle,owned,stage') { throw 'Native observation schema changed' }
    foreach ($key in $native.Keys) { if ($key -cne 'stage' -and ($native[$key] -isnot [bool] -or $native[$key])) { throw 'Unobserved native field was invented' } }
  }
  if (($blank.uia.Keys | Sort-Object) -join ',' -cne 'enumeration_complete,exception,final_focus_same,final_owned,focused_is_picker,focused_is_results,focused_is_search,focused_owned,focused_present,ownership_disabled,ownership_offscreen,ownership_pid_mismatch,ownership_walk_failed,results_matches,results_owned,root_identity,search_matches,search_owned,stage') { throw 'UIA observation schema changed' }
  if ($blank.native_before.stage -cne 'unobserved' -or $blank.native_after.stage -cne 'unobserved' -or $blank.uia.stage -cne 'unobserved') { throw 'Unobserved phase changed' }
  foreach ($key in $blank.uia.Keys) {
    if ($key -ceq 'stage') { continue }
    if ($key -cin @('search_matches','results_matches')) {
      if ($blank.uia[$key] -isnot [int] -or $blank.uia[$key] -ne 0) { throw 'Unobserved count was invented' }
    } elseif ($blank.uia[$key] -isnot [bool] -or $blank.uia[$key]) { throw 'Unobserved UIA field was invented' }
  }
  $bounded=New-UiaKeyboardObservation
  Observe-PickerUiaFocus (@('search')*4001) @() { 'option' } { $false } $parent $same $owned $bounded | Out-Null
  if ($bounded.search_matches -ne 0) { throw 'Overflowed UIA count was serialized' }
  # Exercise the production ownership predicate itself, preserving its original
  # short-circuit Current getters; no UIA assembly or desktop is involved.
  $tree=[System.Management.Automation.Language.Parser]::ParseFile($PSCommandPath,[ref] $null,[ref] $null)
  $assignment=$tree.Find({param($Node) $Node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
    $Node.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and $Node.Left.VariablePath.UserPath -ceq 'ownedProcess'},$true)
  if (!$assignment) { throw 'Runtime ownership predicate missing' }
  Invoke-Expression $assignment.Extent.Text
  $script:currentReads=0
  $script:currentInfo=[pscustomobject]@{ProcessId=99;IsOffscreen=$true;IsEnabled=$false}
  $element=[pscustomobject]@{}
  $element | Add-Member -MemberType ScriptProperty -Name Current -Value { $script:currentReads++; $script:currentInfo }
  foreach ($kind in @('pid','offscreen','disabled','valid')) {
    $Observation=New-UiaKeyboardObservation; $script:currentReads=0
    $script:currentInfo.ProcessId=if ($kind -ceq 'pid') {99} else {41}
    $script:currentInfo.IsOffscreen=$kind -cin @('pid','offscreen')
    $script:currentInfo.IsEnabled=$kind -ceq 'valid'
    $proof=& $ownedProcess $element
    $expectedReads=if ($kind -ceq 'pid') {1} elseif ($kind -ceq 'offscreen') {2} else {3}
    if ($proof -ne ($kind -ceq 'valid') -or $script:currentReads -ne $expectedReads -or
        $Observation.ownership_pid_mismatch -ne ($kind -ceq 'pid') -or
        $Observation.ownership_offscreen -ne ($kind -ceq 'offscreen') -or
        $Observation.ownership_disabled -ne ($kind -ceq 'disabled')) { throw 'Ownership observation changed original predicate reads' }
  }
}
if ($SelfTest) { Test-GuardedDialogKey; Test-PickerKeyboardFocus; Test-PickerProjection; Test-KeyboardObservation; return }

[Console]::Error.WriteLine('NATIVE HELPER STAGE windows-encoding-start')
# JSON crosses a pipe to Python; neither end may inherit an OEM/ANSI code page.
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
[Console]::Error.WriteLine('NATIVE HELPER STAGE windows-encoding-ready')
[Console]::Error.WriteLine('NATIVE HELPER STAGE windows-uia-assembly-start')
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
[Console]::Error.WriteLine('NATIVE HELPER STAGE windows-uia-assembly-ready')
[Console]::Error.WriteLine('NATIVE HELPER STAGE windows-input-compile-start')
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class IbisSmoke {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public uint Size, Flags;
    public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
    public RECT CaretRect;
  }
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public MOUSEINPUT mi;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort vk, scan; public uint flags, time; public UIntPtr extra;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int x,y; public uint data,flags,time; public UIntPtr extra;
  }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr w);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr w);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr w);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr w);
  public static uint OwnerPid(IntPtr w) {
    uint pid; GetWindowThreadProcessId(w, out pid); return pid;
  }
  public static uint ForegroundPid() {
    uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid;
  }
  public static void Key(ushort vk, ushort scan, uint flags) {
    var input = new INPUT { type = 1, u = new INPUTUNION { ki = new KEYBDINPUT { vk=vk, scan=scan, flags=flags } } };
    if (SendInput(1, new INPUT[] {input}, Marshal.SizeOf(typeof(INPUT))) != 1)
      throw new Exception("SendInput failed");
  }
}
'@
if ($Action -ceq 'snapshot') { Initialize-PickerProjection }
[Console]::Error.WriteLine('NATIVE HELPER STAGE windows-input-compile-ready')
function Get-AppWindow([int] $Id) {
  $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $Id)
  $candidates = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
  if ($candidates.Count -gt 20) { throw 'Native picker window enumeration exceeded bound' }
  $search = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Search references')
  foreach ($candidate in $candidates) {
    $controls = $candidate.FindAll([System.Windows.Automation.TreeScope]::Descendants, $search)
    if ($controls.Count -gt 4000) { throw 'Named search enumeration exceeded bound' }
    # The label and editable control can expose the same accessible name.
    # A preceding static label must not exclude its actual picker window.
    foreach ($control in $controls) {
      if ($control.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -or
          $control.Current.ControlType -eq [System.Windows.Automation.ControlType]::ComboBox) { return $candidate }
    }
  }
  return $null
}
function Read-PickerUiaFocus($Window, [IntPtr] $Handle, $Observation = $null) {
  if ($null -eq $Observation) { $Observation=New-UiaKeyboardObservation }
  try {
    $Observation.stage='root'
    $Observation.root_identity=$Window.Current.ProcessId -eq $AppId -and $Window.Current.NativeWindowHandle -eq $Handle.ToInt64()
    if (!$Observation.root_identity) { return (New-PickerKeyboardFacts) }
    $Observation.stage='enumeration'
    $elements = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
    if ($elements.Count -gt 4000) { return (New-PickerKeyboardFacts) }
    $Observation.enumeration_complete=$true
    $searches = @($elements | Where-Object { $_.Current.Name -ceq 'Search references' -and
      ($_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -or
       $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::ComboBox) })
    $results = @($elements | Where-Object { $_.Current.Name -ceq 'Results' -and
      $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::List })
    $parent = { param($Element) [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($Element) }
    $same = { param($Left,$Right) [System.Windows.Automation.Automation]::Compare($Left,$Right) }
    $ownedProcess = {
      param($Element)
      if ($Element.Current.ProcessId -ne $AppId) { $Observation.ownership_pid_mismatch=$true; return $false }
      if ($Element.Current.IsOffscreen) { $Observation.ownership_offscreen=$true; return $false }
      if (!$Element.Current.IsEnabled) { $Observation.ownership_disabled=$true; return $false }
      $true
    }
    $owned = {
      param($Element)
      $result=Test-FocusedAncestry $Element $Window $parent $same $ownedProcess
      if (!$result) { $Observation.ownership_walk_failed=$true }
      $result
    }
    $facts = Observe-PickerUiaFocus $searches $results { [System.Windows.Automation.AutomationElement]::FocusedElement } {
      param($Search,$Results,$Focused)
      $rectangle = $Search.Current.BoundingRectangle
      [IbisPickerProjection]::Read($AppId,$rectangle.X,$rectangle.Y,$rectangle.Width,$rectangle.Height,
        $Search.GetRuntimeId(),$Results.GetRuntimeId(),$Focused.GetRuntimeId())
    } $parent $same $owned $Observation $Window
    $phase=$Observation.stage
    $Observation.stage='final'
    $Observation.root_identity=$Window.Current.ProcessId -eq $AppId -and $Window.Current.NativeWindowHandle -eq $Handle.ToInt64()
    if (!$Observation.root_identity) { return (New-PickerKeyboardFacts) }
    $Observation.stage=$phase
    $facts
  } catch { $Observation.exception=$true; throw }
}
function Get-Tree {
  if ($Text -and $Text -ne '0') {
    $handle = [IntPtr]::new([long]::Parse($Text, [System.Globalization.CultureInfo]::InvariantCulture))
    if (![IbisSmoke]::IsWindow($handle) -or [IbisSmoke]::OwnerPid($handle) -ne $AppId) { throw 'Verified picker window identity was lost' }
    if (![IbisSmoke]::IsWindowVisible($handle)) { return @{nodes=@();visible=$false;foreground=$false;picker_handle=$handle.ToInt64();keyboard=(New-PickerKeyboardFacts);keyboard_observation=(New-KeyboardObservation)} }
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  } else {
    $window = Get-AppWindow $AppId
  }
  if (!$window) { return @{nodes=@();visible=$false;foreground=$false;keyboard=(New-PickerKeyboardFacts);keyboard_observation=(New-KeyboardObservation)} }
  $handle = [IntPtr] $window.Current.NativeWindowHandle
  if ($handle -eq [IntPtr]::Zero) { throw 'Native picker window handle unavailable' }
  # Retained UIA state and unrelated same-PID tray windows cannot establish
  # visibility. Keep querying the verified picker HWND's actual OS bit.
  $visible = [IbisSmoke]::IsWindowVisible($handle)
  if (!$visible) { return @{nodes=@();visible=$false;foreground=$false;picker_handle=$handle.ToInt64();keyboard=(New-PickerKeyboardFacts);keyboard_observation=(New-KeyboardObservation)} }
  $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  if ($elements.Count -gt 4000) { throw 'Accessibility tree exceeded smoke traversal bound' }
  $nodes = @()
  foreach ($element in $elements) {
    $current = $element.Current
    $value = ''
    $pattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref] $pattern)) { $value = $pattern.Current.Value }
    elseif ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref] $pattern)) {
      # Root documents can include results, recovery paragraphs and the footer.
      # A silent 500-character prefix can omit the very message being asserted.
      $value = $pattern.DocumentRange.GetText(16385)
      if ($value.Length -gt 16384) { throw 'Native accessibility document exceeded smoke text bound' }
    }
    $nodes += @{role=$current.ControlType.ProgrammaticName;name=$current.Name;value=$value;focused=$current.HasKeyboardFocus}
  }
  $observation=New-KeyboardObservation
  $keyboard = Observe-PickerKeyboardFocus { param($Diagnostic) Read-PickerNativeFocus $handle $Diagnostic } {
    param($Diagnostic) Read-PickerUiaFocus $window $handle $Diagnostic
  } $observation
  @{nodes=$nodes;visible=$visible;foreground=([IbisSmoke]::ForegroundPid() -eq $AppId);picker_handle=$handle.ToInt64();keyboard=$keyboard;keyboard_observation=$observation}
}
function Send-Chord([string] $Chord) {
  $map = @{ctrl=0x11;shift=0x10;alt=0x12;super=0x5b;space=0x20;escape=0x1b;return=0x0d}
  $keys = @($Chord.ToLowerInvariant().Split('+') | ForEach-Object {
    if ($map.ContainsKey($_)) { [ushort] $map[$_] }
    elseif ($_.Length -eq 1 -and $_ -cmatch '[a-z]') { [ushort][char] $_.ToUpperInvariant() }
    else { throw 'Unsupported smoke input key' }
  })
  foreach ($key in $keys) { [IbisSmoke]::Key($key, 0, 0) }
  [array]::Reverse($keys)
  foreach ($key in $keys) { [IbisSmoke]::Key($key, 0, 2) }
}
function Get-OwnedEditor {
  $editor = Get-Process -Id $EditorId -ErrorAction SilentlyContinue
  if (!$editor) { return $null }
  if ($editor.ProcessName -ne 'Notepad' -or !$Text -or
      $editor.StartTime.ToUniversalTime().Ticks -ne [long]::Parse($Text, [System.Globalization.CultureInfo]::InvariantCulture)) {
    throw 'Synthetic editor process identity was lost'
  }
  return $editor
}
function Write-EditorWindowFacts([ValidateSet('BEFORE','AFTER')] [string] $Stage, [IntPtr] $Handle) {
  $windowFacts = [ordered]@{available=$false;owned_editor_visible=$false;owned_editor_minimized=$false;
    foreground_editor=$false;foreground_picker=$false;foreground_other=$false;foreground_none=$false}
  try {
    $visible = [IbisSmoke]::IsWindowVisible($Handle)
    $minimized = [IbisSmoke]::IsIconic($Handle)
    $foreground = [IbisSmoke]::ForegroundPid()
    $windowFacts = [ordered]@{available=$true;owned_editor_visible=$visible;owned_editor_minimized=$minimized;
      foreground_editor=($foreground -eq $EditorId);foreground_picker=($AppId -gt 0 -and $foreground -eq $AppId);
      foreground_other=($foreground -gt 0 -and $foreground -ne $EditorId -and $foreground -ne $AppId);
      foreground_none=($foreground -eq 0)}
  } catch {
    # Diagnostics never replace the focus request's result or original error.
    # The unavailable record contains no partially sampled facts or raw errors.
  }
  try {
    [Console]::Error.WriteLine("NATIVE EDITOR WINDOW $Stage " + (ConvertTo-Json -InputObject $windowFacts -Compress))
  } catch { # A diagnostic sink failure must not change the focus operation.
  }
}
try {
  [Console]::Error.WriteLine('NATIVE HELPER STAGE windows-dispatch')
  $result = switch ($Action) {
    'probe' { if (![Environment]::UserInteractive) { throw 'No interactive desktop' }; $true }
    'config-dir' {
      $directory = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
      if (!$directory) { throw 'Native configuration directory unavailable' }
      $directory
    }
    'editor' {
      if (Get-Process Notepad -ErrorAction SilentlyContinue) { throw 'Use a disposable desktop without any existing Notepad process' }
      $baseline = [System.Collections.Generic.HashSet[int]]::new()
      foreach ($process in Get-Process -ErrorAction Stop) { [void] $baseline.Add([int] $process.Id) }
      $editor = Start-Process notepad.exe -PassThru
      $deadline = [DateTime]::UtcNow.AddSeconds(15)
      do {
        Start-Sleep -Milliseconds 100
        # Windows 11 Notepad can redirect the launcher to a packaged process.
        $actual = Get-Process Notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      } while (!$actual -and [DateTime]::UtcNow -lt $deadline)
      if (!$actual) { throw 'Notepad has no interactive window' }
      if ($baseline.Contains([int] $actual.Id)) { throw 'Editor activation selected a preexisting process' }
      @{pid=[int] $actual.Id;started=[long] $actual.StartTime.ToUniversalTime().Ticks}
    }
    'snapshot' { Get-Tree }
    'key' { Send-Chord $Text; $true }
    'dialog-key' {
      # Input compilation has finished. Re-read the exact owned foreground
      # dialog in this same process immediately before one native key chord.
      Invoke-GuardedDialogKey $Text {
        param($Plan)
        $acknowledgement = & "$PSScriptRoot/dialog-windows.ps1" -Action verify-key -AppId $AppId `
          -PickerHandle $Plan.picker_handle -ExpectedDialogHandle $Plan.dialog_handle
        ConvertFrom-Json -InputObject ($acknowledgement -join "`n") -ErrorAction Stop
      } { param($Key) Send-Chord $Key }
    }
    'text' {
      foreach ($character in $Text.ToCharArray()) {
        [IbisSmoke]::Key(0, [ushort] $character, 4)
        [IbisSmoke]::Key(0, [ushort] $character, 6)
      }
      $true
    }
    'click' {
      $window = Get-AppWindow $AppId
      if (!$window) { throw 'Native picker window unavailable' }
      $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Text)
      $element = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
      if (!$element) { throw 'Named accessibility control missing' }
      $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      $true
    }
    'focus-editor' {
      $facts = @{stage='identity';owned=$false;window_valid=$false;request_accepted=$false;current_foreground=$false}
      try {
        $editor = Get-OwnedEditor
        if (!$editor) { throw 'Synthetic editor process exited' }
        $facts.owned = $true
        $facts.stage = 'window'
        $handle = [IntPtr] $editor.MainWindowHandle
        if ($handle.ToInt64() -le 0 -or ![IbisSmoke]::IsWindow($handle) -or [IbisSmoke]::OwnerPid($handle) -ne $EditorId) {
          throw 'Synthetic editor window identity was lost'
        }
        $facts.window_valid = $true
        Write-EditorWindowFacts BEFORE $handle
        $facts.stage = 'foreground-request'
        $facts.current_foreground = [IbisSmoke]::ForegroundPid() -eq $EditorId
        if (!$facts.current_foreground) {
          $facts.request_accepted = [IbisSmoke]::SetForegroundWindow($handle)
        }
        $facts.current_foreground = [IbisSmoke]::ForegroundPid() -eq $EditorId
        Write-EditorWindowFacts AFTER $handle
        # A declined request is not a focus verdict. Python independently
        # waits for fresh editor-focused observations before proceeding.
        @{owned=$facts.owned;window_valid=$facts.window_valid;request_accepted=$facts.request_accepted;current_foreground=$facts.current_foreground}
      } finally {
        [Console]::Error.WriteLine('NATIVE EDITOR FOCUS ' + (ConvertTo-Json -InputObject $facts -Compress))
      }
    }
    'editor-focused' { $null -ne (Get-OwnedEditor) -and [IbisSmoke]::ForegroundPid() -eq $EditorId }
    'clipboard' { Get-Clipboard -Raw }
    'write-clipboard' { Set-Clipboard -Value $Text; $true }
    'memory' {
      $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
      $ids = [System.Collections.Generic.HashSet[int]]::new()
      [void] $ids.Add($AppId)
      do {
        $added = $false
        foreach ($process in $all) {
          if ($ids.Contains([int] $process.ParentProcessId) -and $ids.Add([int] $process.ProcessId)) { $added = $true }
        }
      } while ($added)
      [long] (@(Get-Process -Id @($ids) -ErrorAction Stop) | Measure-Object WorkingSet64 -Sum).Sum
    }
    'close-editor' {
      $editor = Get-OwnedEditor
      if ($editor) { Stop-Process -Id $editor.Id -ErrorAction Stop }
      $true
    }
    default { throw 'Unknown smoke action' }
  }
  ConvertTo-Json -InputObject $result -Depth 10 -Compress
} catch {
  # Never serialize exception text: UIA exceptions can contain accessible text.
  [Console]::Error.WriteLine("Windows native smoke action unavailable: $Action")
  exit 1
}
