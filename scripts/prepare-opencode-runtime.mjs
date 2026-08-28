import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "vendor", "opencode-harness");
const resourceRoot = join(root, "apps", "desktop", "src-tauri", "resources", "opencode");
const runtimeRoot = join(resourceRoot, "runtime");
const manifestPath = join(resourceRoot, "manifest.json");
const args = new Set(process.argv.slice(2));

// 与 vendor/opencode-harness package.json 的 packageManager 字段保持一致。
const BUN_VERSION = "1.3.14";

function fail(message) {
  throw new Error(`prepare-opencode-runtime: ${message}`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...(options.env ?? {}) },
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

// 与 prepare-dsh-runtime / prepare-codex-runtime 一致的固定版本验证：
// submodule 指针与上游版本必须和 manifest 一致，升级内置运行时必须先更新
// vendor/opencode-harness 并同步本 manifest。
function verifyPin() {
  const sourcePackagePath = join(sourceRoot, "packages", "opencode", "package.json");
  if (!existsSync(sourcePackagePath)) {
    fail("OpenCode submodule is missing; run git submodule update --init --recursive");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const sourcePackage = JSON.parse(readFileSync(sourcePackagePath, "utf8"));
  const sourceCommit = gitOutput(["-C", sourceRoot, "rev-parse", "HEAD"]);
  if (sourceCommit !== manifest.commit) {
    fail(`submodule commit ${sourceCommit} does not match manifest ${manifest.commit}`);
  }
  if (sourcePackage.version !== manifest.version) {
    fail(`source version ${sourcePackage.version} does not match manifest ${manifest.version}`);
  }
  console.log(`OpenCode source pin verified: ${manifest.version} (${sourceCommit.slice(0, 8)})`);
  return manifest;
}

function bunArtifactName() {
  const platformNames = { darwin: "darwin", linux: "linux", win32: "windows" };
  const platform = platformNames[process.platform];
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x64" : null;
  if (!platform || !arch) {
    fail(`unsupported platform for automatic bun download: ${process.platform}/${process.arch}`);
  }
  return `bun-${platform}-${arch}`;
}

function download(url, destination) {
  const result = spawnSync(
    "curl",
    ["-fL", "--retry", "3", "--silent", "--show-error", "-o", destination, url],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`failed to download ${url}`);
}

// OpenCode 上游使用 bun 编译单文件可执行程序。bun 不在 PATH 时从官方
// GitHub Releases 拉取固定版本并校验 SHASUMS256（与 rustup 自动补齐
// 工具链同一思路，构建机无需预装 bun）。
function resolveBun(cacheRoot) {
  const explicit = process.env.OPENCODE_BUN?.trim();
  if (explicit) {
    if (!existsSync(explicit)) fail(`OPENCODE_BUN does not exist: ${explicit}`);
    return explicit;
  }
  const probe = spawnSync("bun", ["--version"], { encoding: "utf8" });
  if (!probe.error && probe.status === 0) {
    console.log(`using bun from PATH: ${probe.stdout.trim()}`);
    return "bun";
  }

  const artifact = bunArtifactName();
  const bunDir = join(cacheRoot, "bun", `v${BUN_VERSION}`);
  const bunBinary = join(bunDir, artifact, process.platform === "win32" ? "bun.exe" : "bun");
  if (existsSync(bunBinary)) return bunBinary;

  mkdirSync(bunDir, { recursive: true });
  const baseUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}`;
  const archivePath = join(bunDir, `${artifact}.zip`);
  const checksumsPath = join(bunDir, "SHASUMS256.txt");
  download(`${baseUrl}/${artifact}.zip`, archivePath);
  download(`${baseUrl}/SHASUMS256.txt`, checksumsPath);

  const expected = readFileSync(checksumsPath, "utf8")
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === `${artifact}.zip`)?.[0];
  if (!expected) fail(`SHASUMS256.txt does not list ${artifact}.zip`);
  const actual = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (actual !== expected) {
    fail(`bun archive checksum mismatch: expected ${expected}, got ${actual}`);
  }

  run("unzip", ["-q", "-o", archivePath, "-d", bunDir]);
  rmSync(archivePath, { force: true });
  if (!existsSync(bunBinary)) fail(`bun binary missing after extraction: ${bunBinary}`);
  if (process.platform !== "win32") chmodSync(bunBinary, 0o755);
  console.log(`downloaded bun ${BUN_VERSION}: ${bunBinary}`);
  return bunBinary;
}

function builtBinaryName() {
  const os = process.platform === "win32" ? "windows" : process.platform;
  return join(
    "dist",
    `opencode-${os}-${process.arch}`,
    "bin",
    process.platform === "win32" ? "opencode.exe" : "opencode",
  );
}

function buildRuntime(buildRoot, manifest, bun) {
  // 上游根 package.json 带 husky prepare 钩子；隔离构建不得改动 Git 配置。
  // bun 可能是脚本下载的独立二进制：postinstall 等上游钩子按名字再调 bun，
  // 必须把它所在目录放到 PATH 最前；bun 来自 PATH 时无需处理。
  const pathPrefix = bun.includes(sep) ? `${dirname(resolve(bun))}${delimiter}` : "";
  const env = {
    CI: "true",
    HUSKY: "0",
    PATH: `${pathPrefix}${process.env.PATH ?? ""}`,
    // 上游 Script.version 优先读 OPENCODE_VERSION：固定构建必须注入 manifest
    // 版本，否则二进制自报 0.0.0-dev-*，既无法审计也会被版本安全门槛拦截。
    OPENCODE_VERSION: manifest.version,
  };
  run(bun, ["install", "--frozen-lockfile"], { cwd: buildRoot, env });
  // --single 只编译当前平台；--skip-install 跳过跨平台可选依赖拉取，
  // 当前平台依赖已由根 bun install 提供。
  run(bun, ["run", "--cwd", join(buildRoot, "packages", "opencode"), "build", "--single", "--skip-install"], {
    cwd: buildRoot,
    env,
  });

  if (runtimeRoot === root || root.startsWith(`${runtimeRoot}${sep}`)) {
    fail(`refusing to clear unsafe runtime directory ${runtimeRoot}`);
  }
  rmSync(runtimeRoot, { recursive: true, force: true });
  const binDir = join(runtimeRoot, "bin");
  mkdirSync(binDir, { recursive: true });

  const builtBinary = join(buildRoot, "packages", "opencode", builtBinaryName());
  if (!existsSync(builtBinary)) {
    fail(`built binary is missing: ${builtBinary}`);
  }
  const binaryName = process.platform === "win32" ? "opencode.exe" : "opencode";
  const targetBinary = join(binDir, binaryName);
  copyFileSync(builtBinary, targetBinary);
  if (process.platform !== "win32") chmodSync(targetBinary, 0o755);
  copyFileSync(join(buildRoot, "LICENSE"), join(runtimeRoot, "LICENSE.opencode"));

  const reportedVersion = execFileSync(targetBinary, ["--version"], { encoding: "utf8" })
    .trim()
    .replace(/^v/, "");
  if (reportedVersion !== manifest.version) {
    fail(`built OpenCode reported ${reportedVersion}, expected ${manifest.version}`);
  }
  writeFileSync(
    join(runtimeRoot, "build.json"),
    `${JSON.stringify(
      {
        opencodeVersion: reportedVersion,
        opencodeCommit: manifest.commit,
        platform: process.platform,
        arch: process.arch,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`OpenCode runtime ready: ${runtimeRoot} (${reportedVersion})`);
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

  // 设置 XIAOYAN_OPENCODE_BUILD_DIR 可复用构建目录：bun 工具链与编译缓存
  // 跨次保留，便于本地续建与 CI 增量构建；默认仍在临时目录克隆编译，
  // 避免在 submodule 工作区留下构建产物。
  const overrideRoot = process.env.XIAOYAN_OPENCODE_BUILD_DIR?.trim();
  if (overrideRoot) {
    const buildRoot = resolve(overrideRoot);
    const bun = resolveBun(buildRoot);
    const sourceDir = join(buildRoot, "source");
    if (!existsSync(join(sourceDir, "packages", "opencode", "package.json"))) {
      run("git", ["clone", "--no-hardlinks", "--quiet", sourceRoot, sourceDir]);
    }
    verifyClonedCommit(sourceDir, manifest);
    buildRuntime(sourceDir, manifest, bun);
    return;
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "xiaoyan-opencode-build-"));
  const buildRoot = join(temporaryRoot, "source");
  try {
    const bun = resolveBun(temporaryRoot);
    run("git", ["clone", "--no-hardlinks", "--quiet", sourceRoot, buildRoot]);
    verifyClonedCommit(buildRoot, manifest);
    buildRuntime(buildRoot, manifest, bun);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

prepareRuntime();
