//! 把 DSH session 日志里的 token 用量汇总进小妍本地统计。
//!
//! DSH 在运行时会把 `assistant/message` 事件（含 provider 返回的 usage）写入
//! `$DSH_HOME/sessions/` 下的 `.jsonl` 文件。 Xiaoyan 自己的 `llm.rs` 统计只覆盖
//! 直接经过小妍代码的调用；DSH 内部通过 Xiaoyan API 或直接适配器产生的模型调用
//! 需要额外从这里补录，避免设置页里的 token 统计漏记。

use crate::{append_diagnostic_log, token_usage};
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use std::{
    io,
    path::{Path, PathBuf},
};

/// 扫描 `data_home/sessions/**/*.jsonl`，把尚未汇总过的 `assistant/message`
/// 事件的 usage 累加进 `token_usage_daily`，并记录每个 session 文件的水位。
pub async fn collect_usage(data_home: &Path, pool: &SqlitePool) {
    let sessions_dir = data_home.join("sessions");
    if !sessions_dir.is_dir() {
        return;
    }

    let files = match tokio::task::spawn_blocking({
        let dir = sessions_dir.clone();
        move || collect_jsonl_files(&dir)
    })
    .await
    {
        Ok(Ok(files)) => files,
        Ok(Err(error)) => {
            append_diagnostic_log(&format!("[dsh_usage] list session files failed: {error}"));
            return;
        }
        Err(error) => {
            append_diagnostic_log(&format!("[dsh_usage] list session files panicked: {error}"));
            return;
        }
    };

    if files.is_empty() {
        return;
    }

    let mut total_input: u64 = 0;
    let mut total_output: u64 = 0;

    for path in files {
        match collect_file(&path, pool).await {
            Ok((input, output)) => {
                total_input += input;
                total_output += output;
            }
            Err(error) => {
                append_diagnostic_log(&format!(
                    "[dsh_usage] failed to collect {}: {error}",
                    path.display()
                ));
            }
        }
    }

    if total_input > 0 || total_output > 0 {
        token_usage::record(total_input, total_output, 0, 0);
        append_diagnostic_log(&format!(
            "[dsh_usage] recorded input={total_input} output={total_output}"
        ));
    }
}

fn collect_jsonl_files(dir: &Path) -> io::Result<Vec<PathBuf>> {
    let mut result = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in std::fs::read_dir(current)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                result.push(path);
            }
        }
    }
    Ok(result)
}

async fn collect_file(path: &Path, pool: &SqlitePool) -> io::Result<(u64, u64)> {
    let metadata = tokio::fs::metadata(path).await?;
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let path_str = path.to_string_lossy().to_string();

    let (mut max_seq, last_recorded_mtime): (i64, i64) = sqlx::query(
        "SELECT max_seq, last_modified_at FROM dsh_usage_recorded WHERE session_file_path = ?",
    )
    .bind(&path_str)
    .fetch_optional(pool)
    .await
    .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?
    .map(|row| (row.get::<i64, _>("max_seq"), row.get::<i64, _>("last_modified_at")))
    .unwrap_or((0, 0));

    // 文件自上次汇总后没有修改过，直接跳过。
    if mtime <= last_recorded_mtime && max_seq > 0 {
        return Ok((0, 0));
    }

    let content = tokio::fs::read_to_string(path).await?;
    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;
    let mut new_max_seq = max_seq;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let seq = value.get("seq").and_then(Value::as_i64).unwrap_or(0);
        if seq <= max_seq {
            continue;
        }
        if seq > new_max_seq {
            new_max_seq = seq;
        }

        if value.get("type").and_then(Value::as_str) != Some("assistant/message") {
            continue;
        }

        let usage = value
            .get("data")
            .and_then(|d| d.get("message"))
            .and_then(|m| m.get("usage"));
        if let Some(usage) = usage {
            if let Some(input) = usage.get("inputTokens").and_then(Value::as_u64) {
                input_tokens += input;
            }
            if let Some(output) = usage.get("outputTokens").and_then(Value::as_u64) {
                output_tokens += output;
            }
        }
    }

    sqlx::query(
        "INSERT OR REPLACE INTO dsh_usage_recorded
         (session_file_path, max_seq, last_modified_at, recorded_at)
         VALUES (?, ?, ?, datetime('now'))",
    )
    .bind(&path_str)
    .bind(new_max_seq)
    .bind(mtime)
    .execute(pool)
    .await
    .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;

    Ok((input_tokens, output_tokens))
}
