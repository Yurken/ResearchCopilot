use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::{
    collections::VecDeque,
    io,
    net::SocketAddr,
    path::Path,
    pin::Pin,
    task::{Context, Poll},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::oneshot,
    task::JoinHandle,
};

const INDEX_HTML: &str = include_str!("index.html");
const APP_JS: &str = include_str!("app.js");
const STYLES_CSS: &str = include_str!("styles.css");
/// 允许小妍 WebView 嵌入：开发态是 `http://localhost:1420`，打包后是 `tauri.localhost`。
/// `http://localhost` 不含端口，匹配不到 Vite 的 1420，必须使用 `:*`。
const CONTENT_SECURITY_POLICY: &str = "default-src 'self'; connect-src ws://127.0.0.1:*; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'self' tauri: asset: http://tauri.localhost https://tauri.localhost http://tauri.localhost:* https://tauri.localhost:* http://asset.localhost:* https://asset.localhost:* http://localhost http://localhost:* https://localhost:* http://localhost:1420 http://127.0.0.1:* http://127.0.0.1:1420";

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
    // 官方 app-server 会拒绝任何携带 Origin 头的 WebSocket 握手（403），
    // 浏览器/WebView 又必然携带 Origin，因此页面只能连接本服务的 /ws 代理。
    let proxy_url = format!("ws://{address}/ws");
    let runtime_json = serde_json::to_string(&RuntimeConfig {
        app_server_url: &proxy_url,
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
                    let app_server_url = app_server_url.clone();
                    tokio::spawn(async move {
                        let _ = serve_connection(stream, peer, &runtime_json, &app_server_url).await;
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
    app_server_url: &str,
) -> io::Result<()> {
    let mut request = [0_u8; 8192];
    let count = stream.read(&mut request).await?;
    let head = &request[..count];
    let request_text = String::from_utf8_lossy(head);
    let path = request_text
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.split('?').next())
        .unwrap_or("/")
        .to_string();
    let is_websocket_upgrade = request_text
        .to_ascii_lowercase()
        .contains("\r\nupgrade: websocket");
    if path == "/ws" && is_websocket_upgrade {
        return proxy_websocket(stream, head.to_vec(), app_server_url).await;
    }
    let (status, content_type, body) = match path.as_str() {
        "/" | "/index.html" => ("200 OK", "text/html; charset=utf-8", INDEX_HTML),
        "/app.js" => ("200 OK", "text/javascript; charset=utf-8", APP_JS),
        "/styles.css" => ("200 OK", "text/css; charset=utf-8", STYLES_CSS),
        "/runtime.json" => ("200 OK", "application/json; charset=utf-8", runtime_json),
        "/health" => ("200 OK", "text/plain; charset=utf-8", "ok"),
        _ => ("404 Not Found", "text/plain; charset=utf-8", "Not found"),
    };
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: {CONTENT_SECURITY_POLICY}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(headers.as_bytes()).await?;
    stream.write_all(body.as_bytes()).await?;
    stream.shutdown().await
}

/// 已被调用方读过一部分请求头的 TCP 流：先重放缓冲字节，再透传底层流，
/// 使 `accept_async` 能看到完整的握手请求。
struct ReplayStream {
    head: VecDeque<u8>,
    stream: TcpStream,
}

impl AsyncRead for ReplayStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if !self.head.is_empty() {
            let contiguous = self.head.make_contiguous();
            let count = contiguous.len().min(buf.remaining());
            buf.put_slice(&contiguous[..count]);
            self.head.drain(..count);
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut self.stream).poll_read(cx, buf)
    }
}

impl AsyncWrite for ReplayStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.stream).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

/// 双向转发 WebSocket 帧：下行（页面）连接由本服务接受（不校验 Origin），
/// 上行（app-server）由 tokio-tungstenite 客户端发起，不携带 Origin 头。
async fn proxy_websocket(
    stream: TcpStream,
    head: Vec<u8>,
    app_server_url: &str,
) -> io::Result<()> {
    let downstream = tokio_tungstenite::accept_async(ReplayStream {
        head: VecDeque::from(head),
        stream,
    })
    .await
    .map_err(|error| io::Error::other(format!("WebSocket 握手失败：{error}")))?;
    let (upstream, _response) = tokio_tungstenite::connect_async(app_server_url)
        .await
        .map_err(|error| io::Error::other(format!("连接 Codex app-server 失败：{error}")))?;
    let (mut downstream_tx, mut downstream_rx) = downstream.split();
    let (mut upstream_tx, mut upstream_rx) = upstream.split();
    let to_upstream = async move {
        while let Some(Ok(message)) = downstream_rx.next().await {
            if upstream_tx.send(message).await.is_err() {
                break;
            }
        }
        let _ = upstream_tx.close().await;
    };
    let to_downstream = async move {
        while let Some(Ok(message)) = upstream_rx.next().await {
            if downstream_tx.send(message).await.is_err() {
                break;
            }
        }
        let _ = downstream_tx.close().await;
    };
    tokio::join!(to_upstream, to_downstream);
    Ok(())
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

    #[test]
    fn allows_xiaoyan_webview_to_embed_loopback_pages() {
        assert!(CONTENT_SECURITY_POLICY.contains("http://localhost:*"));
        assert!(CONTENT_SECURITY_POLICY.contains("http://localhost:1420"));
        assert!(CONTENT_SECURITY_POLICY.contains("http://127.0.0.1:*"));
        assert!(CONTENT_SECURITY_POLICY.contains("https://tauri.localhost"));
        assert!(!CONTENT_SECURITY_POLICY.contains("frame-ancestors 'none'"));
    }
}
