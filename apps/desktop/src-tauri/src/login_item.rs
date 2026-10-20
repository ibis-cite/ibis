//! Starting Ibis when the person logs in (#525).
//!
//! The system keeps the answer, never `settings.json`: people also switch
//! login items off in System Settings > General > Login Items (macOS), Task
//! Manager's Startup apps (Windows) or their desktop's startup settings
//! (Linux), so every read asks the system again.
//!
//! - macOS 13 and later: `SMAppService.mainApp`, listed under Open at Login.
//! - Windows: a value in the current user's `Run` key, named after the app;
//!   Task Manager's switch for it counts.
//! - Linux: an XDG autostart `.desktop` file, named after the app identifier.
//!
//! Ibis and Ibis Nightly have different names and identifiers, so each has
//! its own entry; debug builds use another one again.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::CheckMenuItem;
use tauri::{AppHandle, Manager};

/// Passed by the login entry (Windows and Linux), so Ibis starts without
/// showing the picker. macOS reports a login launch in its open event instead.
pub(crate) const AT_LOGIN_ARG: &str = "--at-login";

/// Why the choice is not what the person asked for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LoginItemProblem {
    /// This system offers no way to do it (macOS before 13).
    Unsupported,
    /// macOS registered Ibis but waits for the person to allow it.
    NeedsApproval,
    /// The system refused the change.
    Refused,
    /// The current state could not be read.
    Unreadable,
}

/// Whether Ibis starts when the person logs in, as the system reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
pub(crate) struct LoginItem {
    pub(crate) enabled: bool,
    pub(crate) problem: Option<LoginItemProblem>,
}

/// A failed system call. Its details are dropped on purpose: they can name
/// the person's home folder.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Failed;

/// One platform's login entry.
pub(crate) trait Entry: Send + Sync {
    fn is_enabled(&self) -> Result<bool, Failed>;
    fn enable(&self) -> Result<(), Failed>;
    fn disable(&self) -> Result<(), Failed>;
}

/// The state now, as the system reports it.
pub(crate) fn read(entry: Option<&dyn Entry>) -> LoginItem {
    match entry.map(Entry::is_enabled) {
        None => LoginItem {
            enabled: false,
            problem: Some(LoginItemProblem::Unsupported),
        },
        Some(Ok(enabled)) => LoginItem { enabled, problem: None },
        Some(Err(Failed)) => LoginItem {
            enabled: false,
            problem: Some(LoginItemProblem::Unreadable),
        },
    }
}

/// Ask for `on`, then report what the system actually did. `approval` is
/// true where the system can accept a registration but wait for the person
/// to allow it (macOS).
pub(crate) fn change(entry: Option<&dyn Entry>, on: bool, approval: bool) -> LoginItem {
    let Some(entry) = entry else {
        return read(None);
    };
    let asked = if on { entry.enable() } else { entry.disable() };
    match (asked, entry.is_enabled()) {
        (_, Ok(enabled)) if enabled == on => LoginItem { enabled, problem: None },
        (Ok(()), Ok(enabled)) if on && approval => LoginItem {
            enabled,
            problem: Some(LoginItemProblem::NeedsApproval),
        },
        (_, Ok(enabled)) => LoginItem {
            enabled,
            problem: Some(LoginItemProblem::Refused),
        },
        (_, Err(Failed)) => LoginItem {
            enabled: false,
            problem: Some(LoginItemProblem::Unreadable),
        },
    }
}

/// The app's login entry, or `None` where the system has none to offer.
pub(crate) struct LoginItems {
    entry: Option<Box<dyn Entry>>,
    /// One change at a time, from the picker or the menu.
    changing: Mutex<()>,
}

impl LoginItems {
    pub(crate) fn new(entry: Option<Box<dyn Entry>>) -> Self {
        LoginItems {
            entry,
            changing: Mutex::new(()),
        }
    }

    pub(crate) fn available(&self) -> bool {
        self.entry.is_some()
    }

    pub(crate) fn read(&self) -> LoginItem {
        read(self.entry.as_deref())
    }

    pub(crate) fn change(&self, on: bool) -> LoginItem {
        let _changing = self.changing.lock();
        change(self.entry.as_deref(), on, cfg!(target_os = "macos"))
    }

