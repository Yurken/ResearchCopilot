import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "vendor", "codex-harness");
const resourceRoot = join(root, "apps", "desktop", "src-tauri", "resources", "codex");
const runtimeRoot = join(resourceRoot, "runtime");
const manifestPath = join(resourceRoot, "manifest.json");
const args = new Set(process.argv.slice(2));

function fail(message) {
  throw new Error(`prepare-codex-runtime: ${message}`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    env: process.env,
    stdio: "inherit",
    shell: options.shell ?? false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(" ")} exited with ${result.status ?? "no status"}`);
  }
}

function gitOutput(commandArgs) {
  return execFileSync("git", commandArgs, { cwd: root, encoding: "utf8" }).trim();
}

// 与 prepare-dsh-runtime 一致的固定版本验证：submodule 指针必须与 manifest 提交一致，
// 升级内置运行时必须先更新 vendor/codex-harness 并同步本 manifest。
function verifyPin() {
  if (!existsSync(join(sourceRoot, "codex-rs", "Cargo.toml"))) {
    fail("Codex Harness submodule is missing; run git submodule update --init --recursive");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const sourceCommit = gitOutput(["-C", sourceRoot, "rev-parse", "HEAD"]);
  if (sourceCommit !== manifest.commit) {
    fail(`submodule commit ${sourceCommit} does not match manifest ${manifest.commit}`);
  }
  console.log(`Codex source pin verified: ${sourceCommit.slice(0, 8)}`);
  return manifest;
}

function buildRuntime(buildRoot, manifest) {
  const cargo = process.env.CODEX_CARGO?.trim() || "cargo";
  // codex-rs/rust-toolchain.toml 固定工具链（当前 1.95.0），rustup 会自动补齐。
  run(cargo, [
    "build",
    "--release",
    "--locked",
    "--manifest-path",
    join(buildRoot, "codex-rs", "Cargo.toml"),
    "-p",
    "codex-cli",
  ]);

  if (runtimeRoot === root || root.startsWith(`${runtimeRoot}${sep}`)) {
    fail(`refusing to clear unsafe runtime directory ${runtimeRoot}`);
  }
  rmSync(runtimeRoot, { recursive: true, force: true });
  const binDir = join(runtimeRoot, "bin");
  mkdirSync(binDir, { recursive: true });

  const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
  const builtBinary = join(buildRoot, "codex-rs", "target", "release", binaryName);
  if (!existsSync(builtBinary)) {
    fail(`built binary is missing: ${builtBinary}`);
  }
  const targetBinary = join(binDir, binaryName);
  copyFileSync(builtBinary, targetBinary);
  if (process.platform !== "win32") chmodSync(targetBinary, 0o755);
  copyFileSync(join(buildRoot, "LICENSE"), join(runtimeRoot, "LICENSE.codex"));

  // 上游开发构建不自报语义版本，记录实际 --version 输出用于审计。
  const reportedVersion = execFileSync(targetBinary, ["--version"], { encoding: "utf8" }).trim();
  writeFileSync(
    join(runtimeRoot, "build.json"),
    `${JSON.stringify(
      {
        codexVersion: reportedVersion,
        codexCommit: manifest.commit,
        platform: process.platform,
        arch: process.arch,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Codex runtime ready: ${runtimeRoot} (${reportedVersion})`);
}

function verifyClonedCommit(buildRoot, manifest) {
  const clonedCommit = execFileSync("git", ["-C", buildRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (clonedCommit !== manifest.commit) {
    fail(`isolated source clone resolved to unexpected commit ${clonedCommit}`);
  }
}

function prepareRuntime() {
  const manifest = verifyPin();
  if (args.has("--verify-only")) return;

  // 设置 XIAOYAN_CODEX_BUILD_DIR 可复用构建目录：Rust 编译耗时长，
  // 保留 target/ 缓存便于本地续建与 CI 增量构建；默认仍在临时目录克隆编译，
  // 避免在 submodule 工作区留下构建产物。
  const overrideRoot = process.env.XIAOYAN_CODEX_BUILD_DIR?.trim();
  if (overrideRoot) {
    const buildRoot = resolve(overrideRoot);
    if (!existsSync(join(buildRoot, "codex-rs", "Cargo.toml"))) {
      run("git", ["clone", "--no-hardlinks", "--quiet", sourceRoot, buildRoot]);
    }
    verifyClonedCommit(buildRoot, manifest);
    buildRuntime(buildRoot, manifest);
    return;
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "xiaoyan-codex-build-"));
  const buildRoot = join(temporaryRoot, "source");
  try {
    run("git", ["clone", "--no-hardlinks", "--quiet", sourceRoot, buildRoot]);
    verifyClonedCommit(buildRoot, manifest);
    buildRuntime(buildRoot, manifest);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

prepareRuntime();
