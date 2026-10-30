# core/policy — STATUS: STABLE (fundação)

- `invariants.mjs` — invariantes (render/export exigem autorização explícita; OpenPage proibido;
  mídia do usuário nunca apagada; telemetria desligada) e `resolvePolicy()`: nenhuma camada afrouxa.
- `gate.mjs` — **CLI EXECUTION GATE**: exige autorização **estruturada** para ações protegidas e gera o
  registro `{action, timestamp, project, authorization_source, authorization_text, command, allowed, reason}`.
  Nunca interpreta linguagem natural.
- `authorization-language.mjs` — material de apoio da **camada Skill/agente** (não usado pelo CLI):
  palavras de fluxo nunca autorizam; verbos explícitos são candidatos que o agente confirma pelo contexto.

## Autorização estruturada
```json
{ "action": "render", "source": "agent_attested_user_message",
  "text": "<mensagem do usuário>", "granted_at": "<ISO-8601>", "project": "<project_id>" }
```
Origens aceitas: `interactive_confirmation` (humano confirma s/N num TTY — sem frase mágica) e
`agent_attested_user_message` (agente atesta a mensagem; texto obrigatório). Validade padrão: 60 min.
