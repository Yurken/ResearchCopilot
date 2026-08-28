use serde::Serialize;
use std::{net::SocketAddr, path::Path};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
    task::JoinHandle,
};

const INDEX_HTML: &str = include_str!("index.html");
const APP_JS: &str = include_str!("app.js");
const STYLES_CSS: &str = include_str!("styles.css");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig<'a> {
    app_server_url: &'a str,
    workspace: &'a str,
}

pub struct CodexWebServer {
    pub url: String,
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}

impl CodexWebServer {
    pub fn stop(mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        self.task.abort();
    }
}

pub async fn start(app_server_url: String, workspace: &Path) -> Result<CodexWebServer, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("无法启动 Codex Web 页面：{error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("无法读取 Codex Web 地址：{error}"))?;
    let runtime_json = serde_json::to_string(&RuntimeConfig {
        app_server_url: &app_server_url,
        workspace: &workspace.to_string_lossy(),
    })
    .map_err(|error| format!("无法生成 Codex Web 配置：{error}"))?;
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel();
    let task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => break,
                incoming = listener.accept() => {
                    let Ok((stream, peer)) = incoming else { break };
                    if !peer.ip().is_loopback() {
                        continue;
                    }
                    let runtime_json = runtime_json.clone();
                    tokio::spawn(async move {
                        let _ = serve_connection(stream, peer, &runtime_json).await;
                    });
                }
            }
        }
    });
    Ok(CodexWebServer {
        url: format!("http://{address}/"),
        shutdown: Some(shutdown_tx),
        task,
    })
}

async fn serve_connection(
    mut stream: TcpStream,
    _peer: SocketAddr,
    runtime_json: &str,
) -> std::io::Result<()> {
    let mut request = [0_u8; 8192];
    let count = stream.read(&mut request).await?;
    let request = String::from_utf8_lossy(&request[..count]);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.split('?').next())
        .unwrap_or("/");
    let (status, content_type, body) = match path {
        "/" | "/index.html" => ("200 OK", "text/html; charset=utf-8", INDEX_HTML),
        "/app.js" => ("200 OK", "text/javascript; charset=utf-8", APP_JS),
        "/styles.css" => ("200 OK", "text/css; charset=utf-8", STYLES_CSS),
        "/runtime.json" => ("200 OK", "application/json; charset=utf-8", runtime_json),
        "/health" => ("200 OK", "text/plain; charset=utf-8", "ok"),
        _ => ("404 Not Found", "text/plain; charset=utf-8", "Not found"),
    };
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; connect-src ws://127.0.0.1:*; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'self' tauri: http://tauri.localhost https://tauri.localhost http://localhost https://localhost\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(headers.as_bytes()).await?;
    stream.write_all(body.as_bytes()).await?;
    stream.shutdown().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_only_the_public_runtime_configuration() {
        let config = RuntimeConfig {
            app_server_url: "ws://127.0.0.1:4510",
            workspace: "/tmp/project",
        };
        let json = serde_json::to_string(&config).expect("runtime configuration");
        assert_eq!(
            json,
            r#"{"appServerUrl":"ws://127.0.0.1:4510","workspace":"/tmp/project"}"#
        );
        assert!(INDEX_HTML.contains("/app.js"));
    }
}