    /// An entry left by an earlier copy of Ibis (a moved AppImage, say) is
    /// pointed at this one. Only when it is on: a switched-off entry stays off.
    pub(crate) fn refresh(&self) {
        if cfg!(target_os = "macos") {
            // SMAppService follows the app bundle by itself.
            return;
        }
        if let Some(entry) = &self.entry
            && entry.is_enabled() == Ok(true)
        {
            let _changing = self.changing.lock();
            let _ = entry.enable();
        }
    }
}

/// The name each build registers under: "Ibis", "Ibis Nightly", or a separate
/// development name so `pnpm tauri dev` never replaces an installed entry.
fn entry_name(product: &str) -> String {
    if cfg!(debug_assertions) {
        format!("{product} (development)")
    } else {
        product.to_string()
    }
}

/// The login entry for this app.
pub(crate) fn for_app(app: &AppHandle) -> Option<Box<dyn Entry>> {
    let name = entry_name(&app.package_info().name);
    platform_entry(app, &name)
}

#[cfg(target_os = "linux")]
fn platform_entry(app: &AppHandle, name: &str) -> Option<Box<dyn Entry>> {
    // $XDG_CONFIG_HOME, or ~/.config when it is not set (XDG autostart spec).
    let config = app.path().config_dir().ok()?;
    let identifier = &app.config().identifier;
    let file = if cfg!(debug_assertions) {
        format!("{identifier}.development.desktop")
    } else {
        format!("{identifier}.desktop")
    };
    // An AppImage runs from a temporary mount; the entry must name the file.
    let program = app
        .env()
        .appimage
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())?;
    Some(Box::new(DesktopFile {
        path: config.join("autostart").join(file),
        contents: desktop_entry(name, &program),
    }))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn platform_entry(_app: &AppHandle, name: &str) -> Option<Box<dyn Entry>> {
    let mut builder = auto_launch::AutoLaunchBuilder::new();
    builder.set_app_name(name);
    #[cfg(target_os = "macos")]
    // Registers the running app bundle; fails to build before macOS 13.
    builder.set_macos_launch_mode(auto_launch::MacOSLaunchMode::SMAppService);
    #[cfg(target_os = "windows")]
    {
        let program = std::env::current_exe().ok()?;
        // Quoted: the install folder of Ibis Nightly, like many home
        // folders, has a space in its name.
        builder
            .set_app_path(&format!("\"{}\"", program.to_str()?))
            .set_args(&[AT_LOGIN_ARG])
            // Never all users' HKLM key, even when Ibis runs as administrator.
            .set_windows_enable_mode(auto_launch::WindowsEnableMode::CurrentUser);
    }
    builder
        .build()
        .ok()
        .map(|entry| Box::new(SystemEntry(entry)) as Box<dyn Entry>)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn platform_entry(_app: &AppHandle, _name: &str) -> Option<Box<dyn Entry>> {
    None
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
struct SystemEntry(auto_launch::AutoLaunch);

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl Entry for SystemEntry {
    fn is_enabled(&self) -> Result<bool, Failed> {
        self.0.is_enabled().map_err(|_| Failed)
    }
    fn enable(&self) -> Result<(), Failed> {
        self.0.enable().map_err(|_| Failed)
    }
    fn disable(&self) -> Result<(), Failed> {
        match self.0.disable() {
            // Windows reports an absent value as an error; it is already off.
            Err(auto_launch::Error::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            result => result.map_err(|_| Failed),
        }
    }
}

/// An XDG autostart entry: on while the file exists and is not hidden.
pub(crate) struct DesktopFile {
    pub(crate) path: PathBuf,
    /// `None` when the program path cannot be written in a desktop entry.
    pub(crate) contents: Option<String>,
}

impl Entry for DesktopFile {
    fn is_enabled(&self) -> Result<bool, Failed> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => Ok(!switched_off(&text)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(_) => Err(Failed),
        }
    }

    fn enable(&self) -> Result<(), Failed> {
        let contents = self.contents.as_deref().ok_or(Failed)?;
        let folder = self.path.parent().ok_or(Failed)?;
        std::fs::create_dir_all(folder).map_err(|_| Failed)?;
        // Written beside it and renamed, so a session starting meanwhile
        // never reads half a file.
        let partial = self.path.with_extension("desktop.partial");
        std::fs::write(&partial, contents).map_err(|_| Failed)?;
        std::fs::rename(&partial, &self.path).map_err(|_| {
            let _ = std::fs::remove_file(&partial);
            Failed
        })
    }

    fn disable(&self) -> Result<(), Failed> {
        match std::fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(Failed),
        }
    }
}

/// Desktops switch an entry off by hiding it rather than deleting it.
fn switched_off(text: &str) -> bool {
    let mut in_entry = false;
    text.lines().map(str::trim).any(|line| {
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            return false;
        }
        let Some((key, value)) = line.split_once('=') else {
            return false;
        };
        let (key, value) = (key.trim(), value.trim());
        in_entry && ((key == "Hidden" && value == "true") || (key == "X-GNOME-Autostart-enabled" && value == "false"))
    })
}

