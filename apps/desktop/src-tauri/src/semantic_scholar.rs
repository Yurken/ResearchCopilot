use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};

use tokio::sync::Mutex;

// 无 Key 的公开额度按 1 req/s 计；留出 250ms 抖动余量，避免连续评测时在
// 服务端窗口边界触发 429。带 Key 的调用仍共享这个保守节流器。
const SEMANTIC_SCHOLAR_MIN_INTERVAL: Duration = Duration::from_millis(1_250);

static SEMANTIC_SCHOLAR_RATE_LIMITER: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

/// Semantic Scholar applies a cumulative 1 request/second limit across endpoints.
pub async fn throttle_semantic_scholar_request() {
    let limiter = SEMANTIC_SCHOLAR_RATE_LIMITER.get_or_init(|| Mutex::new(None));
    let mut last_request_at = limiter.lock().await;

    if let Some(previous) = *last_request_at {
        let elapsed = previous.elapsed();
        if elapsed < SEMANTIC_SCHOLAR_MIN_INTERVAL {
            tokio::time::sleep(SEMANTIC_SCHOLAR_MIN_INTERVAL - elapsed).await;
        }
    }

    *last_request_at = Some(Instant::now());
}
