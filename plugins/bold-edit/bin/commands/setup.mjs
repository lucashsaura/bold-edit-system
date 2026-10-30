// `bold setup` — BOLD Setup Manager (R12: núcleo local, apply/uninstall, lock fixado, opcionais).
// Informativo por padrão. `apply` só instala componentes listados em --components, com confirmação por componente,
// e só artefatos PINNED no lock (Node e FFmpeg desde a R12.3; opcionais desde a R12.4).
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { createProbe } from '../../core/doctor/probe.mjs';
import { toolchainRoot } from '../../core/config/paths.mjs';
import { probePlatform } from '../../setup/platform.mjs';
import { inventory } from '../../setup/inventory.mjs';
import { buildPlan } from '../../setup/plan.mjs';
import { trustedLock, trustAllowsLoopback, trustNpmOverride } from '../../setup/trust.mjs';
import { applyComponents } from '../../setup/apply.mjs';
import { COMPONENTS } from '../../setup/components.mjs';
import { status, verify, rollback, uninstall, SetupError } from '../../setup/engine.mjs';
import { runSimulation } from '../../setup/simulate.mjs';
import { measureComponent } from '../../setup/measure.mjs';
import { LICENSES, consentText, consentFor, recordConsent, revokeConsent, readConsents } from '../../setup/consent.mjs';

const EXIT = { OK: 0, FAIL: 1, STOP: 3, UNAVAILABLE: 5, USAGE: 64 };

export const SETUP_USAGE = `bold setup — BOLD Setup Manager
  setup [plan] [--include id,id|all]   plano somente leitura: plataforma, inventário, ações propostas
  setup platform                       SO/arquitetura detectados e nível de suporte
  setup inventory                      ferramentas encontradas, versões e origem (config/toolchain/PATH)
  setup status                         toolchain gerenciado: versões ativas e recibo
  setup verify                         integridade do toolchain gerenciado (somente leitura)
  setup rollback --tool T [--yes]      volta T para a versão anterior (dry-run sem --yes)
  setup simulate [--keep]              ciclo completo em diretório TEMPORÁRIO com artefatos sintéticos
  setup licenses                       licenças e políticas por componente
  setup apply --components a,b [--dry-run] [--yes] [--archive F]
                                       instala SÓ os componentes listados, com confirmação por componente
                                       (sem terminal: exige --yes). Só artefatos PINNED no lock (veja: bold setup plan).
  setup uninstall [--tool T] [--yes]   remove só o que o recibo registrou e está íntegro (dry-run sem --yes)
  setup measure --component C [--platform P] [--archive-dir D | --yes] [--output D]
                                       MEDE (não instala) um artefato fixado/PENDING_MEASUREMENT: sha256 antes de extrair,
                                       extração isolada, inventário Mach-O e assinaturas (nada executado; lock inalterado)
  setup consent [--component C --basis B [--yes] | --revoke]
                                       aceite EXPLÍCITO de licença (Remotion); sem argumentos: lista os aceites
  opções: --json · --toolchain-dir D (ou BOLD_TOOLCHAIN_DIR)`;

const tidy = (s) => (typeof s === 'string' ? s.split(os.homedir()).join('~') : s);

function rootFor(args) {
  if (args.opts['toolchain-dir']) return path.resolve(args.opts['toolchain-dir']);
  return toolchainRoot({ platform: process.platform, env: process.env, home: os.homedir() });
}

const ICON = { USE_EXISTING: '✓', INSTALL: '↓', INSTALL_PENDING_LOCK: '…', PLANNED: '◷', MANUAL: '✋', LICENSE_REQUIRED: '§', SKIPPED_OPTIONAL: '·', UNSUPPORTED_PLATFORM: '✗' };

function formatPlan(p) {
  const L = [`BOLD setup — PLANO (somente leitura; nada foi executado)`, `plataforma ${p.platform.id} (${p.platform.support})${p.platform.notes.length ? ` · ${p.platform.notes.join('; ')}` : ''}`,
    `lock ${p.lock_status} · prontidão ${p.readiness}${p.essentials_missing.length ? ` · essenciais pendentes: ${p.essentials_missing.join(', ')}` : ''}`];
  for (const tier of ['ESSENTIAL', 'INTEGRATION', 'OPTIONAL']) {
    L.push(`\n[${tier}]`);
    for (const a of p.actions.filter((x) => x.tier === tier)) {
      L.push(`  ${ICON[a.action] ?? '?'} ${a.name.padEnd(34)} ${a.action.padEnd(21)} ${a.status}${a.version ? ` ${a.version}` : ''}${a.source ? ` (${a.source})` : ''}`);
      if (a.action !== 'USE_EXISTING' && a.action !== 'SKIPPED_OPTIONAL') L.push(`      ↳ ${a.reason}${a.hint ? ` — ${a.hint}` : ''}`);
    }
  }
  L.push('', ...p.notes);
  return L.join('\n');
}