/// The autostart entry that starts `program` hidden, or `None` when its path
/// cannot be represented (not Unicode, or with control characters).
pub(crate) fn desktop_entry(name: &str, program: &Path) -> Option<String> {
    let program = program.to_str()?;
    if !program.starts_with('/') || program.chars().chain(name.chars()).any(char::is_control) {
        return None;
    }
    Some(format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name={name}\n\
         Comment=Keeps the Ibis shortcut ready after you log in\n\
         TryExec={try_exec}\n\
         Exec={exec} {AT_LOGIN_ARG}\n\
         Terminal=false\n\
         StartupNotify=false\n\
         X-GNOME-Autostart-enabled=true\n",
        name = escape_string(name),
        // When the program is removed, the session skips the entry.
        try_exec = escape_string(program),
        exec = escape_string(&quote_argument(program)),
    ))
}

/// An `Exec` argument, quoted as the Desktop Entry specification says.
fn quote_argument(argument: &str) -> String {
    let mut quoted = String::from("\"");
    for c in argument.chars() {
        match c {
            '"' | '`' | '$' | '\\' => {
                quoted.push('\\');
                quoted.push(c);
            }
            // A literal percent sign; `%f` and the like are field codes.
            '%' => quoted.push_str("%%"),
            c => quoted.push(c),
        }
    }
    quoted.push('"');
    quoted
}

/// A desktop entry string value: backslashes are escaped once more.
fn escape_string(value: &str) -> String {
    value.replace('\\', "\\\\")
}

/// Whether the Windows or Linux login entry started this process.
pub(crate) fn launched_at_login(args: impl IntoIterator<Item = std::ffi::OsString>) -> bool {
    args.into_iter().skip(1).any(|arg| arg == AT_LOGIN_ARG)
}

/// Keep the picker hidden until the shortcut or the menu opens it.
pub(crate) fn start_hidden(context: &mut tauri::Context<tauri::Wry>) {
    if let Some(window) = context
        .config_mut()
        .app
        .windows
        .iter_mut()
        .find(|window| window.label == "main")
    {
        window.visible = false;
        window.focus = false;
    }
}

/// macOS starts login items with an open event that says so. Must run on the
/// main thread while the app finishes launching (Tauri's `setup`).
#[cfg(target_os = "macos")]
pub(crate) fn launched_as_macos_login_item() -> bool {
    use objc2_foundation::NSAppleEventManager;
    // Apple Event codes from AERegistry.h and AEDataModel.h.
    const OPEN_APPLICATION: u32 = u32::from_be_bytes(*b"oapp");
    const PROPERTY_DATA: u32 = u32::from_be_bytes(*b"prdt");
    const LAUNCHED_AS_LOGIN_ITEM: u32 = u32::from_be_bytes(*b"lgit");
    NSAppleEventManager::sharedAppleEventManager()
        .currentAppleEvent()
        .is_some_and(|event| {
            event.eventID() == OPEN_APPLICATION
                && event
                    .paramDescriptorForKeyword(PROPERTY_DATA)
                    .is_some_and(|data| data.enumCodeValue() == LAUNCHED_AS_LOGIN_ITEM)
        })
}

/// The menu bar or tray item, kept in step with the system.
pub(crate) struct LoginMenuItem(pub(crate) CheckMenuItem<tauri::Wry>);

/// Read the system state and show it in the menu.
pub(crate) fn current(app: &AppHandle) -> LoginItem {
    let item = app
        .try_state::<LoginItems>()
        .map_or_else(|| read(None), |items| items.read());
    show_in_menu(app, item);
    item
}

