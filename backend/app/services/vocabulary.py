"""KPC maintenance vocabulary: one place for shorthand, synonyms and word forms.

Used by library search (services/text_search.py), the similar-fault engine
(services/analytics/similarity.py) and, through the offline case index, the same
matching on the phone when there is no connection.
"""
from __future__ import annotations

import re

# Shorthand and plain words people use, both ways where it makes sense. Lower case.
SYNONYMS: dict[str, list[str]] = {
    "vfd": ["drive", "inverter"], "drive": ["vfd", "inverter"], "inverter": ["vfd", "drive"],
    "mov": ["valve", "actuator"], "valve": ["mov", "actuator"], "actuator": ["mov", "valve"],
    "hot": ["overtemperature", "temperature", "heat"], "heat": ["hot", "overtemperature", "temperature"],
    "overheat": ["overtemperature", "hot", "temperature"], "overtemp": ["overtemperature", "temperature"],
    "overtemperature": ["hot", "overheat", "temperature"],
    "trip": ["tripped", "overload"], "trips": ["trip", "tripped"], "tripped": ["trip", "overload"],
    "comms": ["communication", "telemetry"], "communication": ["comms", "telemetry"], "offline": ["communication", "lost"],
    "lt": ["level"], "level": ["lt"], "pt": ["pressure"], "pressure": ["pt"], "tt": ["temperature"], "ft": ["flow", "meter"],
    "pmp": ["pump"], "pump": ["p"], "leak": ["leaking", "drip", "weep"], "drip": ["leak"], "dripping": ["leak"],
    "stuck": ["sticking", "jammed"], "noise": ["noisy", "vibration", "knocking"], "vibration": ["noise"],
    "rtu": ["telemetry", "station"], "scada": ["hmi", "workstation"], "hmi": ["scada", "workstation"],
    "strainer": ["filter", "basket"], "filter": ["strainer"], "blocked": ["blockage", "clogged", "sediment"],
    "latch": ["latched", "reset"], "latched": ["latch", "reset"], "seal": ["gasket", "leak"],
    "alignment": ["misalignment", "aligned"], "misaligned": ["misalignment", "alignment"],
    "start": ["starting", "started"], "alarm": ["alarms"], "reading": ["value", "signal"],
}
STOPWORDS = {"the", "a", "an", "and", "or", "of", "on", "in", "at", "to", "is", "it", "was", "not", "no", "with", "for",
             "from", "by", "be", "this", "that", "there", "then", "but", "after", "before", "when", "we", "i"}
_SUFFIXES = ("ing", "ed", "es", "s")


def stem(word: str) -> str:
    """Light English stemming, enough for 'tripped' ~ 'trip', 'leaking' ~ 'leak', 'valves' ~ 'valve'."""
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            base = word[: -len(suffix)]
            if suffix == "es" and not base.endswith(("s", "x", "ch", "sh", "z")):
                continue  # valves -> valve (drop only the s), boxes -> box
            if suffix in ("ing", "ed") and len(base) >= 4 and base[-1] == base[-2]:
                base = base[:-1]  # tripped -> tripp -> trip
            return base
    return word


def words(text: str) -> list[str]:
    return [word for word in re.findall(r"[a-z0-9]+", (text or "").lower())
            if word not in STOPWORDS and (len(word) > 1 or word.isdigit())]


def concepts(text: str) -> set[str]:
    """The stems of the words in a text (what the words are about, ignoring form)."""
    return {stem(word) for word in words(text)}


def expanded(word: str) -> set[str]:
    """A word's stem plus the stems of its synonyms."""
    return {stem(word), *(stem(item) for item in SYNONYMS.get(word, []))}


def overlap(left: str, right: str) -> float:
    """How much two descriptions are about the same thing, 0..1, counting shorthand and word forms.

    Each word on either side counts as matched if it, or one of its synonyms, appears on the other side.
    """
    left_words, right_words = set(words(left)), set(words(right))
    if not left_words or not right_words:
        return 0.0
    left_concepts = {item for word in left_words for item in expanded(word)}
    right_concepts = {item for word in right_words for item in expanded(word)}
    matched = sum(bool(expanded(word) & right_concepts) for word in left_words) + \
        sum(bool(expanded(word) & left_concepts) for word in right_words)
    return matched / (len(left_words) + len(right_words))


def export() -> dict:
    """For the offline case index: the phone applies exactly the same vocabulary."""
    return {"synonyms": SYNONYMS, "stopwords": sorted(STOPWORDS), "suffixes": list(_SUFFIXES)}
