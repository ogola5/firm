"""Equipment matching for how people actually describe assets.

"11-MOV-501", "mov 501", "tank 601 inlet valve" and "T601 inlet" should all find
the right record. Tags, names and aliases are compared word by word; numbers
weigh most because they identify the tank or unit, and an exact tag wins.
"""
from __future__ import annotations

import re

from app.models import Equipment

STOP_WORDS = {"the", "a", "an", "at", "on", "near", "of", "is", "not", "to", "by", "in", "and"}
# Words people use interchangeably in descriptions.
SYNONYMS = {
    "tank": {"tk", "t"},
    "valve": {"mov", "v"},
    "mov": {"valve"},
    "pump": {"p"},
    "transmitter": {"tx"},
    "level": {"lt"},
}


def _words(text: str) -> list[str]:
    # Split "t601" into "t" + "601" so it meets "tank 601".
    spaced = re.sub(r"([a-z])(\d)", r"\1 \2", text.lower())
    return [word for word in re.split(r"[^a-z0-9]+", spaced) if word]


def _compact(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def match_score(item: Equipment, query: str) -> int:
    if _compact(item.tag) == _compact(query):
        return 1000
    terms = [word for word in _words(query) if word not in STOP_WORDS]
    if not terms:
        return 0
    words = set(_words(" ".join((item.tag, item.name, item.aliases or "", item.location, item.station))))
    score = 0
    for term in terms:
        candidates = {term} | SYNONYMS.get(term, set())
        if candidates & words:
            score += 5 if term.isdigit() else 2
        elif len(term) > 2 and any(word.startswith(term) for word in words):
            score += 1
    return score


def rank_equipment(items: list[Equipment], query: str) -> list[Equipment]:
    scored = [(match_score(item, query), item) for item in items]
    return [item for score, item in sorted(
        (entry for entry in scored if entry[0] > 0),
        key=lambda entry: (-entry[0], entry[1].tag),
    )]
