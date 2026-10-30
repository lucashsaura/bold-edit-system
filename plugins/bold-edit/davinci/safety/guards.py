"""SAFETY GATES (davinci-safety.md H1/H2/H7/H8). Nenhuma função aqui escreve na timeline.
- project_guard: o projeto CORRENTE tem exatamente o nome esperado (a Bridge nunca troca de projeto).
- page_guard: escrita só na página Edit (H7). A Bridge NUNCA chama OpenPage (H8) — pede ao usuário.
- timeline_gate: SetCurrentTimeline(alvo) → GetCurrentTimeline() → nome == alvo, IMEDIATAMENTE antes de cada write (H1).
- sandbox: nomes de projeto/timeline do sandbox da Bridge (writes de desenvolvimento só aí)."""
import re
import unicodedata

from davinci.api.connect import BridgeError

SANDBOX_PROJECT_RE = re.compile(r"^BOLD_BRIDGE_SANDBOX(?:_[A-Za-z0-9-]{1,32})?$")
SANDBOX_TIMELINE_RE = re.compile(r"^BOLD_BRIDGE_TEST(?:_[A-Za-z0-9-]{1,32})?$")


def nfc(s):
    return unicodedata.normalize("NFC", s) if isinstance(s, str) else s


def is_sandbox_project(name):
    return bool(name) and bool(SANDBOX_PROJECT_RE.fullmatch(name))


def is_sandbox_timeline(name):
    return bool(name) and bool(SANDBOX_TIMELINE_RE.fullmatch(name))


def current_project(resolve):
    p = resolve.GetProjectManager().GetCurrentProject()
    if p is None:
        raise BridgeError("NO_PROJECT", "nenhum projeto aberto no Resolve")
    return p


def project_guard(resolve, expected):
    if not expected:
        raise BridgeError("PROJECT_REQUIRED", "informe --project (nome exato do projeto esperado)")
    p = current_project(resolve)
    name = p.GetName()
    if nfc(name) != nfc(expected):
        raise BridgeError("WRONG_PROJECT", "o projeto aberto não é o esperado (a Bridge nunca troca de projeto)", {"expected": expected, "actual": name})
    return p


def page_guard(resolve):
    page = resolve.GetCurrentPage()
    if page != "edit":
        raise BridgeError("WRONG_PAGE", f"página atual = {page!r}; writes só na página Edit. Peça ao usuário para trocar (OpenPage é proibido)", {"page": page})
    return page


def timelines(project):
    return [project.GetTimelineByIndex(i) for i in range(1, (project.GetTimelineCount() or 0) + 1)]


def find_timeline(project, name):
    hits = [t for t in timelines(project) if t is not None and nfc(t.GetName()) == nfc(name)]
    if not hits:
        raise BridgeError("TIMELINE_NOT_FOUND", f"timeline {name!r} não existe no projeto", {"timeline": name})
    if len(hits) > 1:
        raise BridgeError("TIMELINE_AMBIGUOUS", f"{len(hits)} timelines com o nome {name!r}", {"timeline": name, "count": len(hits)})
    return hits[0]


def timeline_gate(resolve, project, name):
    """H1 — chamar IMEDIATAMENTE antes de CADA write. Nunca confiar num objeto Timeline obtido antes."""
    page_guard(resolve)
    tl = find_timeline(project, name)
    ok = project.SetCurrentTimeline(tl)
    cur = project.GetCurrentTimeline()
    cur_name = cur.GetName() if cur is not None else None
    if not ok or cur is None or nfc(cur_name) != nfc(name):
        raise BridgeError("TIMELINE_GATE_FAILED", "a timeline corrente não é a alvo; write ABORTADO", {"expected": name, "actual": cur_name, "set_ok": bool(ok)})
    return cur


EXPLICIT_OPERATIONS = ("delete",)  # operações destrutivas: a autorização precisa listá-las EXPLICITAMENTE


def write_scope(project_name, timeline_name, authorization, operation=None):
    """Writes de desenvolvimento só no sandbox. Projeto real exige autorização humana `davinci-write` com o MESMO
    projeto e timeline no escopo (validada pelo CLI Node antes de chegar aqui; aqui se confere de novo o escopo).
    Operações destrutivas (delete) exigem estar em `davinci.operations` — autorização genérica não vale."""
    if is_sandbox_project(project_name):
        return {"mode": "sandbox"}
    a = authorization or {}
    if "davinci-write" not in (a.get("action") if isinstance(a.get("action"), list) else [a.get("action")]):
        raise BridgeError("REAL_PROJECT_WRITE_DENIED", "projeto não-sandbox: write exige autorização humana estruturada davinci-write", {"project": project_name})
    scope = a.get("davinci") or {}
    if nfc(scope.get("project")) != nfc(project_name) or (timeline_name is not None and nfc(scope.get("timeline")) != nfc(timeline_name)):
        raise BridgeError("AUTHORIZATION_SCOPE_MISMATCH", "a autorização não cobre este projeto/timeline", {"project": project_name, "timeline": timeline_name})
    if operation in EXPLICIT_OPERATIONS and operation not in (scope.get("operations") or []):
        raise BridgeError("AUTHORIZATION_SCOPE_MISMATCH", f"{operation} exige autorização que liste a operação explicitamente", {"operation": operation})
    return {"mode": "authorized_real_project"}
