"""Tempo: frames ↔ segundos ↔ timecode, SEMPRE com o FPS real da timeline (nunca 24 fixo).
Drop-frame (29.97/59.94 DF) tratado explicitamente (SMPTE 12M): numeração pula 2 (ou 4) números de frame por minuto,
exceto a cada 10 minutos. Timecode DF usa ';' como separador de frames."""
from fractions import Fraction

NTSC = {23.976: Fraction(24000, 1001), 29.97: Fraction(30000, 1001), 47.952: Fraction(48000, 1001), 59.94: Fraction(60000, 1001), 119.88: Fraction(120000, 1001)}


class TimecodeError(ValueError):
    pass


def parse_fps(v):
    """'24' | '23.976' | 59.94 → Fraction exata."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise TimecodeError(f"fps inválido: {v!r}")
    for k, fr in NTSC.items():
        if abs(f - k) < 0.005:
            return fr
    if f <= 0 or abs(f - round(f)) > 1e-6:
        raise TimecodeError(f"fps não suportado: {v!r}")
    return Fraction(round(f))


def nominal(fps):
    return round(float(fps))


def df_drop(fps, drop_frame):
    """Números de frame descartados por minuto (0 se NDF)."""
    if not drop_frame:
        return 0
    n = nominal(fps)
    if n not in (30, 60) or fps.denominator != 1001:
        raise TimecodeError(f"drop-frame só existe em 29.97/59.94 (fps={float(fps):.3f})")
    return 2 * n // 30


def frames_to_tc(frame, fps, drop_frame=False):
    if not isinstance(frame, int) or frame < 0:
        raise TimecodeError(f"frame inválido: {frame!r}")
    n = nominal(fps); d = df_drop(fps, drop_frame)
    f = frame
    if d:
        per10 = n * 600 - d * 9
        per1 = n * 60 - d
        tens, rem = divmod(f, per10)
        f += d * 9 * tens + (d * ((rem - d) // per1) if rem > d else 0)
    hh, rem = divmod(f, n * 3600)
    mm, rem = divmod(rem, n * 60)
    ss, ff = divmod(rem, n)
    return f"{hh:02d}:{mm:02d}:{ss:02d}{';' if d else ':'}{ff:02d}"


def tc_to_frames(tc, fps, drop_frame=False):
    import re
    m = re.fullmatch(r"(\d{2}):(\d{2}):(\d{2})([:;.,])(\d{2,3})", str(tc).strip())
    if not m:
        raise TimecodeError(f"timecode inválido: {tc!r} (HH:MM:SS:FF ou HH:MM:SS;FF)")
    hh, mm, ss, sep, ff = int(m[1]), int(m[2]), int(m[3]), m[4], int(m[5])
    n = nominal(fps); d = df_drop(fps, drop_frame)
    if (sep == ";") != bool(d):
        raise TimecodeError(f"separador {sep!r} incompatível com drop_frame={bool(drop_frame)}")
    if mm > 59 or ss > 59 or ff >= n:
        raise TimecodeError(f"timecode fora do intervalo para {n} fps nominais: {tc}")
    if d and ss == 0 and ff < d and mm % 10 != 0:
        raise TimecodeError(f"timecode DF inexistente (números pulados): {tc}")
    total_min = hh * 60 + mm
    return ((hh * 3600 + mm * 60 + ss) * n + ff) - d * (total_min - total_min // 10)


def frames_to_seconds(frame, fps):
    return float(Fraction(frame) / fps)


def seconds_to_frames(seconds, fps):
    """Arredonda para o frame MAIS PRÓXIMO (o tempo real nunca é inventado)."""
    return int((Fraction(str(seconds)) * fps).limit_denominator(10**9) + Fraction(1, 2))
