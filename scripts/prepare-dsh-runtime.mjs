import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
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
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "vendor", "deepseek-harness");
const resourceRoot = join(root, "apps", "desktop", "src-tauri", "resources", "dsh");
const runtimeRoot = join(resourceRoot, "runtime");
// Deploy the DSH CLI directly into runtime/ (no nested app/ directory).
// Deep node_modules paths already approach the Windows MAX_PATH limit inside
// NSIS/WiX bundlers, so every path segment matters.
const appRoot = runtimeRoot;
const manifestPath = join(resourceRoot, "manifest.json");
const args = new Set(process.argv.slice(2));

function fail(message) {
  throw new Error(`prepare-dsh-runtime: ${message}`);
}

function run(command, commandArgs, options = {}) {
  const quiet = options.quiet === true;
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    env: process.env,
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: quiet ? "utf8" : undefined,
    maxBuffer: quiet ? 64 * 1024 * 1024 : undefined,
    // Node.js >=24 on Windows rejects spawning .cmd/.bat files without a shell.
    shell: options.shell ?? false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (quiet) {
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
      const lines = output.split(/\r?\n/);
      const diagnosticIndexes = lines
        .map((line, index) => (/error|failed|elifecycle|\bts\d{4}\b|\[x\]|✗/i.test(line) ? index : -1))
        .filter((index) => index >= 0);
      const diagnosticLines = new Set();
      for (const index of diagnosticIndexes) {
        for (let cursor = Math.max(0, index - 3); cursor <= Math.min(lines.length - 1, index + 3); cursor += 1) {
          diagnosticLines.add(cursor);
        }
      }
      const focused = [...diagnosticLines].sort((left, right) => left - right).map((index) => lines[index]).join("\n");
      console.error(focused || output.slice(-12_000));
    }
    fail(`${command} ${commandArgs.join(" ")} exited with ${result.status ?? "no status"}`);
  }
  if (quiet) console.log(`completed: ${commandArgs.join(" ")}`);
}

