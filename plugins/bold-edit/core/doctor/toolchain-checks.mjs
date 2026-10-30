// Módulo `toolchain` do `bold doctor` (R12.2) — SOMENTE LEITURA.
// Plataforma-alvo do Setup Manager, toolchain gerenciado (ponteiros, recibo, integridade), lock e ferramentas que a config
// resolve a partir do toolchain. Sem módulo solicitado: verificação RÁPIDA (sem rehash). Com --module toolchain: rehash completo.
import { toolchainRoot } from '../config/paths.mjs';
import { detectPlatform } from '../../setup/platform.mjs';
import { verify, status } from '../../setup/engine.mjs';
import { trustedLock } from '../../setup/trust.mjs';
import { LICENSES, consentFor } from '../../setup/consent.mjs';
import { COMPONENTS } from '../../setup/components.mjs';

const mk = (id, label) => (st, detail, hint) => ({ id: `toolchain.${id}`, module: 'toolchain', label, status: st, detail, ...(hint ? { hint } : {}) });

export function toolchainChecks(ctx) {
  const { probe, loaded, requested } = ctx;
  const req = requested.has('toolchain');
  const out = [];
  const plat = detectPlatform({ platform: probe.platform, arch: probe.arch });
  {
    const r = mk('platform', 'Plataforma do Setup Manager');
    out.push(r(plat.support === 'SUPPORTED' ? 'PASS' : 'WARNING', `${plat.id} (${plat.support})`, plat.support === 'SUPPORTED' ? undefined : 'macOS Intel e Windows x64 são EXPERIMENTAIS; Windows ARM64 não é gerenciado.'));
  }
  const root = toolchainRoot({ platform: probe.platform, env: probe.env || {}, home: probe.home });
  const tidy = (s) => (probe.home ? String(s).split(probe.home).join('~') : s);
  {
    const r = mk('state', 'Toolchain gerenciado');
    let s; try { s = status(root); } catch (e) { s = { error: e.code || e.message }; }
    if (s.error) out.push(r(req ? 'FAIL' : 'WARNING', `ilegível: ${s.error}`, 'Confira active.json/receipt.json; o setup não altera nada sem confirmação.'));
    else if (!s.exists) out.push(r('PASS', `nenhum (opcional) — ${tidy(root)}`));
    else out.push(r('PASS', `${s.active.map((a) => `${a.tool} ${a.version}`).join(', ') || 'sem ferramentas ativas'} · ${s.receipt_entries} no recibo${s.locked ? ' · LOCK presente' : ''}`));
  }
  {
    const r = mk('integrity', `Integridade (${req ? 'rehash completo' : 'rápida'})`);
    let v; try { let lock = null; try { lock = trustedLock(); } catch { lock = null; } v = verify(root, { deep: req, lock }); } catch (e) { v = { status: 'ERROR', issues: [{ code: e.code || e.message }] }; }
    if (v.status === 'EMPTY') out.push(r('PASS', 'nada instalado pelo setup'));
    else if (v.status === 'PASS') out.push(r('PASS', `${v.entries.length} versão(ões) íntegra(s)${v.untracked?.length ? ` · não rastreados preservados: ${v.untracked.join(', ')}` : ''}`));
    else out.push(r(req ? 'FAIL' : 'WARNING', v.issues.map((i) => `${i.code}${i.dir ? ` ${i.dir}` : i.tool ? ` ${i.tool}` : ''}`).join('; '), 'Rode `bold setup verify`; arquivos modificados nunca são removidos automaticamente.'));
  }
  {
    // R12.5B: assinatura de código (macOS) — registro gravado na ativação; instalação anterior à política é sinalizada
    const r = mk('codesign', 'Assinatura de código (macOS)');
    if (!String(plat.id).startsWith('darwin-')) out.push(r('PASS', 'não aplicável nesta plataforma (Windows: política inalterada)'));
    else {
      let s = null; let v = null; try { s = status(root); v = verify(root, { deep: false }); } catch { s = null; }
      if (!s?.exists) out.push(r('PASS', 'nada instalado pelo setup'));
      else {
        const legacy = [...new Set((v?.issues || []).filter((i) => i.code === 'SIGNATURE_UNVERIFIED').map((i) => i.tool))];
        const signed = s.active.filter((a) => a.codesign).map((a) => `${a.tool} ${a.codesign}`);
        if (legacy.length) out.push(r(req ? 'FAIL' : 'WARNING', `sem verificação registrada: ${legacy.join(', ')}`, 'Instalação anterior à política: rode \`bold setup apply --components <id> --yes\` (verifica e registra; não baixa de novo).'));
        else out.push(r('PASS', signed.length ? `assinatura verificada antes da ativação: ${signed.join(', ')}` : 'nenhuma ferramenta ativa com política de assinatura'));
      }
    }
  }
  {
    const r = mk('lock', 'toolchain.lock.json');
    let l; try { l = trustedLock(); } catch (e) { l = { valid: false, errors: [e.message] }; }
    if (!l.valid) out.push(r('FAIL', `inválido: ${l.errors.slice(0, 2).join('; ')}`));
    else {
      const pinned = Object.values(l.data.components).flatMap((c) => Object.values(c.platforms)).filter((a) => a.status === 'PINNED').length;
      out.push(r('PASS', `${l.data.lock_status} · ${pinned} artefato(s) fixado(s)${pinned ? '' : ' — nenhum artefato fixado: instalação gerenciada indisponível'}`));
    }
  }
  {
    const r = mk('optional', 'Componentes opcionais gerenciados');
    let s; try { s = status(root); } catch { s = { active: [] }; }
    const opt = new Set(COMPONENTS.filter((c) => c.tier === 'OPTIONAL').map((c) => c.id));
    const inst = (s.active || []).filter((a) => opt.has(a.tool)).map((a) => `${a.tool} ${a.version}`);
    out.push(r('PASS', inst.length ? inst.join(', ') : 'nenhum (opcionais nunca são instalados automaticamente)'));
  }
  {
    const r = mk('consent', 'Aceites de licença');
    const rows = Object.keys(LICENSES).map((k) => { const c = consentFor(root, k); return c ? `${k}: base "${c.basis}" (${c.accepted_at.slice(0, 10)})` : `${k}: sem aceite`; });
    out.push(r('PASS', rows.join(' · ')));
  }
  {
    const r = mk('config', 'Ferramentas resolvidas pelo toolchain');
    const keys = Object.entries(loaded.sources || {}).filter(([, v]) => v === 'toolchain').map(([k]) => k.replace(/^tools\./, ''));
    out.push(r('PASS', keys.length ? keys.join(', ') : 'nenhuma (config usa caminhos explícitos ou o PATH)'));
  }
  return out;
}
