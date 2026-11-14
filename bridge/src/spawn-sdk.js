// Optionally starts the Rokoko Device SDK for you. Only the hand solver is
// launched: `rkk-hand-solver` runs the glove driver (`rokoko-sdk --auto-stream-usb`)
// itself, so starting the driver separately would make the two fight over its
// RGMP port 12276. If a driver is already running, the solver reuses it (--no-driver).
//   rkk-hand-solver --emit-openxr [--driver-path <sdk>/bin/rokoko-sdk | --no-driver]
// Extra solver arguments can be added with SENECAI_SOLVER_ARGS.

import { execFileSync, spawn } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync } from 'node:fs';
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

/**
 * On Linux, Smartgloves II appear as a USB serial port (/dev/ttyACM*), usually
 * owned by group uucp (Arch) or dialout (Debian/Ubuntu). If we can't open it, neither can the driver.
 */
export function checkSerialAccess(log = console.log) {
  if (process.platform !== 'linux') return true;
  let ok = true;
  for (const name of readdirSync('/dev').filter((n) => n.startsWith('ttyACM'))) {
    try {
      accessSync(`/dev/${name}`, constants.R_OK | constants.W_OK);
    } catch {
      ok = false;
      log(`[spawn] no permission to open /dev/${name}, so the Rokoko driver can't read the gloves. Fix (then log out and back in):
           sudo usermod -aG uucp $USER      # Arch / Omarchy
           sudo usermod -aG dialout $USER   # Debian / Ubuntu
         or, without logging out: sudo chmod a+rw /dev/${name}   (lasts until the glove is replugged)`);
    }
  }
  return ok;
}

export function spawnSdk({ log = console.log } = {}) {
  let child = null;
  checkSerialAccess(log);
  if (isRunning('rkk-hand-solver')) {
    log('[spawn] rkk-hand-solver is already running, using it');
    return { stop() {} };
  }
  const args = ['--emit-openxr'];
  if (isRunning('rokoko-sdk')) {
    log('[spawn] rokoko-sdk is already running; the solver will use it (--no-driver)');
    args.push('--no-driver');
  } else {
    const driver = findBin('rokoko-sdk');
    if (driver !== 'rokoko-sdk') args.push('--driver-path', driver);
  }
  if (process.env.SENECAI_SOLVER_ARGS) args.push(...process.env.SENECAI_SOLVER_ARGS.split(/\s+/).filter(Boolean));

  const bin = findBin('rkk-hand-solver');
  log(`[spawn] ${bin} ${args.join(' ')}`);
  child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (stream) =>
    stream.on('data', (d) =>
      String(d)
        .split('\n')
        .filter(Boolean)
        .forEach((line) => log(`[solver] ${line}`)),
    );
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('error', (e) => log(`[spawn] could not start rkk-hand-solver: ${e.message}. Is the Rokoko Device SDK installed? Check with "rokoko doctor" (see README).`));
  child.on('exit', (code, signal) => log(`[spawn] rkk-hand-solver exited (${signal ?? code})${code ? '. If it says "Address already in use", another rokoko-sdk is running: pkill -x rokoko-sdk and try again.' : ''}`));

  // SIGTERM lets the solver shut down the driver it started.
  const stop = () => child?.exitCode === null && child.kill('SIGTERM');
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (stop(), process.exit(0)));
  return { stop };
}
