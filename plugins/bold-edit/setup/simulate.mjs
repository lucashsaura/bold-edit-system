// Simulação de instalação (R12.1; política de assinatura R12.5B) — ambiente ISOLADO em os.tmpdir(), artefatos SINTÉTICOS, SEM REDE.
// Exercita o ciclo completo do engine e a camada de config, e prova que nada foi escrito fora da raiz temporária.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { installLocal, verify, rollback, status, treeHash, SetupError } from './engine.mjs';
import { loadConfig } from '../core/config/load.mjs';

const WIN = process.platform === 'win32';

/** Cria um "node" sintético (script que imprime a versão) num diretório de artefato. */
export function syntheticTool(dir, version) {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  const rel = WIN ? 'bin/node.cmd' : 'bin/node';
  const f = path.join(dir, rel);
  fs.writeFileSync(f, WIN ? `@echo off\r\necho v${version}\r\n` : `#!/bin/sh\necho v${version}\n`);
  if (!WIN) fs.chmodSync(f, 0o755);
  fs.writeFileSync(path.join(dir, 'LICENSE.synthetic'), 'artefato sintético de teste — não é o Node.js\n');
  return { bins: { node: rel } };
}

const smoke = (abs) => { const r = spawnSync(abs, ['--version'], { encoding: 'utf8', shell: WIN }); return { ok: r.status === 0 && /^v\d/.test(r.stdout || '') }; };

function snapshot(dir) {
  const out = [];
  const walk = (rel) => { for (const n of fs.readdirSync(path.join(dir, rel))) { const r = rel ? `${rel}/${n}` : n; const st = fs.lstatSync(path.join(dir, r)); out.push(r); if (st.isDirectory()) walk(r); } };
  if (fs.existsSync(dir)) walk('');
  return out.sort();
}

