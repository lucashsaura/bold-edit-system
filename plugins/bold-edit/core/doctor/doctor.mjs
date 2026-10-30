// `bold doctor` — diagnóstico SOMENTE LEITURA.
// Nunca instala, baixa, altera config/PATH, instala browsers/pacotes, abre ou altera o Resolve.

import { coreChecks, motionChecks, davinciChecks, transcriptChecks, assetsChecks, claudeChecks, MODULES } from './checks.mjs';
import { toolchainChecks } from './toolchain-checks.mjs';
import { audioChecks } from './audio-checks.mjs';

const RUNNERS = { motion: motionChecks, davinci: davinciChecks, transcript: transcriptChecks, assets: assetsChecks, claude: claudeChecks, toolchain: toolchainChecks, audio: audioChecks };

/**
 * @param {{probe: object, loaded: object, modules?: string[], version?: string, scan?: Function, now?: Date}} opts
 *   modules: módulos SOLICITADOS explicitamente. Vazio = todos informativos (ausências viram WARNING).
 */
export function runDoctor({ probe, loaded, modules = [], version = '0.0.0', scan, now = new Date() }) {
  const requested = new Set(modules.filter((m) => m !== 'all'));
  if (modules.includes('all')) for (const m of MODULES) requested.add(m);
  for (const m of requested) if (!MODULES.includes(m)) throw new Error(`módulo desconhecido: ${m} (válidos: ${MODULES.join(', ')}, all)`);

  const ctx = { probe, loaded, requested, scan };
  const toRun = requested.size ? [...requested].filter((m) => m !== 'core') : Object.keys(RUNNERS);
  const checks = [...coreChecks(ctx)];
  for (const m of toRun) checks.push(...RUNNERS[m](ctx));

  const summary = { PASS: 0, WARNING: 0, FAIL: 0 };
  for (const c of checks) summary[c.status] += 1;
  return {
    tool: 'bold doctor',
    version,
    generated_at: now.toISOString(),
    platform: probe.platform,
    arch: probe.arch,
    read_only: true,
    requested_modules: requested.size ? [...requested] : [],
    evaluated_modules: ['core', ...toRun],
    summary,
    status: summary.FAIL ? 'FAIL' : summary.WARNING ? 'WARNING' : 'PASS',
    exit_code: summary.FAIL ? 1 : 0,
    checks,
  };
}

export function formatDoctor(report) {
  const lines = [];
  lines.push(`BOLD doctor v${report.version} — somente leitura — ${report.platform}/${report.arch}`);
  lines.push(`módulos avaliados: ${report.evaluated_modules.join(', ')}${report.requested_modules.length ? ` (solicitados: ${report.requested_modules.join(', ')})` : ' (opcionais: ausências = WARNING)'}`);
  let current = null;
  for (const c of report.checks) {
    if (c.module !== current) { current = c.module; lines.push(`\n[${current.toUpperCase()}]`); }
    const tag = c.status === 'PASS' ? 'PASS   ' : c.status === 'WARNING' ? 'WARNING' : 'FAIL   ';
    lines.push(`  ${tag}  ${c.label}: ${c.detail}`);
    if (c.hint && c.status !== 'PASS') lines.push(`           ↳ ${c.hint}`);
  }
  lines.push(`\nResumo: ${report.summary.PASS} PASS · ${report.summary.WARNING} WARNING · ${report.summary.FAIL} FAIL → ${report.status}`);
  return lines.join('\n');
}
