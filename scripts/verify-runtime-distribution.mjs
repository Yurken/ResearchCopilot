import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauri = JSON.parse(readFileSync(resolve(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"));
const resources = Object.keys(tauri.bundle?.resources ?? {});
const forbidden = ["codex", "dsh", "opencode", "pi-web"];
const bundled = resources.filter((resource) => forbidden.some((provider) => resource.includes(`resources/${provider}`)));

if (bundled.length > 0) {
  throw new Error(`Harness runtimes must not be bundled: ${bundled.join(", ")}`);
}

const releaseWorkflow = readFileSync(resolve(root, ".github/workflows/desktop-release.yml"), "utf8");
const buildCommands = forbidden.filter((provider) => releaseWorkflow.includes(`${provider}:prepare-runtime`));
if (buildCommands.length > 0) {
  throw new Error(`Desktop release must not prepare managed runtimes: ${buildCommands.join(", ")}`);
}

console.log("Runtime distribution invariant verified: desktop installers exclude all Harness runtimes.");
