# Native appearance groundwork

The picker keeps system fonts, system shadows and its existing opaque system-colour
surface by default. Windows 11 rounded corners are already requested by Tauri's
undecorated `shadow: true`; this change adds no custom corner geometry.

On macOS and Windows, window and WebView transparency are configured together
before window creation. A safe native accessibility check precedes macOS Popover
vibrancy or Windows 11 Mica. The web surface becomes transparent only after the
native effect reports success. Unknown preferences, unsupported systems and API
failures retain the opaque surface. Linux retains its current opaque window.
Contrast and reduced-transparency CSS queries independently restore Canvas.

Preferences refresh on every summon. Windows uses safe preference notifications;
if notification registration fails, it keeps opacity. macOS notification
registration requires unsafe in the current bindings, so a one-second visible-only
poll queues at most one main-thread refresh. Effects and events change only when
policy changes. A failed effect is retried after a preference-policy change or
restart, rather than continuously reapplying it. Diagnostics use fixed text.

The direct `window-vibrancy` dependency is the same version already locked through
Tauri. Unlike Tauri `set_effects`, its APIs report application failures. Direct
`objc2-app-kit` and `windows` dependencies expose safe native accessibility APIs;
no Ibis unsafe code, network access, or additional package versions are required.
The underlying macOS implementation still invokes a private corner-radius selector.
Its success result does not prove appearance, clipping or every native failure mode.

Policy and interface tests cover fallback decisions and event ordering. Real
material appearance, live accessibility toggles, light/dark mode, corner silhouette,
resize/shadow, fullscreen summon, chooser and focus/clipboard behavior still need
native evidence. Existing opaque-picker screenshots do not establish these checks.
This groundwork must remain draft until platform compilation and native evidence
support the intended behavior. IME and VoiceOver speech are separate native checks.