fn show_in_menu(app: &AppHandle, item: LoginItem) {
    if let Some(menu) = app.try_state::<LoginMenuItem>() {
        let _ = menu.0.set_checked(item.enabled);
    }
}

/// Change the choice and show the outcome in the menu.
pub(crate) fn set(app: &AppHandle, on: bool) -> LoginItem {
    let item = app
        .try_state::<LoginItems>()
        .map_or_else(|| read(None), |items| items.change(on));
    show_in_menu(app, item);
    item
}

/// Whether Ibis starts when the person logs in, read from the system now.
#[tauri::command]
#[specta::specta]
pub(crate) async fn login_item(app: AppHandle) -> LoginItem {
    current(&app)
}

/// Start Ibis when the person logs in, or stop doing so.
#[tauri::command]
#[specta::specta]
pub(crate) async fn set_login_item(app: AppHandle, enabled: bool) -> LoginItem {
    set(&app, enabled)
}

/// The menu item was chosen: the menu already shows the new tick, so ask for
/// that, then show what really happened and explain a refusal.
pub(crate) fn toggle_from_menu(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let wanted = app
            .try_state::<LoginMenuItem>()
            .and_then(|menu| menu.0.is_checked().ok())
            .unwrap_or(true);
        let item = set(&app, wanted);
        if let Some(problem) = item.problem {
            use tauri_plugin_dialog::DialogExt;
            let name = app.package_info().name.clone();
            app.dialog()
                .message(problem_message(problem, &name))
                .title(menu_label(&name))
                .show(|_| {});
        }
    });
}

/// The menu item's label, such as "Start Ibis When You Log In".
pub(crate) fn menu_label(name: &str) -> String {
    format!("Start {name} When You Log In")
}

