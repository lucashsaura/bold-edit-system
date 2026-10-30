// EXPORTS (R13): Remotion (TSX com <Sequence from> + <Audio>) e DaVinci (cue list com timecode e lanes).
// Os arquivos conformados já trazem rate, cortes, fades, ganho e o pad sub-frame: em ambos os destinos o cue entra num
// FRAME INTEIRO com volume 1 e a sincronia fica exata por amostra. Nada aqui grava no DaVinci nem renderiza.
import path from 'node:path';
import { parseFps, framesToTc, tcToFrames, dropFrameInfo } from '../../transcript/src/time.mjs';
import { AudioError } from './errors.mjs';

const fileFrames = (c, F) => Math.ceil(((c.pad_s + c.duration_tl) * F.num) / F.den) + 1;
const esc = (s) => String(s).replace(/[^A-Za-z0-9 ._·-]/g, '');

/** Componente Remotion. `publicPrefix` = pasta dos WAV dentro de public/ (staticFile). */
export function remotionTsx(plan, { publicPrefix = 'sons/conformados', files = {}, componentName = 'BoldSfx', stem = null } = {}) {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(componentName)) throw new AudioError('USAGE', 'nome de componente inválido');
  const F = parseFps(plan.fps);
  const rel = (c) => path.posix.join(publicPrefix, path.basename(files[c.id] ?? `${c.id}-${c.sound.id}.wav`));
  const lines = [
    `// Gerado pelo BOLD (bold audio export --remotion) a partir de bold.sound-plan/1 · ${plan.library.name} ${plan.library.version} (${plan.library.license})`,
    `// fps ${plan.fps} · ${plan.cues.length} cue(s) · ganho, fades e pad sub-frame já aplicados nos WAV (volume 1 aqui).`,
    "import React from 'react';",
    "import { Audio, Sequence, staticFile } from 'remotion';",
    '',
    `export const ${componentName}: React.FC = () => (`,
    '  <>',
    ...plan.cues.map((c) => `    <Sequence from={${c.start_frame}} durationInFrames={${fileFrames(c, F)}} name="${esc(`${c.id} ${c.sound.id} · ${c.kind}`)}" layout="none">\n      <Audio src={staticFile('${rel(c)}')} />\n    </Sequence>`),
    '  </>',
    ');',
  ];
  if (stem) lines.push('', `/** Alternativa: o stem/mix inteiro desde o frame 0 (mesma sincronia). */`, `export const ${componentName}Stem: React.FC = () => <Audio src={staticFile('${path.posix.join(publicPrefix, path.basename(stem))}')} />;`);
  return `${lines.join('\n')}\n`;
}

/** Cue list para o DaVinci: lane (A1…), TC de gravação (com início de timeline opcional), duração em frames, arquivo. */
export function davinciCueList(plan, { files = {}, tcStart = '00:00:00:00' } = {}) {
  const F = parseFps(plan.fps); const df = dropFrameInfo(F) !== null;
  const base = tcToFrames(tcStart, F, df);
  const rows = plan.cues.map((c) => ({
    cue: c.id, lane: `A${c.lane}`, record_frame: base + c.start_frame, record_tc: framesToTc(base + c.start_frame, F, df), duration_frames: fileFrames(c, F),
    file: path.basename(files[c.id] ?? `${c.id}-${c.sound.id}.wav`), sound: c.sound.id, kind: c.kind, moment_tc: framesToTc(base + Math.round((c.t * F.num) / F.den), F, df),
    gain_baked_db: c.gain_db, origin: c.sound.origin, license: c.sound.license,
  }));
  const head = ['cue', 'lane', 'record_tc', 'record_frame', 'duration_frames', 'file', 'sound', 'kind', 'moment_tc', 'gain_baked_db', 'origin', 'license'];
  const csv = [head.join(','), ...rows.map((r) => head.map((k) => /[",\n]/.test(String(r[k])) ? `"${String(r[k]).replace(/"/g, '""')}"` : r[k]).join(','))].join('\n');
  return {
    schema: 'bold.davinci-audio-cues/1', fps: plan.fps, drop_frame: df, timeline_start_tc: tcStart, lanes: plan.summary.lanes, rows, csv: `${csv}\n`,
    how: [
      'Importe a pasta dos WAV conformados no Media Pool (nada é escrito pelo BOLD sem autorização davinci-write).',
      'Opção 1 (mais simples): o stem de SFX inteiro numa track de áudio vazia, no início da timeline (record_tc do frame 0).',
      'Opção 2 (editável): cada cue na sua lane (A1…An) no record_tc indicado; volume 0 dB (o ganho já está no arquivo).',
      'Fps e drop-frame do plano precisam ser os da timeline; confira antes de posicionar.',
    ],
  };
}
