// `bold doctor --module audio` (R13) — SOMENTE LEITURA. Detecta os componentes de sound design sem executar nada pesado:
// SFX Kit (biblioteca compartilhada, CC0), Earshot (opcional: venv + modelos fixados), Openverse (API sob demanda) e ffmpeg.
// Ausências são WARNING; só o SFX Kit vira FAIL quando o módulo é solicitado. Nada é baixado nem instalado.
import fs from 'node:fs';
import { locateSfxKit, locateEarshot } from '../../audio/src/locate.mjs';
import { loadKit, verifyKit } from '../../audio/src/sfxkit.mjs';
import { earshotStatus } from '../../audio/src/earshot.mjs';
import { currentStorage } from '../../audio/src/storage.mjs';

const mk = (id, label) => (status, detail, hint) => ({ id: `audio.${id}`, module: 'audio', label, status, detail, ...(hint ? { hint } : {}) });
const tidy = (probe, s) => (typeof s === 'string' && probe.home ? s.split(probe.home).join('~') : s);

export function audioChecks(ctx) {
  const { probe, loaded, requested } = ctx; const out = []; const asked = requested?.has('audio');
  const where = { config: loaded.config, env: probe.env ?? {}, platform: probe.platform, home: probe.home };
  {
    // armazenamento externo (SSD): ausente vira WARNING com o que fica indisponível — nunca reinstala no disco interno
    const r = mk('storage', 'Armazenamento do áudio (interno ou SSD externo)');
    const st = currentStorage(where);
    if (!st.configured) out.push(r('PASS', 'interno (padrão) · bold audio storage candidates lista SSDs externos'));
    else if (st.online) out.push(r('PASS', `externo ONLINE · ${tidy(probe, st.root)}${st.volume?.image ? ' · imagem APFS montada' : ''}`));
    else out.push(r(st.state === 'WRONG_VOLUME' || st.state === 'INVALID' ? 'FAIL' : 'WARNING', `externo ${st.state}: ${tidy(probe, st.detail)} · indisponível: ${st.unavailable.join('; ')} · continua: ${st.available.join('; ')}`, st.recover));
  }
  {
    const r = mk('sfx-kit', 'SFX Kit (biblioteca local de efeitos)');
    const l = locateSfxKit(where);
    if (!l.found && l.offline) out.push(r('WARNING', `no armazenamento externo, indisponível agora (${tidy(probe, l.offline.detail)})`, l.offline.recover));
    else if (!l.found) out.push(r(asked ? 'FAIL' : 'WARNING', `não encontrado (${tidy(probe, l.roots.libraries)})`, 'bold audio setup sfx-kit → bold audio library install --yes (55 MB, CC0, sha256 fixado)'));
    else {
      try {
        const k = loadKit(l.dir); const v = verifyKit(k);
        out.push(v.status === 'PASS' ? r('PASS', `${k.name} ${k.version} · ${k.license} · ${v.sounds} sons / ${v.categories} categorias · ${tidy(probe, l.dir)} (${l.source})${l.provenance ? ' · proveniência registrada' : ''}`)
          : r('FAIL', `${v.missing.length} arquivo(s) ausente(s)`, 'bold audio library verify --full; reinstale se preciso'));
      } catch (e) { out.push(r('FAIL', e.message, 'sounds.json fora do schema esperado: não uso metadados inventados')); }
    }
  }
  {
    const r = mk('earshot', 'Earshot (análise e geração procedural — opcional)');
    const loc = locateEarshot(where); const s = earshotStatus(loc);
    if (!s.installed && s.offline) out.push(r('WARNING', `no armazenamento externo, indisponível agora (${tidy(probe, s.storage.detail)})`, s.storage.recover));
    else if (!s.installed) out.push(r('WARNING', 'não instalado (opcional: o BOLD funciona sem ele)', 'bold audio setup earshot mostra o plano guiado'));
    else if (s.venv_path_ok === false) out.push(r('WARNING', `venv criada em outro caminho (${tidy(probe, s.dir)}): os scripts apontam para o local antigo`, 'recrie a venv no local atual com o lock fixado (references/sound-design.md → armazenamento externo)'));
    else out.push(s.models_ready ? r('PASS', `${s.version ?? '?'} @ ${String(s.commit ?? '').slice(0, 7)} · ${s.source === 'storage' ? 'SSD · ' : ''}modelos fixados presentes (uso offline) · MCP ${s.mcp_registered ? 'registrado' : 'não registrado'}`)
      : r('WARNING', `${s.version ?? '?'} instalado, modelos ausentes (análise por modelo indisponível; measure e sfx render funcionam)`, 'modelos ~1.1 GB: earshot doctor --fetch, só com aprovação'));
  }
  {
    const r = mk('openverse', 'Openverse (fallback online)');
    out.push(r('PASS', 'API pública https://api.openverse.org/v1/audio/ · consultada só sob demanda (sem chamada no doctor) · anônimo 20/min, 200/dia'));
  }
  {
    const r = mk('ffmpeg', 'ffmpeg (mix, EBU R128, true peak)');
    const ff = loaded.config.tools?.FFMPEG_PATH && loaded.config.tools.FFMPEG_PATH !== 'auto' ? loaded.config.tools.FFMPEG_PATH : probe.which('ffmpeg');
    out.push(ff && (probe.isFile?.(ff) ?? fs.existsSync(ff)) ? r('PASS', tidy(probe, ff)) : r(asked ? 'FAIL' : 'WARNING', 'não encontrado', 'o mix e a medição usam o ffmpeg do BOLD (bold setup)'));
  }
  return out;
}
