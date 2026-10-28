// Node entry point, despite the .py name: `node scripts/run_exclusive.py -- <command> [arguments ...]` run from
// hrms-frontend takes the same machine-wide heavy-command lock as hrms-backend/scripts/run_exclusive.py (pytest_serial,
// builds, type checks, browser suites) by handing the command to that Python script. The name matches the documented
// command of the time goals; Node runs any file given to it as CommonJS.
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const backend = path.resolve(__dirname, "..", "..", "hrms-backend");
const venvPython = path.join(backend, "venv", process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python");
const python = fs.existsSync(venvPython) ? venvPython : (process.platform === "win32" ? "python" : "python3");
const lock = path.join(backend, "scripts", "run_exclusive.py");

const args = process.argv.slice(2);
const at = args.indexOf("--");
const command = at >= 0 ? args.slice(at + 1) : args;
if (command.length === 0) {
  console.error("usage: node scripts/run_exclusive.py -- <command> [arguments ...]");
  process.exit(2);
}
// Python starts the command without a shell: on Windows npm's shims are .cmd files.
if (process.platform === "win32" && ["npx", "npm", "next", "jest", "playwright"].includes(command[0])) {
  command[0] = `${command[0]}.cmd`;
}
const result = spawnSync(python, [lock, "--", ...command], { stdio: "inherit", cwd: process.cwd() });
if (result.error) {
  console.error(`run_exclusive: could not start ${python}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
