// CLASSIFICAÇÃO (R8): extensão → tipo + tags. Os metadados reais (ffprobe/cabeçalho) confirmam ou anotam depois.
// MOTION_MASTER exige EVIDÊNCIA: manifest do BOLD Delivery (<nome>.delivery.json) ao lado do vídeo.
export const CLASSIFIER_VERSION = 'r8.1';
export const TYPES = ['VIDEO', 'AUDIO', 'IMAGE', 'VECTOR', 'DOCUMENT', 'FONT', 'MOTION_MASTER', 'UNKNOWN'];

const EXT = {
  VIDEO: ['mov', 'mp4', 'm4v', 'mxf', 'avi', 'mkv', 'webm', 'mts', 'm2ts', '3gp', 'mpg', 'mpeg', 'wmv', 'flv', 'dv', 'braw', 'r3d', 'ari', 'crm'],
  AUDIO: ['wav', 'aif', 'aiff', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'caf'],
  IMAGE: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff', 'heic', 'heif', 'bmp', 'psd', 'exr', 'dpx', 'tga', 'avif', 'dng', 'cr2', 'cr3', 'nef', 'arw'],
  VECTOR: ['svg', 'ai', 'eps'],
  DOCUMENT: ['pdf', 'txt', 'md', 'rtf', 'doc', 'docx', 'odt', 'pages', 'key', 'ppt', 'pptx', 'xls', 'xlsx', 'numbers', 'csv', 'json', 'xml', 'srt', 'vtt', 'drp', 'drt', 'aep', 'prproj', 'fcpxml', 'edl', 'otio'],
  FONT: ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2', 'dfont'],
};
const TAGS = { braw: ['camera_raw'], r3d: ['camera_raw'], ari: ['camera_raw'], crm: ['camera_raw'], dng: ['camera_raw'], cr2: ['camera_raw'], cr3: ['camera_raw'], nef: ['camera_raw'], arw: ['camera_raw'],
  psd: ['layered'], exr: ['hdr', 'image_sequence_frame_candidate'], dpx: ['image_sequence_frame_candidate'], srt: ['subtitle'], vtt: ['subtitle'],
  drp: ['project_file', 'davinci'], drt: ['project_file', 'davinci'], aep: ['project_file'], prproj: ['project_file'], fcpxml: ['edit_list'], edl: ['edit_list'], otio: ['edit_list'], json: ['data'], csv: ['data'], xml: ['data'] };
const BY_EXT = Object.fromEntries(Object.entries(EXT).flatMap(([t, xs]) => xs.map((x) => [x, t])));

/** Ruído de sistema que nunca é asset. */
export const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', 'Icon\r']);
export const SKIP_DIRS = new Set(['.git', '.bold', '.Trashes', '.Spotlight-V100', '.fseventsd', '.TemporaryItems', 'node_modules', '__pycache__']);

export function classify(name) {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return { ext, type: BY_EXT[ext] ?? 'UNKNOWN', tags: [...(TAGS[ext] ?? [])] };
}

export function orientation(w, h) {
  if (!(w > 0 && h > 0)) return null;
  return w > h ? 'horizontal' : h > w ? 'vertical' : 'square';
}
