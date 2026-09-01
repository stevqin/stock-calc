import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Avoid Finder automation in Tauri's decorative DMG script. The signed app and
// an Applications link are sufficient for a local-use, read-only installer.
if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("此交付脚本只支持当前 Apple Silicon Mac");
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("无效版本号");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 失败，退出码 ${result.status}`);
}
run(join(root, "node_modules/.bin/tauri"), ["build", "--bundles", "app", "--", "--locked"]);
const app = join(root, "src-tauri/target/release/bundle/macos/T刻.app");
run("codesign", ["--verify", "--deep", "--strict", app]);
const staging = mkdtempSync(join(tmpdir(), "t-calculator-package-"));
const outputDir = join(root, "src-tauri/target/release/bundle/dmg");
const output = join(outputDir, `T刻_${version}_aarch64.dmg`);
mkdirSync(outputDir, { recursive: true });
try {
  cpSync(app, join(staging, "T刻.app"), { recursive: true, dereference: false });
  symlinkSync("/Applications", join(staging, "Applications"));
  run("hdiutil", ["create", "-ov", "-volname", `T刻 ${version}`, "-srcfolder", staging, "-format", "UDZO", output]);
  run("hdiutil", ["verify", output]);
  console.log(`已生成：${app}\n已生成：${output}`);
} finally {
  // Only the freshly created staging directory is removed; never follow the
  // Applications symlink or touch the user's installed app or account data.
  rmSync(staging, { recursive: true, force: true });
}
