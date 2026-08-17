import { pathToFileURL } from "node:url";

const [entry, ...args] = process.argv.slice(2);

if (!entry) {
  throw new Error("DSH supervisor requires the CLI entry path");
}

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  // DSH registers synchronous process-exit cleanup for its managed subprocesses.
  process.exit(0);
};

// Xiaoyan keeps this pipe open for the lifetime of the managed runtime. An EOF
// also arrives when the desktop process is force-restarted during Tauri dev.
process.stdin.resume();
process.stdin.once("end", stop);
process.stdin.once("error", stop);
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

process.argv = [process.execPath, entry, ...args];
await import(pathToFileURL(entry).href);
