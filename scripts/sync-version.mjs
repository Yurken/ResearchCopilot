#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseReleaseVersion } from "./versioning.mjs";

const root = process.cwd();
const args = process.argv.slice(2);

function getArg(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function firstNonEmpty(values) {
  return values.find((value) => typeof value === "string" && value.trim() !== "");
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function writeText(relativePath, contents) {
  fs.writeFileSync(path.join(root, relativePath), contents, "utf8");
}

function updateJson(relativePath, updater, touched) {
  const current = readText(relativePath);
  const json = JSON.parse(current);
  updater(json);
  const next = `${JSON.stringify(json, null, 2)}\n`;
  if (current !== next) {
    writeText(relativePath, next);
    touched.push(relativePath);
  }
}

function updateText(relativePath, updater, touched) {
  const current = readText(relativePath);
  const next = updater(current);
  if (current !== next) {
    writeText(relativePath, next);
    touched.push(relativePath);
  }
}

function writeTextIfChanged(relativePath, contents, touched) {
  const current = fs.existsSync(path.join(root, relativePath)) ? readText(relativePath) : "";
  if (current === contents) return;
  writeText(relativePath, contents);
  touched.push(relativePath);
}

const rawVersion = firstNonEmpty([
  getArg("--version"),
  getArg("--tag"),
  process.env.RELEASE_TAG,
  process.env.GITHUB_REF_NAME,
  process.env.TAG_NAME,
]);

if (!rawVersion) {
  throw new Error("Missing version. Use --version 1.2.3, --version 1.2.3.4, or the corresponding v-prefixed tag.");
}

const { releaseVersion, appVersion, isFourPart } = parseReleaseVersion(rawVersion);
const touched = [];

for (const file of [
  "package.json",
  "apps/desktop/package.json",
  "apps/mobile/package.json",
  "apps/web/package.json",
  "packages/config/package.json",
  "packages/types/package.json",
  "packages/ui/package.json",
]) {
  updateJson(file, (json) => {
    json.version = appVersion;
  }, touched);
}

updateJson("apps/mobile/app.json", (json) => {
  json.expo.version = appVersion;
}, touched);

updateJson("apps/desktop/src-tauri/tauri.conf.json", (json) => {
  json.version = appVersion;
}, touched);

updateText("apps/desktop/src-tauri/Cargo.toml", (text) => {
  return text.replace(/^version = ".*"$/m, `version = "${appVersion}"`);
}, touched);

updateText("apps/desktop/src-tauri/Cargo.lock", (text) => {
  return text.replace(
    /(\[\[package\]\]\nname = "xiaoyan-desktop"\nversion = ")[^"]+("\n)/,
    `$1${appVersion}$2`,
  );
}, touched);

updateText("apps/desktop/src-tauri/src/commands/arxiv.rs", (text) => {
  return text.replace(
    /^(const ARXIV_USER_AGENT: &str = "xiaoyan-desktop\/)[0-9A-Za-z.+-]+(?= )/m,
    `$1${appVersion}`,
  );
}, touched);

updateText("apps/desktop/src-tauri/src/commands/field_dynamics.rs", (text) => {
  return text.replace(
    /^(const FIELD_DYNAMICS_IMPORT_USER_AGENT: &str = "XiaoYanDesktop\/)[0-9A-Za-z.+-]+(?= )/m,
    `$1${appVersion}`,
  );
}, touched);

updateText("README.md", (text) => {
  return text
    .replace(/(badge\/release-v)[0-9A-Za-z.+-]+(-)/, `$1${releaseVersion}$2`)
    .replace(/(> 当前版本：\*\*v)[0-9A-Za-z.+-]+(\*\*。)/, `$1${releaseVersion}$2`)
    .replace(/(<summary><strong>查看 v)[0-9A-Za-z.+-]+( 主要更新<\/strong><\/summary>)/, `$1${releaseVersion}$2`);
}, touched);

updateText("apps/desktop/src-tauri/src/commands/paper_search.rs", (text) => {
  return text.replace(
    /^(const SEMANTIC_SCHOLAR_USER_AGENT: &str = "xiaoyan-desktop\/)[0-9A-Za-z.+-]+(")/m,
    `$1${appVersion}$2`,
  );
}, touched);

for (const file of [
  "apps/desktop/src-tauri/src/commands/paper_search_snippets.rs",
  "apps/desktop/src-tauri/src/commands/paper_search_strategy.rs",
]) {
  updateText(file, (text) => {
    return text.replace(
      /^(const (?:SEMANTIC_SCHOLAR_USER_AGENT|USER_AGENT): &str = "xiaoyan-desktop\/)[0-9A-Za-z.+-]+(")/m,
      `$1${appVersion}$2`,
    );
  }, touched);
}

updateText("scripts/paper-search-eval/prepare_gold_metadata.py", (text) => {
  return text.replace(
    /(User-Agent": "xiaoyan-paper-search-eval\/)[0-9A-Za-z.+-]+(")/,
    `$1${appVersion}$2`,
  );
}, touched);

updateText("scripts/paper-search-eval/probe_snippet_search.py", (text) => {
  return text.replace(
    /(User-Agent": "xiaoyan-paper-search-eval\/)[0-9A-Za-z.+-]+(")/,
    `$1${appVersion}$2`,
  );
}, touched);

if (touched.length === 0) {
  console.log(`Version already synced: ${appVersion}`);
} else {
  console.log(`Synced version ${appVersion} in ${touched.length} files`);
  for (const file of touched) {
    console.log(`- ${file}`);
  }
}

if (isFourPart) {
  console.log(`Release revision v${releaseVersion} is represented as SemVer ${appVersion} for Cargo, Tauri, and the updater.`);
}