export function runSimulation({ keep = false, platform = process.platform === 'darwin' ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64') : 'win32-x64' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bold-setup-sim-'));
  const root = path.join(base, 'toolchain'); const fixtures = path.join(base, 'fixtures'); const home = path.join(base, 'home');
  fs.mkdirSync(home);
  const steps = [];
  const step = (name, fn) => { try { const r = fn(); steps.push({ step: name, ok: true, ...(r || {}) }); } catch (e) { steps.push({ step: name, ok: false, code: e.code ?? 'ERROR', message: e.message }); } };
  const expectCode = (name, code, fn) => { try { fn(); steps.push({ step: name, ok: false, message: `esperava ${code}, não falhou` }); } catch (e) { steps.push({ step: name, ok: e.code === code, code: e.code, message: e.message }); } };
  const v1 = path.join(fixtures, 'node-v1'); const v2 = path.join(fixtures, 'node-v2'); const bad = path.join(fixtures, 'node-bad');
  const b1 = syntheticTool(v1, '24.0.0-sim'); const b2 = syntheticTool(v2, '24.1.0-sim'); syntheticTool(bad, '9.9.9-sim');
  const h1 = treeHash(v1).sha256; const h2 = treeHash(v2).sha256;
  const common = { root, tool: 'node', platform, license: 'MIT (sintético)', source: 'fixture local (simulação)', smoke, home };
  const outsideBefore = snapshot(base).filter((p) => !p.startsWith('toolchain'));

  step('1. instalar v1 (staging → hash → ativação)', () => { const r = installLocal({ ...common, version: '24.0.0-sim', sourceDir: v1, expected: { tree_sha256: h1 }, bins: b1.bins }); return { detail: `${r.dir} · ${r.files} arquivos` }; });
  step('2. reinstalar v1 (idempotente)', () => { const r = installLocal({ ...common, version: '24.0.0-sim', sourceDir: v1, expected: { tree_sha256: h1 }, bins: b1.bins }); if (!r.idempotent) throw new SetupError('NOT_IDEMPOTENT', 'deveria reutilizar'); return { detail: 'reutilizado' }; });
  expectCode('3. artefato adulterado → INTEGRITY_FAIL, nada ativado', 'INTEGRITY_FAIL', () => installLocal({ ...common, version: '24.0.1-sim', sourceDir: bad, expected: { tree_sha256: h1 }, bins: b1.bins }));
  step('3b. staging limpo e v1 continua ativa', () => { if (fs.existsSync(path.join(root, '.staging'))) throw new Error('staging ficou para trás'); if (fs.existsSync(path.join(root, 'node', `24.0.1-sim-${platform}`))) throw new Error('destino criado'); const s = status(root); if (s.active[0]?.version !== '24.0.0-sim') throw new Error('ativação mudou'); });
  if (process.platform === 'darwin') {
    // R12.5B: política de assinatura com o verificador REAL (/usr/bin/codesign, offline) — o "node" sintético não é Mach-O assinado
    const spec = { policy: 'REQUIRED', team_id: 'HX7739G8FX', hardened_runtime: true, bins: { node: { identifier: 'node' } } };
    expectCode('3c. assinatura exigida + binário sem assinatura → CODESIGN_INVALID, nada ativado', 'CODESIGN_INVALID', () => installLocal({ ...common, version: '24.0.2-sim', sourceDir: v1, expected: { tree_sha256: h1 }, bins: b1.bins, codesign: spec }));
    step('3d. após a recusa: sem destino, sem staging, v1 ativa', () => { if (fs.existsSync(path.join(root, 'node', `24.0.2-sim-${platform}`)) || fs.existsSync(path.join(root, '.staging'))) throw new Error('sobrou diretório'); if (status(root).active[0]?.version !== '24.0.0-sim') throw new Error('ativação mudou'); return { detail: 'nada executado nem ativado' }; });
  }
  step('4. instalar v2 (v1 vira previous)', () => { const r = installLocal({ ...common, version: '24.1.0-sim', sourceDir: v2, expected: { tree_sha256: h2 }, bins: b2.bins }); if (r.previous !== '24.0.0-sim') throw new Error('previous incorreto'); return { detail: `ativo ${r.version} · anterior ${r.previous}` }; });
  step('5. verify PASS', () => { const v = verify(root); if (v.status !== 'PASS') throw new Error(JSON.stringify(v.issues)); return { detail: `${v.entries.length} entradas` }; });
  step('6. config: tools.NODE_PATH vem do toolchain', () => { const l = loadConfig({ env: { BOLD_TOOLCHAIN_DIR: root, BOLD_USER_CONFIG: path.join(home, 'none.json') }, home, cwd: home }); if (l.sources['tools.NODE_PATH'] !== 'toolchain') throw new Error(`origem ${l.sources['tools.NODE_PATH']}`); return { detail: path.relative(root, l.config.tools.NODE_PATH) }; });
  step('7. rollback dry-run não altera nada', () => { const r = rollback({ root, tool: 'node', home }); if (!r.dry_run || status(root).active[0].version !== '24.1.0-sim') throw new Error('alterou'); return { detail: `${r.plan.from} → ${r.plan.to} (simulado)` }; });
  step('8. rollback --yes volta para v1', () => { const r = rollback({ root, tool: 'node', yes: true, home }); if (!r.ok || status(root).active[0].version !== '24.0.0-sim') throw new Error('não voltou'); return { detail: `${r.plan.from} → ${r.plan.to}` }; });
  step('9. node.path aponta para a versão ativa', () => { const p = fs.readFileSync(path.join(root, 'node.path'), 'utf8').trim(); if (!p.includes(`24.0.0-sim-${platform}`)) throw new Error(p); });
  step('10. adulteração pós-instalação é detectada', () => { fs.appendFileSync(path.join(root, 'node', `24.1.0-sim-${platform}`, 'LICENSE.synthetic'), 'x'); const v = verify(root); if (v.status !== 'FAIL' || !v.issues.some((i) => i.code === 'MODIFIED')) throw new Error('não detectou'); return { detail: 'MODIFIED detectado (nada apagado)' }; });
  step('11. nada escrito fora da raiz temporária', () => { const after = snapshot(base).filter((p) => !p.startsWith('toolchain')); if (JSON.stringify(after) !== JSON.stringify(outsideBefore)) throw new Error('arquivos fora da raiz mudaram'); });
  const logs = fs.existsSync(path.join(root, 'logs')) ? fs.readdirSync(path.join(root, 'logs')) : [];
  const ok = steps.every((s) => s.ok);
  if (!keep) fs.rmSync(base, { recursive: true, force: true });
  return { schema: 'bold.setup-simulation/1', network: false, synthetic: true, ok, platform, kept: keep ? base : null, steps, logs };
}
