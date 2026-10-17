//! Local WebSocket server the browser extension connects to (127.0.0.1 only).

use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;

pub const PORT: u16 = 47615;

#[derive(Default, Clone, Serialize)]
pub struct ExtStatus {
    pub connected: usize,
    pub version: Option<String>,
}

pub struct Hub {
    tx: broadcast::Sender<String>,
    clients: AtomicUsize,
    recording: AtomicBool,
    version: Mutex<Option<String>>,
    events: Mutex<Vec<Value>>,
    /// Events are also appended here while recording, so a crash doesn't lose them.
    journal: Mutex<Option<File>>,
}

impl Hub {
    pub fn new() -> Arc<Self> {
        let (tx, _) = broadcast::channel(64);
        Arc::new(Hub {
            tx,
            clients: AtomicUsize::new(0),
            recording: AtomicBool::new(false),
            version: Mutex::new(None),
            events: Mutex::new(Vec::new()),
            journal: Mutex::new(None),
        })
    }

    pub fn status(&self) -> ExtStatus {
        ExtStatus { connected: self.clients.load(Ordering::Relaxed), version: self.version.lock().unwrap().clone() }
    }

    fn state_message(&self) -> String {
        serde_json::json!({ "type": "state", "recording": self.recording.load(Ordering::Relaxed) }).to_string()
    }

    /// Starts or stops collecting events and tells every connected browser.
    pub fn set_recording(&self, recording: bool, journal: Option<&Path>) {
        if recording {
            self.events.lock().unwrap().clear();
        }
        *self.journal.lock().unwrap() = journal.and_then(|p| File::create(p).ok());
        self.recording.store(recording, Ordering::Relaxed);
        let _ = self.tx.send(self.state_message());
    }

    pub fn take_events(&self) -> Vec<Value> {
        std::mem::take(&mut *self.events.lock().unwrap())
    }

    fn handle_text(&self, text: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(text) else { return };
        match msg.get("type").and_then(Value::as_str) {
            Some("hello") => {
                let version = msg.get("version").and_then(Value::as_str).map(str::to_owned);
                *self.version.lock().unwrap() = version;
            }
            Some("event") if self.recording.load(Ordering::Relaxed) => {
                if let Some(event) = msg.get("event") {
                    if let Some(file) = self.journal.lock().unwrap().as_mut() {
                        let _ = writeln!(file, "{event}");
                    }
                    self.events.lock().unwrap().push(event.clone());
                }
            }
            _ => {}
        }
    }
}

/// Only browser extensions may connect; web pages (http/https origins) are refused.
pub fn origin_allowed(origin: Option<&str>) -> bool {
    matches!(origin, Some(o) if o.starts_with("chrome-extension://")
        || o.starts_with("moz-extension://")
        || o.starts_with("safari-web-extension://"))
}

pub fn spawn(app: AppHandle, hub: Arc<Hub>) {
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("Stepcast: cannot listen on port {PORT}: {e}");
                return;
            }
        };
        while let Ok((stream, _)) = listener.accept().await {
            tauri::async_runtime::spawn(serve(stream, app.clone(), hub.clone()));
        }
    });
}

fn emit_status(app: &AppHandle, hub: &Hub) {
    let _ = app.emit("ext-status", hub.status());
}

async fn serve(stream: TcpStream, app: AppHandle, hub: Arc<Hub>) {
    let check = |req: &Request, res: Response| -> Result<Response, ErrorResponse> {
        let origin = req.headers().get("origin").and_then(|v| v.to_str().ok());
        if origin_allowed(origin) {
            Ok(res)
        } else {
            let mut err = ErrorResponse::new(Some("Forbidden".into()));
            *err.status_mut() = StatusCode::FORBIDDEN;
            Err(err)
        }
    };
    let Ok(ws) = tokio_tungstenite::accept_hdr_async(stream, check).await else { return };
    let (mut sink, mut source) = ws.split();
    let mut rx = hub.tx.subscribe();

    hub.clients.fetch_add(1, Ordering::Relaxed);
    let _ = sink.send(Message::text(hub.state_message())).await;

    loop {
        tokio::select! {
            incoming = source.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    let was_unknown = hub.version.lock().unwrap().is_none();
                    hub.handle_text(text.as_str());
                    if was_unknown { emit_status(&app, &hub); }
                }
                Some(Ok(Message::Ping(p))) => { let _ = sink.send(Message::Pong(p)).await; }
                Some(Ok(_)) => {}
                _ => break,
            },
            outgoing = rx.recv() => match outgoing {
                Ok(text) => { if sink.send(Message::text(text)).await.is_err() { break; } }
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(_) => break,
            },
        }
    }

    hub.clients.fetch_sub(1, Ordering::Relaxed);
    emit_status(&app, &hub);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_extensions_may_connect() {
        assert!(origin_allowed(Some("chrome-extension://abcdefghijklmnop")));
        assert!(origin_allowed(Some("moz-extension://1234")));
        assert!(!origin_allowed(Some("https://evil.example")));
        assert!(!origin_allowed(Some("http://localhost:3000")));
        assert!(!origin_allowed(None));
    }

    #[test]
    fn collects_events_only_while_recording() {
        let hub = Hub::new();
        let event = r#"{"type":"event","event":{"kind":"step","t":1,"action":"click","role":"link","name":"Products"}}"#;
        hub.handle_text(event);
        assert!(hub.take_events().is_empty());
        hub.set_recording(true, None);
        hub.handle_text(event);
        hub.handle_text(r#"{"type":"hello","browser":"chrome","version":"0.1.0"}"#);
        assert_eq!(hub.take_events().len(), 1);
        assert_eq!(hub.status().version.as_deref(), Some("0.1.0"));
    }
}
