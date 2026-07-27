#!/usr/bin/env node
import { spawn } from "node:child_process";

const hereDir = process.env.INIT_CWD ?? process.cwd();

spawn(
  "node",
  ["./node_modules/vite/bin/vite.js", "dev --mode native"],
  { stdio: "inherit", cwd: hereDir }
);

const mainProcess = spawn("npx", ["electron", "."], { env: process.env, stdio: "inherit" });

mainProcess.on("error", (err) => console.error("\n[dev] failed to start electron:", err));