/// What to tell the person, and where to look, in the menu bar or tray.
/// The picker has its own copy of these sentences in `messages.ts`.
pub(crate) fn problem_message(problem: LoginItemProblem, name: &str) -> String {
    let place = if cfg!(target_os = "macos") {
        "System Settings > General > Login Items"
    } else if cfg!(target_os = "windows") {
        "Settings > Apps > Startup"
    } else {
        "your desktop's startup applications settings"
    };
    match problem {
        LoginItemProblem::Unsupported => {
            format!("This system cannot start {name} when you log in. You can add it in {place}.")
        }
        LoginItemProblem::NeedsApproval => {
            format!("macOS needs your approval. Turn on {name} in {place}.")
        }
        LoginItemProblem::Refused => {
            format!("The system did not let {name} change this. You can change it in {place}.")
        }
        LoginItemProblem::Unreadable => {
            format!("{name} could not check whether it starts when you log in. Look in {place}.")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A system that does what it is told, or refuses, or needs approval.
    struct FakeEntry {
        on: std::sync::Mutex<bool>,
        refuse: bool,
        approve: bool,
        unreadable: bool,
    }

    impl FakeEntry {
        fn new(on: bool) -> Self {
            FakeEntry {
                on: std::sync::Mutex::new(on),
                refuse: false,
                approve: true,
                unreadable: false,
            }
        }
        fn set(&self, on: bool) -> Result<(), Failed> {
            if self.refuse {
                return Err(Failed);
            }
            *self.on.lock().map_err(|_| Failed)? = on && self.approve;
            Ok(())
        }
    }

    impl Entry for FakeEntry {
        fn is_enabled(&self) -> Result<bool, Failed> {
            if self.unreadable {
                return Err(Failed);
            }
            self.on.lock().map(|on| *on).map_err(|_| Failed)
        }
        fn enable(&self) -> Result<(), Failed> {
            self.set(true)
        }
        fn disable(&self) -> Result<(), Failed> {
            self.set(false)
        }
    }

    const fn item(enabled: bool, problem: Option<LoginItemProblem>) -> LoginItem {
        LoginItem { enabled, problem }
    }

    #[test]
    fn reading_reports_the_system_state() {
        assert_eq!(read(Some(&FakeEntry::new(true))), item(true, None));
        assert_eq!(read(Some(&FakeEntry::new(false))), item(false, None));
        assert_eq!(read(None), item(false, Some(LoginItemProblem::Unsupported)));
        let broken = FakeEntry {
            unreadable: true,
            ..FakeEntry::new(true)
        };
        // Never shown as on when that cannot be confirmed.
        assert_eq!(read(Some(&broken)), item(false, Some(LoginItemProblem::Unreadable)));
    }

    #[test]
    fn a_change_the_system_accepts_has_no_problem() {
        for on in [true, false] {
            let entry = FakeEntry::new(!on);
            assert_eq!(change(Some(&entry), on, false), item(on, None));
            // Asking again for what is already so is fine too.
            assert_eq!(change(Some(&entry), on, false), item(on, None));
        }
    }

    #[test]
    fn a_refusal_shows_the_real_state() {
        for on in [true, false] {
            let entry = FakeEntry {
                refuse: true,
                ..FakeEntry::new(!on)
            };
            assert_eq!(
                change(Some(&entry), on, true),
                item(!on, Some(LoginItemProblem::Refused))
            );
        }
    }

    #[test]
    fn a_registration_waiting_for_approval_says_so_only_where_that_exists() {
        let waiting = FakeEntry {
            approve: false,
            ..FakeEntry::new(false)
        };
        assert_eq!(
            change(Some(&waiting), true, true),
            item(false, Some(LoginItemProblem::NeedsApproval))
        );
        assert_eq!(
            change(Some(&waiting), true, false),
            item(false, Some(LoginItemProblem::Refused))
        );
    }

    #[test]
    fn an_unreadable_outcome_is_not_shown_as_on() {
        let entry = FakeEntry {
            unreadable: true,
            ..FakeEntry::new(false)
        };
        assert_eq!(
            change(Some(&entry), true, false),
            item(false, Some(LoginItemProblem::Unreadable))
        );
        assert_eq!(
            change(None, true, false),
            item(false, Some(LoginItemProblem::Unsupported))
        );
    }

    #[test]
    fn refreshing_never_turns_on_a_switched_off_entry() {
        let off = LoginItems::new(Some(Box::new(FakeEntry::new(false))));
        off.refresh();
        assert_eq!(off.read(), item(false, None));
        let on = LoginItems::new(Some(Box::new(FakeEntry::new(true))));
        on.refresh();
        assert_eq!(on.read(), item(true, None));
        assert!(!LoginItems::new(None).available());
    }

    #[test]
    fn only_the_at_login_argument_after_the_program_counts() {
        let args = |list: &[&str]| list.iter().map(std::ffi::OsString::from).collect::<Vec<_>>();
        assert!(launched_at_login(args(&["ibis", "--at-login"])));
        assert!(!launched_at_login(args(&["ibis"])));
        assert!(!launched_at_login(args(&["--at-login"])));
        assert!(!launched_at_login(args(&["ibis", "--at-login=1", "at-login"])));
    }

    #[test]
    fn development_builds_never_share_the_installed_entry() {
        let name = entry_name("Ibis");
        assert_eq!(name == "Ibis", !cfg!(debug_assertions));
        assert_ne!(entry_name("Ibis"), entry_name("Ibis Nightly"));
    }

    #[test]
    fn exec_paths_with_reserved_characters_are_quoted() {
        let Some(entry) = desktop_entry(
            "Ibis Nightly",
            Path::new("/home/a b/$x/`c`/d\"e/f\\g/50%/Ibis.AppImage"),
        ) else {
            panic!("a Unicode absolute path is representable");
        };
        assert!(
            entry.contains("Exec=\"/home/a b/\\\\$x/\\\\`c\\\\`/d\\\\\"e/f\\\\\\\\g/50%%/Ibis.AppImage\" --at-login\n")
        );
        assert!(entry.contains("TryExec=/home/a b/$x/`c`/d\"e/f\\\\g/50%/Ibis.AppImage\n"));
        assert!(entry.contains("Name=Ibis Nightly\n"));
        assert!(entry.starts_with("[Desktop Entry]\n"));
    }

    #[test]
    fn unrepresentable_paths_are_refused_not_mangled() {
        assert_eq!(desktop_entry("Ibis", Path::new("relative/ibis")), None);
        assert_eq!(desktop_entry("Ibis", Path::new("/tmp/a\nExec=evil")), None);
        assert_eq!(desktop_entry("Ibis\nExec=evil", Path::new("/usr/bin/ibis")), None);
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            let invalid = std::ffi::OsStr::from_bytes(b"/tmp/\xff/ibis");
            assert_eq!(desktop_entry("Ibis", Path::new(invalid)), None);
        }
        let entry = DesktopFile {
            path: PathBuf::from("/nonexistent/autostart/ibis.desktop"),
            contents: None,
        };
        assert_eq!(entry.enable(), Err(Failed));
    }

    #[test]
    fn hidden_entries_count_as_off() {
        assert!(!switched_off(
            "[Desktop Entry]\nName=Ibis\nX-GNOME-Autostart-enabled=true\n"
        ));
        assert!(switched_off("[Desktop Entry]\nName=Ibis\nHidden=true\n"));
        assert!(switched_off("[Desktop Entry]\nX-GNOME-Autostart-enabled = false\n"));
        // Keys of other groups are not the entry's.
        assert!(!switched_off(
            "[Desktop Entry]\nName=Ibis\n[Desktop Action x]\nHidden=true\n"
        ));
    }

    /// The entry appears and disappears in a temporary configuration folder,
    /// the way it does in `$XDG_CONFIG_HOME/autostart`.
    #[test]
    fn the_autostart_file_appears_and_disappears() {
        let home = tempfile::tempdir().unwrap_or_else(|e| panic!("temporary folder: {e}"));
        let path = home
            .path()
            .join("config dir/autostart/io.github.ibiscite.ibis.nightly.desktop");
        let stable = home.path().join("config dir/autostart/io.github.ibiscite.ibis.desktop");
        let entry = DesktopFile {
            path: path.clone(),
            contents: desktop_entry("Ibis Nightly", Path::new("/opt/Ibis Nightly/ibis")),
        };
        let items = LoginItems::new(Some(Box::new(entry)));
        assert_eq!(items.read(), item(false, None));
        assert_eq!(items.change(true), item(true, None));
        let written = std::fs::read_to_string(&path).unwrap_or_default();
        assert!(written.contains("Exec=\"/opt/Ibis Nightly/ibis\" --at-login\n"));
        assert!(!stable.exists(), "Nightly must not write the stable entry");
        assert!(!path.with_extension("desktop.partial").exists());

        // Switched off in the desktop's settings: shown as off, and turning it
        // on again writes a fresh entry.
        std::fs::write(&path, format!("{written}Hidden=true\n")).unwrap_or_default();
        assert_eq!(items.read(), item(false, None));
        assert_eq!(items.change(true), item(true, None));

        // Deleted by hand: shown as off.
        std::fs::remove_file(&path).unwrap_or_default();
        assert_eq!(items.read(), item(false, None));

        assert_eq!(items.change(true), item(true, None));
        assert_eq!(items.change(false), item(false, None));
        assert!(!path.exists());
        assert_eq!(items.change(false), item(false, None));
    }

    #[cfg(unix)]
    #[test]
    fn an_unwritable_folder_is_a_visible_refusal() {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap_or_else(|e| panic!("temporary folder: {e}"));
        let folder = home.path().join("autostart");
        std::fs::create_dir(&folder).unwrap_or_default();
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o500)).unwrap_or_default();
        let probe = folder.join("probe");
        if std::fs::write(&probe, "").is_ok() {
            // Running as root: permissions do not apply, nothing to observe.
            let _ = std::fs::remove_file(probe);
            return;
        }
        let entry = DesktopFile {
            path: folder.join("ibis.desktop"),
            contents: desktop_entry("Ibis", Path::new("/usr/bin/ibis")),
        };
        assert_eq!(
            change(Some(&entry), true, false),
            item(false, Some(LoginItemProblem::Refused))
        );
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o700)).unwrap_or_default();
    }

    #[test]
    fn problems_say_where_to_look() {
        for problem in [
            LoginItemProblem::Unsupported,
            LoginItemProblem::NeedsApproval,
            LoginItemProblem::Refused,
            LoginItemProblem::Unreadable,
        ] {
            let message = problem_message(problem, "Ibis Nightly");
            assert!(message.contains("Ibis Nightly"), "{message}");
            assert!(message.ends_with('.'), "{message}");
        }
        assert_eq!(menu_label("Ibis"), "Start Ibis When You Log In");
    }
}
