import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "vendor", "pi-web");
const resourceRoot = join(root, "apps", "desktop", "src-tauri", "resources", "pi-web");
const runtimeRoot = join(resourceRoot, "runtime");
const manifestPath = join(resourceRoot, "manifest.json");
const args = new Set(process.argv.slice(2));

function fail(message) {
  throw new Error(`prepare-pi-web-runtime: ${message}`);
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

// 与 prepare-dsh-runtime 一致的固定版本验证：submodule 指针与上游版本必须
// 和 manifest 一致，升级内置运行时必须先更新 vendor/pi-web 并同步本 manifest。
function verifyPin() {
  if (!existsSync(join(sourceRoot, "package.json"))) {
    fail("Pi Web submodule is missing; run git submodule update --init --recursive");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const sourcePackage = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8"));
  const sourceCommit = gitOutput(["-C", sourceRoot, "rev-parse", "HEAD"]);
  if (sourceCommit !== manifest.commit) {
    fail(`submodule commit ${sourceCommit} does not match manifest ${manifest.commit}`);
  }
  if (sourcePackage.version !== manifest.version) {
    fail(`source version ${sourcePackage.version} does not match manifest ${manifest.version}`);
  }
  console.log(`Pi Web source pin verified: ${manifest.version} (${sourceCommit.slice(0, 8)})`);
  return manifest;
}

function nodeVersion(nodeBinary) {
  const output = execFileSync(nodeBinary, ["--version"], { encoding: "utf8" }).trim();
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(output);
  if (!match) fail(`${nodeBinary} returned an invalid version: ${output}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  // pi-web engines: node >=22.19.0（与上游 package.json 一致）
  if (!((major === 22 && minor >= 19) || major >= 23)) {
    fail(`Node ${output} does not satisfy >=22.19.0`);
  }
  return output;
}

function resolveNodeBinary() {
  const explicit = process.env.PI_WEB_NODE_BINARY?.trim();
  const selected = explicit || (args.has("--use-current-node") ? process.execPath : "");
  if (!selected) {
    fail("set PI_WEB_NODE_BINARY to a standalone Node executable, or pass --use-current-node for a local development build");
  }
  const binary = realpathSync(resolve(selected));
  if (!statSync(binary).isFile()) fail(`Node binary does not exist: ${binary}`);
  const explicitLicense = process.env.PI_WEB_NODE_LICENSE?.trim();
  const licenseCandidates = [
    explicitLicense,
    join(dirname(binary), "LICENSE"),
    join(dirname(dirname(binary)), "LICENSE"),
  ].filter(Boolean);
  const license = licenseCandidates.find((candidate) => existsSync(candidate));
  if (!license) {
    fail("could not locate the Node.js LICENSE next to the selected binary; set PI_WEB_NODE_LICENSE explicitly");
  }
  return { binary, license: resolve(license), version: nodeVersion(binary) };
}

// 类型声明与 sourcemap 在运行时不会被加载，删除以缩小安装包体积
//（与 prepare-dsh-runtime 的剪枝规则一致）。
function pruneNonRuntimeFiles(directory) {
  let removedFiles = 0;
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".map") || /\.d\.[cm]?ts$/.test(entry.name)) {
        rmSync(path, { force: true });
        removedFiles += 1;
      }
    }
  };
  visit(directory);
  return removedFiles;
}

function deployRuntime(buildRoot, manifest, node) {
  if (runtimeRoot === root || root.startsWith(`${runtimeRoot}${sep}`)) {
    fail(`refusing to clear unsafe runtime directory ${runtimeRoot}`);
  }
  rmSync(runtimeRoot, { recursive: true, force: true });
  mkdirSync(runtimeRoot, { recursive: true });

  // 与上游 npm 发布包 files 字段保持一致，外加生产依赖。
  for (const entry of ["bin", ".next", "public", "node_modules"]) {
    cpSync(join(buildRoot, entry), join(runtimeRoot, entry), {
      recursive: true,
      dereference: true,
      // .next/cache 是构建中间产物，运行时不加载。
      filter: (path) => !path.includes(`${sep}.next${sep}cache`),
    });
  }
  for (const entry of ["package.json", "next.config.ts"]) {
    copyFileSync(join(buildRoot, entry), join(runtimeRoot, entry));
  }

  const prunedMaps = pruneNonRuntimeFiles(join(runtimeRoot, "node_modules"));
  if (prunedMaps > 0) console.log(`pruned non-runtime files: ${prunedMaps}`);

  const targetNode = join(runtimeRoot, process.platform === "win32" ? "node.exe" : "node");
  copyFileSync(node.binary, targetNode);
  if (process.platform !== "win32") chmodSync(targetNode, 0o755);
  copyFileSync(node.license, join(runtimeRoot, "LICENSE.node"));
  copyFileSync(join(buildRoot, "LICENSE"), join(runtimeRoot, "LICENSE.pi-web"));

  const entry = join(runtimeRoot, "bin", "pi-web.js");
  if (!existsSync(entry)) fail(`deployed CLI entry is missing: ${entry}`);
  execFileSync(targetNode, [entry, "--help"], { cwd: runtimeRoot, stdio: "pipe" });

  writeFileSync(
    join(runtimeRoot, "build.json"),
    `${JSON.stringify(
      {
        piWebVersion: manifest.version,
        piWebCommit: manifest.commit,
        nodeVersion: node.version,
        platform: process.platform,
        arch: process.arch,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Pi Web runtime ready: ${runtimeRoot} (${manifest.version})`);
}

function buildRuntime(buildRoot, manifest, node) {
  // 用同一份 Node 执行安装与构建，避免宿主机全局 Node 影响发布产物。
  const env = {
    CI: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    PATH: `${dirname(node.binary)}${delimiter}${process.env.PATH ?? ""}`,
  };
  run("npm", ["ci"], { cwd: buildRoot, env, shell: process.platform === "win32" });
  run("npm", ["run", "build"], { cwd: buildRoot, env, shell: process.platform === "win32" });
  // 构建完成后裁掉开发依赖，运行时只需要生产依赖。
  run("npm", ["prune", "--omit=dev"], { cwd: buildRoot, env, shell: process.platform === "win32" });
  deployRuntime(buildRoot, manifest, node);
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

  const node = resolveNodeBinary();
  // 设置 XIAOYAN_PI_WEB_BUILD_DIR 可复用构建目录：node_modules 与 Next 构建
  // 缓存跨次保留，便于本地续建与 CI 增量构建；默认仍在临时目录克隆编译，
  // 避免在 submodule 工作区留下构建产物。
  const overrideRoot = process.env.XIAOYAN_PI_WEB_BUILD_DIR?.trim();
  if (overrideRoot) {
    const buildRoot = join(resolve(overrideRoot), "source");
    if (!existsSync(join(buildRoot, "package.json"))) {
      run("git", ["clone", "--no-hardlinks", "--quiet", sourceRoot, buildRoot]);
    }
    verifyClonedCommit(buildRoot, manifest);
    buildRuntime(buildRoot, manifest, node);
    return;
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "xiaoyan-pi-web-build-"));
  const buildRoot = join(temporaryRoot, "source");
  try {
    run("git", ["clone", "--no-hardlinks", "--quiet", sourceRoot, buildRoot]);
    verifyClonedCommit(buildRoot, manifest);
    buildRuntime(buildRoot, manifest, node);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

prepareRuntime();
