// Probe do ambiente real — SOMENTE LEITURA.
// Nunca instala, baixa, grava configuração, altera PATH, abre ou conecta no DaVinci Resolve.
// Os testes substituem este objeto por um probe falso.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripInjection } from '../config/child-env.mjs';

export function createProbe({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const exists = (f) => { try { return !!f && fs.existsSync(f); } catch { return false; } };
  const isDir = (f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };
  const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };

  function which(cmd) {
    if (!cmd) return null;
    if (p.isAbsolute(cmd)) return isFile(cmd) ? cmd : null;
    const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
    const exts = platform === 'win32' ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').concat(['']) : [''];
    for (const d of dirs) {
      for (const e of exts) {
        const c = p.join(d, cmd + e);
        if (!isFile(c)) continue;
        if (platform !== 'win32') { try { fs.accessSync(c, fs.constants.X_OK); } catch { continue; } }
        return c;
      }
    }
    return null;
  }

  // R12.5C1B: `env` (opcional) SUBSTITUI o ambiente (ex.: Python auxiliar com allowlist, sem DYLD_*/PYTHON*)
  function run(file, args = [], { timeout = 15000, env: only = null } = {}) {
    try {
      const shell = platform === 'win32' && /\.(cmd|bat)$/i.test(file);
      const stdout = execFileSync(file, args, {
        encoding: 'utf8', timeout, windowsHide: true, shell,
        stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
        // R6.2: probes de ferramentas externas também sem auto-install, skills, telemetria e sem compile cache em os.tmpdir()
        env: stripInjection(only ? { ...only } : { ...env, HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_AUTO_INSTALL: '1', HYPERFRAMES_SKIP_SKILLS: '1', DO_NOT_TRACK: '1', NODE_DISABLE_COMPILE_CACHE: '1' }),   // R12.5C3b-A: sem DYLD_*/LD_*/NODE_OPTIONS
      });
      return { ok: true, stdout, stderr: '' };
    } catch (e) {
      return { ok: false, stdout: String(e.stdout || ''), stderr: String(e.stderr || e.message || '') };
    }
  }

  function readdir(dir) { try { return fs.readdirSync(dir); } catch { return []; } }
  function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
  function fileSize(file) { try { return fs.statSync(file).size; } catch { return null; } }

  function nearestExisting(dir) {
    let d = dir;
    while (d && !exists(d)) { const parent = p.dirname(d); if (parent === d) return null; d = parent; }
    return d;
  }
  function freeBytes(dir) {
    const d = nearestExisting(dir);
    if (!d) return null;
    try { const s = fs.statfsSync(d); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
  }
  function writable(dir) {
    const d = nearestExisting(dir);
    if (!d) return { ok: false, checked: null };
    try { fs.accessSync(d, fs.constants.W_OK); return { ok: true, checked: d }; } catch { return { ok: false, checked: d }; }
  }

  return {
    env, platform, home, arch: os.arch(), osRelease: os.release(), nodeVersion: process.version,
    exists, isDir, isFile, which, run, readdir, readJson, fileSize, freeBytes, writable, join: p.join,
  };
}
