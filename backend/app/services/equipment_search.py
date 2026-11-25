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


# A single letter after these words names a unit ("pump A", "line B"), so it is kept, not dropped as "a".
UNIT_NOUNS = {"pump", "line", "unit", "train", "motor", "fan", "compressor", "tank", "filter", "skid", "panel"}


def _terms(query: str) -> list[str]:
    words = _words(query)
    kept = []
    for index, word in enumerate(words):
        unit_letter = len(word) == 1 and word.isalpha() and index > 0 and words[index - 1] in UNIT_NOUNS
        if unit_letter or word not in STOP_WORDS:
            kept.append(word)
    return kept


def extra_name_words(item: Equipment, query: str) -> int:
    """Words in the name that the query did not ask for: fewer means a closer match (the pump, not the pump's panel)."""
    asked = set(_terms(query))
    for term in list(asked):
        asked |= SYNONYMS.get(term, set())
    return len([word for word in _words(item.name) if word not in asked and word not in STOP_WORDS])


def match_score(item: Equipment, query: str) -> int:
    """0 unless the record really matches: at least half of the words asked for, or a matching number.
    One shared word ("line", "pump") is not enough to call something a match."""
    if _compact(item.tag) == _compact(query):
        return 1000
    terms = _terms(query)
    if not terms:
        return 0
    words = set(_words(" ".join((item.tag, item.name, item.aliases or "", item.location, item.station))))
    score = matched = 0
    number_matched = False
    for term in terms:
        candidates = {term} | SYNONYMS.get(term, set())
        if candidates & words:
            score += 5 if term.isdigit() else 2
            matched += 1
            number_matched = number_matched or term.isdigit()
        elif len(term) > 2 and any(word.startswith(term) for word in words):
            score += 1
            matched += 1
    if not number_matched and matched * 2 < len(terms):
        return 0
    return score


def rank_equipment(items: list[Equipment], query: str) -> list[Equipment]:
    scored = [(match_score(item, query), item) for item in items]
    return [item for score, item in sorted(
        (entry for entry in scored if entry[0] > 0),
        # Equal scores: the record whose name adds the fewest words beyond the query, then by tag.
        key=lambda entry: (-entry[0], extra_name_words(entry[1], query), entry[1].tag),
    )]
