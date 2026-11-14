// Optionally starts the Rokoko Device SDK processes for you:
//   rokoko-sdk --auto-stream-usb     (glove driver; USB streaming is Smartgloves II only, Wi-Fi gloves stream by default)
//   rkk-hand-solver --emit-openxr    (solved 26-joint hands on 127.0.0.1:12277)
// Already-running instances are reused (a stale second driver would block the USB device).
// Override the arguments with SENECAI_SDK_ARGS / SENECAI_SOLVER_ARGS if your setup differs.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function sdkBinDirs() {
  const home = process.env.ROKOKO_SDK_HOME ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'rokoko-device-sdk');
  return [join(home, 'bin'), home];
}

function findBin(name) {
  for (const dir of sdkBinDirs()) if (existsSync(join(dir, name))) return join(dir, name);
  return name; // rely on PATH
}

function isRunning(name) {
  try {
    execFileSync('pgrep', ['-x', name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function spawnSdk({ log = console.log } = {}) {
  const children = [];
  const start = (name, args) => {
    if (isRunning(name)) return log(`[spawn] ${name} is already running, using it`);
    const bin = findBin(name);
    log(`[spawn] ${bin} ${args.join(' ')}`);
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const pipe = (stream) =>
      stream.on('data', (d) =>
        String(d)
          .split('\n')
          .filter(Boolean)
          .forEach((line) => log(`[${name}] ${line}`)),
      );
    pipe(child.stdout);
    pipe(child.stderr);
    child.on('error', (e) => log(`[spawn] could not start ${name}: ${e.message}. Is the Rokoko Device SDK installed? Check with "rokoko-sdk --version" (see README).`));
    child.on('exit', (code, signal) => log(`[spawn] ${name} exited (${signal ?? code})`));
    children.push(child);
  };
  const args = (env, def) => (process.env[env] ? process.env[env].split(/\s+/).filter(Boolean) : def);

  start('rokoko-sdk', args('SENECAI_SDK_ARGS', ['--auto-stream-usb']));
  // Give the driver a moment to open its RGMP port before the solver connects.
  const t = setTimeout(() => start('rkk-hand-solver', args('SENECAI_SOLVER_ARGS', ['--emit-openxr'])), 1500);

  const stop = () => {
    clearTimeout(t);
    for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  };
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (stop(), process.exit(0)));
  return { stop };
}