function formatInventory(inv) {
  const L = [`BOLD setup — INVENTÁRIO (somente leitura) · ${inv.platform.id} (${inv.platform.support})`];
  for (const c of inv.components) { L.push(`  ${c.name.padEnd(34)} ${c.status.padEnd(20)} ${c.version ?? ''}${c.source ? ` (${c.source})` : ''}`); for (const d of c.details) L.push(`      ${d}`); }
  return L.join('\n');
}

export async function cmdSetup(args, loaded, stream = process.stdout) {
  const op = args._[1] || 'plan';
  const out = (payload, text) => stream.write(args.json ? `${JSON.stringify(payload, null, 2)}\n` : `${text}\n`);
  const ctx = () => { const probe = createProbe(); return { probe, loaded, platform: probePlatform(probe) }; };
  try {
    if (op === 'platform') { const p = probePlatform(createProbe()); out(p, `${p.id} · ${p.support}${p.process_arch !== p.arch ? ` (processo ${p.process_arch})` : ''}${p.notes.length ? `\n  ${p.notes.join('\n  ')}` : ''}`); return EXIT.OK; }
    if (op === 'inventory') { const inv = inventory(ctx()); out(inv, formatInventory(inv)); return EXIT.OK; }
    if (op === 'plan') {
      const c = ctx(); const inv = inventory(c); const lock = trustedLock();
      if (!lock.valid) { out({ ok: false, error: 'LOCK_INVALID', details: lock.errors }, `toolchain.lock.json inválido:\n  ${lock.errors.join('\n  ')}`); return EXIT.FAIL; }
      const include = String(args.opts.include || '').split(',').filter(Boolean);
      const root = rootFor(args);
      const consents = Object.fromEntries(Object.keys(LICENSES).map((k) => [k, consentFor(root, k)]).filter(([, v]) => v));
      const p = buildPlan({ inventory: inv, platform: c.platform, lock, include, allowLoopback: trustAllowsLoopback(), consents });
      out({ ...p, toolchain_root: tidy(rootFor(args)) }, `${formatPlan(p)}\ntoolchain gerenciado: ${tidy(rootFor(args))}`);
      return EXIT.OK;
    }
    if (op === 'status') { const s = status(rootFor(args)); out({ ...s, root: tidy(s.root) }, s.exists ? `toolchain ${tidy(s.root)}${s.platform ? ` · ${s.platform}` : s.receipt_entries ? ' · plataforma desconhecida (active.json ausente)' : ' · vazio (nada instalado pelo setup)'}\n${s.active.map((a) => `  ${a.tool.padEnd(12)} ${a.version}${a.previous ? ` (anterior ${a.previous})` : ''}${a.codesign ? ` · assinatura ${a.codesign}` : ''}`).join('\n') || '  (nenhuma ferramenta ativa)'}\n  recibo: ${s.receipt_entries} entradas · ${s.bytes} bytes${s.locked ? ' · LOCK presente' : ''}` : `nenhum toolchain gerenciado em ${tidy(s.root)} (nada instalado pelo setup)`); return EXIT.OK; }
    if (op === 'verify') { const v = verify(rootFor(args), { lock: trustedLock() });   // R12.5C3c-B: árvore também contra o lock oficial
      out({ ...v, root: tidy(v.root) }, `verify ${tidy(v.root)}: ${v.status}${v.entries.map((e) => `\n  ${e.status.padEnd(9)} ${e.tool} ${e.version}${e.codesign ? ` · assinatura ${e.codesign}` : ''}`).join('')}${v.issues.map((i) => `\n  ! ${i.code} ${i.dir ?? i.tool ?? ''}${i.detail ? ` — ${i.detail}` : ''}${i.hint ? ` — ${i.hint}` : ''}`).join('')}${v.untracked.length ? `\n  não rastreados (preservados): ${v.untracked.join(', ')}` : ''}`); return v.status === 'FAIL' ? EXIT.FAIL : EXIT.OK; }
    if (op === 'rollback') {
      if (!args.opts.tool) { process.stderr.write(`${SETUP_USAGE}\n`); return EXIT.USAGE; }
      const r = rollback({ root: rootFor(args), tool: args.opts.tool, yes: !!args.opts.yes, home: os.homedir() });
      out(r, r.ok ? `${r.dry_run ? 'DRY-RUN' : 'ROLLBACK'} ${r.plan.tool}: ${r.plan.from} → ${r.plan.to}${r.plan.codesign ? ` (assinatura ${r.plan.codesign} verificada)` : ''}${r.note ? ` · ${r.note}` : ''}` : `rollback ${args.opts.tool}: ${r.code}${r.detail ? ` — ${r.detail}` : ''}`);
      return r.ok ? EXIT.OK : EXIT.STOP;
    }
    if (op === 'simulate') { const r = runSimulation({ keep: !!args.opts.keep }); out(r, `simulação (temporária, sintética, sem rede) ${r.platform}: ${r.ok ? 'PASS' : 'FAIL'}\n${r.steps.map((s) => `  ${s.ok ? 'OK  ' : 'FAIL'} ${s.step}${s.detail ? ` — ${s.detail}` : ''}${!s.ok && s.message ? ` — ${s.message}` : ''}`).join('\n')}${r.kept ? `\n  mantido em ${r.kept}` : '\n  diretório temporário removido'}`); return r.ok ? EXIT.OK : EXIT.FAIL; }
    if (op === 'licenses') { const rows = COMPONENTS.map((c) => ({ id: c.id, name: c.name, tier: c.tier, license: c.license, policies: c.platforms, notes: c.notes })); out(rows, rows.map((r) => `${r.name.padEnd(34)} ${r.tier.padEnd(12)} ${r.license}\n${r.notes.map((n) => `      ${n}`).join('\n')}`).join('\n')); return EXIT.OK; }
    if (op === 'apply') {
      const components = String(args.opts.components || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (!components.length) { process.stderr.write(`bold setup apply: informe --components (lista explícita)\n${SETUP_USAGE}\n`); return EXIT.USAGE; }
      const lock = trustedLock();
      if (!lock.valid) { out({ ok: false, code: 'LOCK_INVALID', details: lock.errors }, `toolchain.lock.json inválido:\n  ${lock.errors.join('\n  ')}`); return EXIT.FAIL; }
      const interactive = !!(process.stdin.isTTY && process.stdout.isTTY) && !args.json;
      let rl = null;
      const confirm = interactive ? async (_item, text) => { rl ??= readline.createInterface({ input: process.stdin, output: process.stdout }); const a = await rl.question(`${text}\nConfirmar? [s/N] `); return /^(s|sim|y|yes)$/i.test(a.trim()); } : undefined;
      try {
        // R12.5 B3: o npm NUNCA vem do ambiente; só a suíte injeta um npm falso (em processo). Produção: Node gerenciado/PATH
        const npm = trustNpmOverride() ?? undefined;
        const r = await applyComponents({ components, lock, platform: probePlatform(createProbe()), root: rootFor(args), yes: !!args.opts.yes, dryRun: !!args.opts['dry-run'],
          confirm, archive: args.opts.archive || null, allowLoopback: trustAllowsLoopback(), home: os.homedir(), npm });
        out(r, `bold setup apply: ${r.code}${r.dry_run ? ' (dry-run: nada baixado nem instalado)' : ''}\n${r.results.map((x) => (x.text ? `${x.text}\n  → ${x.result}` : `  ${x.id}: ${x.result}${x.version ? ` ${x.version}` : ''}${x.codesign ? ` · assinatura ${x.codesign}` : ''}${x.migrated ? ' (registro de assinatura gravado; nada baixado)' : ''}${x.reason ? ` — ${x.reason}` : ''}${x.terms ? `\n${x.terms}` : ''}`)).join('\n')}`);
        return r.code === 'NOTHING_INSTALLABLE' ? EXIT.UNAVAILABLE : r.code === 'LICENSE_REQUIRED' ? EXIT.STOP : r.ok ? EXIT.OK : EXIT.FAIL;
      } finally { rl?.close(); }
    }
    if (op === 'measure') {
      if (!args.opts.component) { process.stderr.write(`bold setup measure: informe --component\n${SETUP_USAGE}\n`); return EXIT.USAGE; }
      const lock = trustedLock();
      if (!lock.valid) { out({ ok: false, code: 'LOCK_INVALID', details: lock.errors }, `toolchain.lock.json inválido:\n  ${lock.errors.join('\n  ')}`); return EXIT.FAIL; }
      const platform = args.opts.platform || probePlatform(createProbe()).id;
      const r = await measureComponent({ lock, component: args.opts.component, platform, output: args.opts.output, archiveDir: args.opts['archive-dir'], yes: !!args.opts.yes, allowLoopback: trustAllowsLoopback(), toolchainRoot: rootFor(args), hostPlatform: probePlatform(createProbe()).id });
      const s = r.summary;
      out({ ok: true, ...r, output: tidy(r.output) }, `bold setup measure ${r.component} ${r.version} (${r.platform}) — nada executado, instalado ou ativado; lock inalterado\n${r.parts.map((p) => `  [${p.id}] sha256 OK · ${p.files_total} arquivos · ${p.macho.length} Mach-O`).join('\n')}\n  assinaturas: ${Object.entries(s.by_class).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'} · Team IDs: ${s.team_ids.join(', ') || 'nenhum'}\n  recomendação: ${s.recommendation} — ${s.note}\n  evidência: ${tidy(r.output)}/measure.md`);
      return EXIT.OK;
    }
    if (op === 'consent') {
      const root = rootFor(args); const comp = args.opts.component;
      if (!comp) { const d = (() => { try { return readConsents(root); } catch (e) { return { error: e.message, consents: [] }; } })(); out(d, d.consents.length ? d.consents.map((c) => `  ${c.component} · ${c.license} · base "${c.basis}" · ${c.accepted_at}${c.revoked_at ? ` · REVOGADO ${c.revoked_at}` : ''}`).join('\n') : 'nenhum aceite registrado'); return EXIT.OK; }
      if (!LICENSES[comp]) { process.stderr.write(`sem portão de licença para ${comp} (válidos: ${Object.keys(LICENSES).join(', ')})\n`); return EXIT.USAGE; }
      if (args.opts.revoke) { const r = revokeConsent({ root, component: comp, home: os.homedir() }); out(r, `aceites revogados: ${r.revoked}`); return EXIT.OK; }
      const basis = args.opts.basis;
      const bases = LICENSES[comp].bases;
      if (!basis || !bases[basis]) { process.stderr.write(`${consentText(comp)}\n\nInforme --basis: ${Object.entries(bases).map(([k, v]) => `${k} (${v})`).join(' · ')}\n`); return EXIT.USAGE; }
      const text = `${consentText(comp)}\n\nBase declarada: ${basis} — ${bases[basis]}`;
      let ok = !!args.opts.yes;
      if (!ok && process.stdin.isTTY && process.stdout.isTTY && !args.json) { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); try { ok = /^(aceito|s|sim|y|yes)$/i.test((await rl.question(`${text}\n\nDigite "aceito" para registrar: `)).trim()); } finally { rl.close(); } }
      if (!ok) { out({ ok: false, code: 'CONSENT_NOT_GIVEN', text }, `${text}\n\naceite NÃO registrado (rode num terminal ou use --yes para declarar explicitamente)`); return EXIT.STOP; }
      const rec = recordConsent({ root, component: comp, basis, home: os.homedir() });
      out({ ok: true, consent: rec }, `aceite registrado: ${rec.component} · ${rec.license} · base "${rec.basis}" · ${rec.accepted_at}`);
      return EXIT.OK;
    }
    if (op === 'uninstall') {
      const r = uninstall({ root: rootFor(args), tool: args.opts.tool || null, yes: !!args.opts.yes, home: os.homedir() });
      out(r, `${r.dry_run ? 'DRY-RUN' : 'UNINSTALL'}${r.code ? ` ${r.code}` : ''}${r.remove.map((x) => `\n  remover  ${x.dir}${x.state === 'ALREADY_MISSING' ? ' (já ausente)' : ''}`).join('')}${r.keep.map((x) => `\n  manter   ${x.dir} — ${x.reason}`).join('')}${r.running_node ? `\n  ! o Node que executa esta CLI está em ${r.running_node}${r.dry_run ? ' e seria removido' : ' e foi removido'}; a próxima execução usa BOLD_NODE_PATH ou o PATH (sem Node: bootstrap/bootstrap.sh)` : ''}${r.note ? `\n  ${r.note}` : ''}`);
      return EXIT.OK;
    }
    process.stderr.write(`${SETUP_USAGE}\n`); return EXIT.USAGE;
  } catch (e) {
    if (e instanceof SetupError) { out({ ok: false, code: e.code, message: e.message }, `bold setup ${op}: ${e.code} — ${e.message}`); return e.code === 'LOCKED' || e.code === 'STALE_LOCK' ? EXIT.STOP : EXIT.FAIL; }
    throw e;
  }
}
