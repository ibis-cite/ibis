//! Local GlobalShortcuts wire client. The desktop owns the trigger, never settings.json.

use std::{
    collections::HashMap,
    future::poll_fn,
    pin::Pin,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use zbus::{
    Connection, MessageStream, Proxy,
    export::futures_core::Stream,
    zvariant::{OwnedObjectPath, OwnedValue, Value},
};

type Dict = HashMap<String, OwnedValue>;
type Shortcuts = Vec<(String, Dict)>;
const SERVICE: &str = "org.freedesktop.portal.Desktop";
const ROOT: &str = "/org/freedesktop/portal/desktop";
const INTERFACE: &str = "org.freedesktop.portal.GlobalShortcuts";
const ID: &str = "open-ibis";
const CALL: Duration = Duration::from_secs(10);
const RESPONSE: Duration = Duration::from_secs(120);

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Failure {
    Unavailable,
    Denied,
}

impl From<()> for Failure {
    fn from((): ()) -> Self {
        Self::Unavailable
    }
}

fn successful((code, values): (u32, Dict)) -> Result<Dict, Failure> {
    if code == 0 { Ok(values) } else { Err(Failure::Denied) }
}

fn session_handle(mut values: Dict) -> Result<OwnedObjectPath, ()> {
    let value = values.remove("session_handle").ok_or(())?;
    OwnedObjectPath::try_from(String::try_from(value).map_err(|_| ())?).map_err(|_| ())
}

fn trigger(shortcuts: Shortcuts) -> Option<String> {
    let (_, mut options) = shortcuts.into_iter().find(|(id, _)| id == ID)?;
    let text = String::try_from(options.remove("trigger_description")?).ok()?;
    (!text.is_empty() && text.len() <= 1024 && !text.chars().any(char::is_control)).then_some(text)
}

fn binding() -> (&'static str, HashMap<&'static str, Value<'static>>) {
    (
        ID,
        HashMap::from([
            ("description", Value::from("Open Ibis")),
            ("preferred_trigger", Value::from("CTRL+SHIFT+y")),
        ]),
    )
}

async fn bounded<T, E>(future: impl std::future::Future<Output = Result<T, E>>) -> Result<T, ()> {
    tokio::time::timeout(CALL, future)
        .await
        .map_err(|_| ())?
        .map_err(|_| ())
}

/// Subscription is installed before sending, including for immediate responses.
async fn request(proxy: &Proxy<'_>, method: &str, session: Option<&OwnedObjectPath>) -> Result<Dict, Failure> {
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let token = format!("ibis_{}", SERIAL.fetch_add(1, Ordering::Relaxed));
    let sender = proxy.connection().unique_name().ok_or(())?.as_str()[1..].replace('.', "_");
    let path = format!("{ROOT}/request/{sender}/{token}");
    let response = bounded(Proxy::new(
        proxy.connection(),
        proxy.destination().clone(),
        path.as_str(),
        "org.freedesktop.portal.Request",
    ))
    .await?;
    let mut signals = bounded(response.receive_signal("Response")).await?;
    let mut options = HashMap::from([("handle_token", Value::from(token.as_str()))]);
    let returned: OwnedObjectPath = match session {
        None => {
            options.insert("session_handle_token", Value::from(token.as_str()));
            bounded(proxy.call(method, &(options,))).await?
        }
        Some(session) if method == "BindShortcuts" => {
            bounded(proxy.call(method, &(session, vec![binding()], "", options))).await?
        }
        Some(session) => bounded(proxy.call(method, &(session, options))).await?,
    };
    if returned.as_str() != path {
        return Err(Failure::Unavailable);
    }
    let result = tokio::time::timeout(RESPONSE, poll_fn(|cx| Pin::new(&mut signals).poll_next(cx))).await;
    match result {
        Ok(Some(message)) => successful(message.body().deserialize().map_err(|_| ())?),
        _ => {
            let _ = bounded(response.call::<_, _, ()>("Close", &())).await;
            Err(Failure::Unavailable)
        }
    }
}

pub(super) enum Event {
    Activated,
    Changed(Option<String>),
    Lost,
    Idle,
}

pub(super) struct Portal {
    connection: Connection,
    owner: String,
    session: OwnedObjectPath,
    signals: MessageStream,
    pub(super) trigger: Option<String>,
}

impl Portal {
    pub(super) async fn connect() -> Result<Self, Failure> {
        let connection = bounded(Connection::session()).await?;
        let bus = bounded(zbus::fdo::DBusProxy::new(&connection)).await?;
        // Properties.Get activates the service and proves the interface exists.
        let service = bounded(Proxy::new(&connection, SERVICE, ROOT, INTERFACE)).await?;
        let version: u32 = bounded(service.get_property("version")).await?;
        if version == 0 {
            return Err(Failure::Unavailable);
        }
        let owner = bounded(bus.get_name_owner(SERVICE.try_into().map_err(|_| ())?))
            .await?
            .to_string();
        let proxy = bounded(Proxy::new(&connection, owner.as_str(), ROOT, INTERFACE)).await?;
        let rule = zbus::MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .sender(owner.as_str())
            .map_err(|_| ())?
            .path_namespace(ROOT)
            .map_err(|_| ())?
            .build();
        let signals = bounded(MessageStream::for_match_rule(rule, &connection, Some(64))).await?;
        let session = session_handle(request(&proxy, "CreateSession", None).await?)?;
        let bound = request(&proxy, "BindShortcuts", Some(&session)).await?;
        let listed = request(&proxy, "ListShortcuts", Some(&session)).await.unwrap_or(bound);
        let trigger = listed
            .get("shortcuts")
            .and_then(|value| value.try_clone().ok())
            .and_then(|value| Shortcuts::try_from(value).ok())
            .and_then(trigger);
        drop(proxy);
        drop(service);
        drop(bus);
        Ok(Self {
            connection,
            owner,
            session,
            signals,
            trigger,
        })
    }

    pub(super) async fn next(&mut self) -> Result<Event, ()> {
        let message = match tokio::time::timeout(CALL, poll_fn(|cx| Pin::new(&mut self.signals).poll_next(cx))).await {
            Ok(Some(message)) => message.map_err(|_| ())?,
            Ok(None) => return Err(()),
            Err(_) => {
                let bus = bounded(zbus::fdo::DBusProxy::new(&self.connection)).await?;
                let owner = bounded(bus.get_name_owner(SERVICE.try_into().map_err(|_| ())?)).await?;
                return if owner.as_str() == self.owner {
                    Ok(Event::Idle)
                } else {
                    Err(())
                };
            }
        };
        let header = message.header();
        let member = header.member().map(|name| name.as_str());
        let interface = header.interface().map(|name| name.as_str());
        if interface == Some("org.freedesktop.portal.Session")
            && member == Some("Closed")
            && header.path().map(|path| path.as_str()) == Some(self.session.as_str())
        {
            return Ok(Event::Lost);
        }
        if interface != Some(INTERFACE) {
            return Ok(Event::Idle);
        }
        match member {
            Some("Activated") => {
                let (session, id, _, _): (OwnedObjectPath, String, u64, Dict) =
                    message.body().deserialize().map_err(|_| ())?;
                Ok(if session == self.session && id == ID {
                    Event::Activated
                } else {
                    Event::Idle
                })
            }
            Some("ShortcutsChanged") => {
                let (session, shortcuts): (OwnedObjectPath, Shortcuts) =
                    message.body().deserialize().map_err(|_| ())?;
                Ok(if session == self.session {
                    Event::Changed(trigger(shortcuts))
                } else {
                    Event::Idle
                })
            }
            _ => Ok(Event::Idle),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_handle_is_a_string_and_failures_are_not_success() {
        let values = HashMap::from([(
            "session_handle".into(),
            zbus::zvariant::Str::from("/session/one").into(),
        )]);
        assert_eq!(
            session_handle(values).ok().as_deref().map(|p| p.as_str()),
            Some("/session/one")
        );
        assert!(session_handle(HashMap::new()).is_err());
        assert!(session_handle(HashMap::from([("session_handle".into(), 4u32.into())])).is_err());
        assert!(
            session_handle(HashMap::from([(
                "session_handle".into(),
                zbus::zvariant::Str::from("bad path").into()
            )]))
            .is_err()
        );
        assert!(successful((1, HashMap::new())).is_err());
        assert!(successful((2, HashMap::new())).is_err());
        assert!(successful((0, HashMap::new())).is_ok());
    }

    #[test]
    fn only_the_desktop_trigger_for_our_action_is_displayed() {
        let entry = |id: &str, label: &str| {
            (
                id.into(),
                HashMap::from([("trigger_description".into(), zbus::zvariant::Str::from(label).into())]),
            )
        };
        assert_eq!(
            trigger(vec![entry("other", "wrong"), entry(ID, "Strg+Umschalt+Y")]),
            Some("Strg+Umschalt+Y".into())
        );
        assert_eq!(trigger(vec![]), None);
        assert_eq!(trigger(vec![entry(ID, "")]), None);
        assert_eq!(trigger(vec![entry(ID, &"x".repeat(1025))]), None);
        assert_eq!(trigger(vec![entry(ID, "bad\nlabel")]), None);
        let options = binding();
        assert_eq!(options.0, ID);
        assert_eq!(
            <&str>::try_from(&options.1["preferred_trigger"]).ok(),
            Some("CTRL+SHIFT+y")
        );
    }
}