function pnpm(commandArgs, options = {}) {
  const explicit = process.env.DSH_PNPM?.trim();
  if (explicit) {
    run(explicit, commandArgs, { ...options, shell: process.platform === "win32" });
    return;
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  run(npx, ["--yes", "pnpm@11.7.0", ...commandArgs], { ...options, shell: process.platform === "win32" });
}

function gitOutput(commandArgs) {
  return execFileSync("git", commandArgs, { cwd: root, encoding: "utf8" }).trim();
}

function verifyPin() {
  if (!existsSync(join(sourceRoot, "package.json"))) {
    fail("DeepSeek Harness submodule is missing; run git submodule update --init --recursive");
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
  console.log(`DSH source pin verified: ${manifest.version} (${sourceCommit.slice(0, 8)})`);
  return manifest;
}

function nodeVersion(nodeBinary) {
  const output = execFileSync(nodeBinary, ["--version"], { encoding: "utf8" }).trim();
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(output);
  if (!match) fail(`${nodeBinary} returned an invalid version: ${output}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!((major === 22 && minor >= 19) || major >= 24)) {
    fail(`Node ${output} does not satisfy ^22.19.0 || >=24.0.0`);
  }
  return output;
}

function resolveNodeBinary() {
  const explicit = process.env.DSH_NODE_BINARY?.trim();
  const selected = explicit || (args.has("--use-current-node") ? process.execPath : "");
  if (!selected) {
    fail("set DSH_NODE_BINARY to a standalone Node executable, or pass --use-current-node for a local development build");
  }
  const binary = realpathSync(resolve(selected));
  if (!statSync(binary).isFile()) fail(`Node binary does not exist: ${binary}`);
  const explicitLicense = process.env.DSH_NODE_LICENSE?.trim();
  const licenseCandidates = [
    explicitLicense,
    join(dirname(binary), "LICENSE"),
    join(dirname(dirname(binary)), "LICENSE"),
  ].filter(Boolean);
  const license = licenseCandidates.find((candidate) => existsSync(candidate));
  if (!license) {
    fail("could not locate the Node.js LICENSE next to the selected binary; set DSH_NODE_LICENSE explicitly");
  }
  return { binary, license: resolve(license), version: nodeVersion(binary) };
}

function findFirstSymlink(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink()) return path;
    if (metadata.isDirectory()) {
      const nested = findFirstSymlink(path);
      if (nested) return nested;
    }
  }
  return null;
}

function materializeLinks(directory) {
  let symlink = findFirstSymlink(directory);
  while (symlink) {
    const segments = relative(directory, symlink).split(sep);
    const binIndex = segments.lastIndexOf(".bin");
    if (binIndex >= 0) {
      rmSync(join(directory, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true });
      symlink = findFirstSymlink(directory);
      continue;
    }
    const source = realpathSync(symlink);
    const sourceNodeModules = join(source, "node_modules");
    rmSync(symlink, { recursive: true, force: true });
    cpSync(source, symlink, {
      recursive: true,
      dereference: true,
      filter: (path) => path !== sourceNodeModules && !path.startsWith(`${sourceNodeModules}${sep}`),
    });
    symlink = findFirstSymlink(directory);
  }
}

// Type declarations and sourcemaps are never loaded at runtime. Removing them
// shrinks the bundle and keeps deeply nested dependency paths (for example
// @mistralai/mistralai's generated operation modules) clear of the Windows
// MAX_PATH limit that breaks makensis during NSIS bundling.
function pruneNonRuntimeFiles(directory) {
  let removedFiles = 0;
  let removedBytes = 0;
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".map") || /\.d\.[cm]?ts$/.test(entry.name)) {
        removedBytes += statSync(path).size;
        rmSync(path, { force: true });
        removedFiles += 1;
      }
    }
  };
  visit(directory);
  return { removedFiles, removedBytes };
}

// Native prebuilds for other platforms bloat the bundle and break linuxdeploy
// on Linux, which recursively calls ldd on every ELF it finds. Each CI job
// only needs binaries matching process.platform/process.arch; delete the rest.
function prunePlatformBinaries(directory) {
  const current = `${process.platform}-${process.arch}`;
  const muslNames = new Set(["musl_x64", "musl_arm64"]);
  let removedDirs = 0;
  let removedFiles = 0;

  const isOtherPlatformPackage = (name) => {
    // Examples: sharp-darwin-arm64, koffi-win32-x64, sharp-libvips-linuxmusl-x64
    const match = /-(darwin|win32|linuxmusl|linux)-(arm64|x64|arm)(?:$|-)/.exec(name);
    if (!match) return false;
    const suffix = `${match[1]}-${match[2]}`;
    if (suffix === current) return false;
    return true;
  };

  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (muslNames.has(entry.name) || entry.name === "linuxmusl-x64" || entry.name === "linuxmusl-arm64") {
          rmSync(path, { recursive: true, force: true });
          removedDirs += 1;
          continue;
        }
        if (entry.name === "prebuilds") {
          for (const child of readdirSync(path, { withFileTypes: true })) {
            const childPath = join(path, child.name);
            if (!child.isDirectory()) continue;
            // Keep current platform prebuilds, but never musl on glibc hosts.
            if (child.name.startsWith(current) && !child.name.includes("musl")) continue;
            rmSync(childPath, { recursive: true, force: true });
            removedDirs += 1;
          }
          continue;
        }
        if (isOtherPlatformPackage(entry.name)) {
          rmSync(path, { recursive: true, force: true });
          removedDirs += 1;
          continue;
        }
        visit(path);
      } else if (entry.isFile()) {
        if ((process.platform !== "win32" && entry.name.endsWith(".dll")) ||
            (process.platform !== "darwin" && entry.name.endsWith(".dylib"))) {
          rmSync(path, { force: true });
          removedFiles += 1;
        }
      }
    }
  };

  visit(directory);
  return { removedDirs, removedFiles };
}

function workspacePackageMap(buildRoot) {
  const packages = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if ([".git", "node_modules", "dist", "dist-exe"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      const manifest = join(path, "package.json");
      if (existsSync(manifest)) {
        const parsed = JSON.parse(readFileSync(manifest, "utf8"));
        if (typeof parsed.name === "string" && parsed.name.startsWith("@deepseek-ai/")) {
          packages.set(parsed.name, path);
        }
      }
      visit(path);
    }
  };
  for (const directory of ["apps", "packages", "vendor", "native"]) {
    const path = join(buildRoot, directory);
    if (existsSync(path)) visit(path);
  }
  return packages;
}

function packageDestination(nodeModules, packageName) {
  return join(nodeModules, ...packageName.split("/"));
}

function materializeWorkspaceClosure(buildRoot, deployedRoot) {
  const packageSources = workspacePackageMap(buildRoot);
  const nodeModules = join(deployedRoot, "node_modules");
  const queue = [deployedRoot];
  const visited = new Set();
  const restored = [];
  while (queue.length > 0) {
    const packageRoot = queue.shift();
    const manifestPath = join(packageRoot, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (visited.has(manifest.name)) continue;
    visited.add(manifest.name);
    const dependencyNames = new Set();
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const name of Object.keys(manifest[section] ?? {})) dependencyNames.add(name);
    }
    for (const name of [...dependencyNames].sort()) {
      const source = packageSources.get(name);
      if (!source) continue;
      const destination = packageDestination(nodeModules, name);
      if (!existsSync(destination)) {
        mkdirSync(dirname(destination), { recursive: true });
        const sourceNodeModules = join(source, "node_modules");
        cpSync(source, destination, {
          recursive: true,
          dereference: true,
          filter: (path) => path !== sourceNodeModules && !path.startsWith(`${sourceNodeModules}${sep}`),
        });
        restored.push(name);
      }
      queue.push(destination);
    }
  }
  if (restored.length > 0) {
    console.log(`restored workspace runtime dependencies: ${restored.length}`);
  }
}

function buildRuntime(buildRoot, manifest, node) {
  pnpm(["--dir", buildRoot, "install", "--frozen-lockfile"]);
  pnpm(["--dir", buildRoot, "run", "build"], { quiet: true });

  if (runtimeRoot === root || root.startsWith(`${runtimeRoot}${sep}`)) {
    fail(`refusing to clear unsafe runtime directory ${runtimeRoot}`);
  }
  rmSync(runtimeRoot, { recursive: true, force: true });
  mkdirSync(runtimeRoot, { recursive: true });

  pnpm([
    "--dir",
    buildRoot,
    "--filter",
    "@deepseek-ai/dsh",
    "deploy",
    "--legacy",
    "--prod",
    "--config.node-linker=hoisted",
    "--config.auto-install-peers=false",
    "--config.link-workspace-packages=true",
    appRoot,
  ], { quiet: true });

  const nodeModules = join(appRoot, "node_modules");
  if (existsSync(nodeModules)) materializeLinks(nodeModules);
  materializeWorkspaceClosure(buildRoot, appRoot);

  if (existsSync(nodeModules)) {
    const pruned = pruneNonRuntimeFiles(nodeModules);
    console.log(
      `pruned non-runtime files: ${pruned.removedFiles} files, ${(pruned.removedBytes / 1024 / 1024).toFixed(1)} MiB`,
    );
    const platformPruned = prunePlatformBinaries(nodeModules);
    console.log(
      `pruned platform binaries: ${platformPruned.removedDirs} dirs, ${platformPruned.removedFiles} files`,
    );
  }

  const entry = join(appRoot, "lib", "bin.js");
  if (!existsSync(entry)) fail(`deployed CLI entry is missing: ${entry}`);
  const targetNode = join(runtimeRoot, process.platform === "win32" ? "node.exe" : "node");
  copyFileSync(node.binary, targetNode);
  if (process.platform !== "win32") chmodSync(targetNode, 0o755);
  copyFileSync(node.license, join(runtimeRoot, "LICENSE.node"));
  copyFileSync(join(buildRoot, "LICENSE"), join(runtimeRoot, "LICENSE.deepseek-harness"));
  copyFileSync(join(buildRoot, "THIRD_PARTY_NOTICES.md"), join(runtimeRoot, "THIRD_PARTY_NOTICES.deepseek-harness.md"));

  const residualSymlink = findFirstSymlink(runtimeRoot);
  if (residualSymlink) {
    fail(`packaged runtime contains a symlink: ${relative(runtimeRoot, residualSymlink)}`);
  }

  const reportedVersion = execFileSync(targetNode, [entry, "--version"], {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, DSH_TELEMETRY_DISABLED: "1" },
  }).trim();
  if (reportedVersion !== manifest.version) {
    fail(`deployed DSH reported ${reportedVersion}, expected ${manifest.version}`);
  }
  writeFileSync(join(runtimeRoot, "build.json"), `${JSON.stringify({
    dshVersion: manifest.version,
    dshCommit: manifest.commit,
    nodeVersion: node.version,
    platform: process.platform,
    arch: process.arch,
  }, null, 2)}\n`);
  console.log(`DSH runtime ready: ${runtimeRoot}`);
}

function prepareRuntime() {
  const manifest = verifyPin();
  if (args.has("--verify-only")) return;

  const node = resolveNodeBinary();
  // DSH's repository postinstall configures Lefthook for contributors. A vendored
  // release build must not mutate the parent repository's Git configuration.
  process.env.CI = "true";
  // Use the same Node for source compilation and the packaged runtime. This
  // prevents a host-global Node from silently changing release output.
  process.env.PATH = `${dirname(node.binary)}${delimiter}${process.env.PATH ?? ""}`;
  const temporaryRoot = mkdtempSync(join(tmpdir(), "xiaoyan-dsh-build-"));
  const buildRoot = join(temporaryRoot, "source");
  try {
    // Building outside the Xiaoyan monorepo prevents TypeScript and Node from
    // resolving the parent's React/types dependencies across the submodule boundary.
    run("git", ["clone", "--no-hardlinks", "--quiet", sourceRoot, buildRoot]);
    const clonedCommit = execFileSync("git", ["-C", buildRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (clonedCommit !== manifest.commit) fail(`isolated source clone resolved to unexpected commit ${clonedCommit}`);
    buildRuntime(buildRoot, manifest, node);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

prepareRuntime();
