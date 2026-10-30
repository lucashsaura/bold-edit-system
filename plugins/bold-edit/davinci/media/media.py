"""MEDIA POOL por FILE PATH (H5). Nunca seleciona por nome de arquivo; nome repetido em pastas diferentes é normal.
Mais de um item com o MESMO File Path → AMBIGUOUS (ABORT). Caminhos comparados em NFC + realpath."""
import os

from davinci.api.connect import BridgeError
from davinci.safety.guards import nfc


def norm_path(p):
    return nfc(os.path.normpath(p)) if p else p


def walk(folder, path=""):
    here = f"{path}/{folder.GetName()}" if path else folder.GetName()
    for clip in folder.GetClipList() or []:
        yield here, clip
    for sub in folder.GetSubFolderList() or []:
        yield from walk(sub, here)


def clip_info(bin_path, clip):
    fp = clip.GetClipProperty("File Path") or None
    return {"name": clip.GetName(), "bin": bin_path, "file_path": fp, "unique_id": clip.GetUniqueId(),
            "type": clip.GetClipProperty("Type") or None, "fps": clip.GetClipProperty("FPS") or None,
            "frames": clip.GetClipProperty("Frames") or None, "resolution": clip.GetClipProperty("Resolution") or None}


def find_by_path(media_pool, path):
    """Exatamente 1 item com este File Path → (bin, clip). 0 → None. >1 → MEDIA_AMBIGUOUS."""
    want = norm_path(path)
    hits = [(b, c) for b, c in walk(media_pool.GetRootFolder()) if norm_path(c.GetClipProperty("File Path") or "") == want]
    if len(hits) > 1:
        raise BridgeError("MEDIA_AMBIGUOUS", f"{len(hits)} itens do Media Pool com o mesmo File Path; desambigue (bin/UniqueId)",
                          {"file_path": path, "candidates": [clip_info(b, c) for b, c in hits]})
    return hits[0] if hits else None


def same_name_elsewhere(media_pool, path):
    """Itens com o MESMO nome de arquivo e OUTRO File Path (informativo: prova que a busca não foi por nome)."""
    base = nfc(os.path.basename(path)); want = norm_path(path)
    return [clip_info(b, c) for b, c in walk(media_pool.GetRootFolder())
            if nfc(os.path.basename(c.GetClipProperty("File Path") or "")) == base and norm_path(c.GetClipProperty("File Path") or "") != want]


def check_file(path):
    if not path or not os.path.isabs(path):
        raise BridgeError("MEDIA_PATH_INVALID", "caminho absoluto obrigatório", {"file_path": path})
    if not os.path.isfile(path):
        raise BridgeError("MEDIA_MISSING", "arquivo não existe (não confunda com 'offline' visual do Resolve)", {"file_path": path})
    if os.path.getsize(path) == 0:
        raise BridgeError("MEDIA_EMPTY", "arquivo vazio", {"file_path": path})
    return os.path.realpath(path)


def ensure_bin(media_pool, name):
    """Bin de motion na raiz (cria se não existir — write leve, só chamado depois dos guards)."""
    root = media_pool.GetRootFolder()
    for sub in root.GetSubFolderList() or []:
        if sub.GetName() == name:
            return sub
    f = media_pool.AddSubFolder(root, name)
    if f is None:
        raise BridgeError("BIN_CREATE_FAILED", f"não foi possível criar o bin {name!r}")
    return f
