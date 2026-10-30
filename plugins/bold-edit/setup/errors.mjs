// Erro tipado do Setup Manager: `code` estável (testes e CLI dependem dele) + mensagem + detalhes serializáveis.
export class SetupError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
