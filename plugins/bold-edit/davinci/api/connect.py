"""Conexão com o DaVinci Resolve (Scripting API, Python). SOMENTE conecta e lê; nunca abre o Resolve, nunca troca
projeto/página. Caminhos vêm do ambiente (RESOLVE_SCRIPT_API/LIB) ou dos defaults por SO."""
import os
import sys

DEFAULTS = {
    "darwin": ("/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting",
               "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so"),
    "win32": (os.path.join(os.environ.get("PROGRAMDATA", "C:\\ProgramData"), "Blackmagic Design", "DaVinci Resolve", "Support", "Developer", "Scripting"),
              "C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\fusionscript.dll"),
    "linux": ("/opt/resolve/Developer/Scripting", "/opt/resolve/libs/Fusion/fusionscript.so"),
}


class BridgeError(Exception):
    """Erro tipado da Bridge: code estável + mensagem + detalhes (sempre serializável)."""

    def __init__(self, code, message, details=None):
        super().__init__(f"{code}: {message}")
        self.code, self.message, self.details = code, message, details

    def to_json(self):
        return {"code": self.code, "message": self.message, "details": self.details}


def api_paths():
    plat = "darwin" if sys.platform == "darwin" else "win32" if sys.platform.startswith("win") else "linux"
    api_d, lib_d = DEFAULTS[plat]
    return os.environ.get("RESOLVE_SCRIPT_API") or api_d, os.environ.get("RESOLVE_SCRIPT_LIB") or lib_d


def connect(scriptapp=None):
    """Retorna o objeto `resolve`. scriptapp injetável (testes). Resolve fechado / scripting desligado → BridgeError."""
    if scriptapp is None:
        api, lib = api_paths()
        if not os.path.isdir(os.path.join(api, "Modules")):
            raise BridgeError("API_NOT_FOUND", "DaVinciResolveScript não encontrado (RESOLVE_SCRIPT_API)", {"api": "RESOLVE_SCRIPT_API"})
        os.environ.setdefault("RESOLVE_SCRIPT_API", api)
        os.environ.setdefault("RESOLVE_SCRIPT_LIB", lib)
        mod = os.path.join(api, "Modules")
        if mod not in sys.path:
            sys.path.append(mod)
        try:
            import DaVinciResolveScript as dvr  # noqa: N813 — módulo do fabricante
        except Exception as e:  # pragma: no cover — depende da instalação
            raise BridgeError("API_IMPORT_FAILED", f"falha ao importar DaVinciResolveScript: {e}")
        scriptapp = dvr.scriptapp
    resolve = scriptapp("Resolve")
    if resolve is None:
        raise BridgeError("DISCONNECTED", "Resolve fechado ou External Scripting != Local (Preferences › System › General)")
    return resolve
