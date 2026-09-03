use std::fs;
use std::path::Path;
use std::process::Command;

use serde::Deserialize;

use crate::types::{GitOverview, PluginSummary, PullRequestSummary};

pub fn git_overview(workspace: &Path) -> GitOverview {
    if !git_output(workspace, &["rev-parse", "--is-inside-work-tree"])
        .is_some_and(|value| value.trim() == "true")
    {
        return GitOverview {
            is_repository: false,
            branch: None,
            remote: None,
            changes: Vec::new(),
            pull_requests: Vec::new(),
            pull_requests_message: Some("当前工作区不是 Git 仓库".into()),
        };
    }
    let branch = git_output(workspace, &["branch", "--show-current"])
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let remote = git_output(workspace, &["remote", "get-url", "origin"])
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let changes = git_output(workspace, &["status", "--short"])
        .map(|value| value.lines().map(str::to_owned).collect())
        .unwrap_or_default();
    let (pull_requests, pull_requests_message) = pull_requests(workspace);
    GitOverview {
        is_repository: true,
        branch,
        remote,
        changes,
        pull_requests,
        pull_requests_message,
    }
}

pub fn plugins(workspace: &Path) -> Vec<PluginSummary> {
    let mut summaries = Vec::new();
    let mut roots = vec![
        workspace.join(".open-artifex/plugins"),
        workspace.join("plugins"),
    ];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".local/share/open-artifex/plugins"));
    }
    for root in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(summary) = plugin_at(&path) {
                summaries.push(summary);
            }
        }
    }
    summaries.sort_by(|left, right| left.name.cmp(&right.name));
    summaries.dedup_by(|left, right| left.path == right.path);
    summaries
}

fn git_output(workspace: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(workspace)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

fn pull_requests(workspace: &Path) -> (Vec<PullRequestSummary>, Option<String>) {
    let output = Command::new("gh")
        .args([
            "pr",
            "list",
            "--limit",
            "30",
            "--json",
            "number,title,url,state,headRefName,updatedAt",
        ])
        .current_dir(workspace)
        .output();
    let Ok(output) = output else {
        return (
            Vec::new(),
            Some("未安装 GitHub CLI，无法读取拉取请求".into()),
        );
    };
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return (
            Vec::new(),
            Some(if message.is_empty() {
                "GitHub CLI 未登录或当前远程仓库不可用".into()
            } else {
                message
            }),
        );
    }
    let parsed: Vec<GhPullRequest> = serde_json::from_slice(&output.stdout).unwrap_or_default();
    (
        parsed
            .into_iter()
            .map(|pull_request| PullRequestSummary {
                number: pull_request.number,
                title: pull_request.title,
                url: pull_request.url,
                state: pull_request.state,
                branch: pull_request.head_ref_name,
                updated_at: pull_request.updated_at,
            })
            .collect(),
        None,
    )
}

fn plugin_at(path: &Path) -> Option<PluginSummary> {
    let manifest = [
        path.join("plugin.json"),
        path.join(".open-artifex/plugin.json"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())?;
    let source = fs::read_to_string(manifest).ok()?;
    let value: PluginManifest = serde_json::from_str(&source).ok()?;
    Some(PluginSummary {
        name: value.name,
        version: value.version,
        path: path.to_string_lossy().into(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPullRequest {
    number: u64,
    title: String,
    url: String,
    state: String,
    head_ref_name: String,
    updated_at: String,
}

#[derive(Deserialize)]
struct PluginManifest {
    name: String,
    version: Option<String>,
}
