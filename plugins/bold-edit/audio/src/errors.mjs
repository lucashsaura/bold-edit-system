// Erros do módulo de áudio (R13). Mesmo idioma dos outros módulos: código estável + mensagem + detalhes opcionais.
export class AudioError extends Error { constructor(code, message, details = null) { super(`${code}: ${message}`); this.code = code; this.details = details; } }
