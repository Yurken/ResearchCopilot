const DEFAULT_MANIFEST_URL =
  "https://pub-9c3110eb71b241e5a88d8aa3388af9a2.r2.dev/runtimes/latest.json";
const manifestUrl = process.argv[2]?.trim() || process.env.XIAOYAN_RUNTIME_MANIFEST_URL?.trim() || DEFAULT_MANIFEST_URL;
const targets = ["darwin-aarch64", "windows-x86_64", "linux-x86_64"];
const providers = ["codex", "dsh", "opencode", "pi-web"];

function fail(message) {
  throw new Error(`verify-published-runtime-manifest: ${message}`);
}

function validateArtifact(target, provider, artifact) {
  if (!artifact || typeof artifact !== "object") fail(`missing ${target}/${provider}`);
  if (typeof artifact.version !== "string" || !artifact.version.trim()) {
    fail(`${target}/${provider} has no version`);
  }
  if (!/^https:\/\//.test(artifact.url ?? "")) fail(`${target}/${provider} URL must use HTTPS`);
  if (!/^[a-f0-9]{64}$/i.test(artifact.sha256 ?? "")) fail(`${target}/${provider} has an invalid SHA-256`);
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) fail(`${target}/${provider} has an invalid size`);
}

const response = await fetch(manifestUrl, { redirect: "follow" });
if (!response.ok) fail(`manifest request returned HTTP ${response.status}: ${manifestUrl}`);
const manifest = await response.json();
if (manifest.schemaVersion !== 1) fail(`unsupported schemaVersion ${String(manifest.schemaVersion)}`);
if (typeof manifest.release !== "string" || !manifest.release.trim()) fail("manifest has no release id");

const artifacts = [];
for (const target of targets) {
  for (const provider of providers) {
    const artifact = manifest.targets?.[target]?.providers?.[provider];
    validateArtifact(target, provider, artifact);
    artifacts.push({ target, provider, ...artifact });
  }
}

await Promise.all(
  artifacts.map(async (artifact) => {
    const head = await fetch(artifact.url, { method: "HEAD", redirect: "follow" });
    if (!head.ok) fail(`${artifact.target}/${artifact.provider} returned HTTP ${head.status}`);
    const length = Number(head.headers.get("content-length"));
    if (Number.isFinite(length) && length > 0 && length !== artifact.size) {
      fail(`${artifact.target}/${artifact.provider} size is ${length}, manifest declares ${artifact.size}`);
    }
  }),
);

console.log(`Published runtime manifest verified: ${manifest.release} (${artifacts.length} artifacts)`);
