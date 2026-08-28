import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

function required(name) {
  const value = args.get(name)?.trim();
  if (!value) throw new Error(`generate-runtime-manifest: missing ${name}`);
  return value;
}

const inputDir = resolve(required("--input-dir"));
const baseUrl = required("--base-url").replace(/\/+$/, "");
const release = required("--release");
const output = resolve(required("--output"));
const targets = ["darwin-aarch64", "windows-x86_64", "linux-x86_64"];
const providers = ["codex", "dsh", "opencode", "pi-web"];

if (new URL(baseUrl).protocol !== "https:") {
  throw new Error("generate-runtime-manifest: --base-url must use HTTPS");
}

function providerVersion(provider) {
  const manifest = JSON.parse(
    readFileSync(join(root, "apps", "desktop", "src-tauri", "resources", provider, "manifest.json"), "utf8"),
  );
  return manifest.version || manifest.commit;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const targetEntries = {};
for (const target of targets) {
  const providerEntries = {};
  for (const provider of providers) {
    const filename = `${provider}.tar.gz`;
    const path = join(inputDir, target, filename);
    if (!existsSync(path)) throw new Error(`generate-runtime-manifest: missing ${path}`);
    providerEntries[provider] = {
      version: providerVersion(provider),
      url: `${baseUrl}/${target}/${basename(path)}`,
      sha256: await sha256(path),
      size: statSync(path).size,
    };
  }
  targetEntries[target] = { providers: providerEntries };
}

writeFileSync(
  output,
  `${JSON.stringify({ schemaVersion: 1, release, targets: targetEntries }, null, 2)}\n`,
);
