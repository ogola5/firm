"""Search across what we have learnt: cases, procedures, expert notes and older work instructions.

PostgreSQL: full-text search (stemming: "tripped" finds "trip"), ranked, with highlighted snippets,
plus pg_trgm word similarity for typos and shorthand. A small KPC vocabulary expands common
shorthand ("vfd" also searches "drive"; "hot" also searches "overtemperature").
SQLite (tests, local): the same sources and vocabulary, matched with plain substring checks.

Ranking: how many of the searched words (or their synonyms) a record contains, then text rank,
then similarity. A record must contain at least half the searched words, or be very similar to
the whole search (a typo), to be listed: one shared word is not a match.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from sqlalchemy import text
from sqlalchemy.orm import Session

# Shorthand and synonyms live in services/vocabulary.py (shared with similar faults and the offline copy).
from app.services.vocabulary import STOPWORDS, SYNONYMS  # noqa: E402
SIMILAR_ENOUGH = 0.6


@dataclass
class Hit:
    kind: str
    id: str
    score: tuple
    snippet: str


def terms(query: str) -> list[list[str]]:
    """Each searched word with its synonyms: [["vfd", "drive", "inverter"], ["hot", ...]]."""
    words = [word for word in re.findall(r"[a-z0-9]+", query.lower()) if word not in STOPWORDS and (len(word) > 1 or word.isdigit())]
    groups, seen = [], set()
    for word in words:
        if word in seen:
            continue
        seen.add(word)
        groups.append([word, *[item for item in SYNONYMS.get(word, []) if item != word]])
    return groups[:8]


def needed(groups: list[list[str]]) -> int:
    return max(1, math.ceil(len(groups) / 2))


def _agg(dialect: str, expression: str) -> str:
    return f"string_agg({expression}, ' ')" if dialect == "postgresql" else f"group_concat({expression}, ' ')"


def sources(dialect: str) -> dict[str, str]:
    """kind -> SQL returning (id, doc). Same shape on both databases."""
    c = lambda column: f"coalesce({column}, '')"  # noqa: E731
    return {
        "case": f"""
            SELECT f.id AS id,
                   {c('f.reference')} || ' ' || {c('e.tag')} || ' ' || {c('e.name')} || ' ' || {c('f.symptom')} || ' ' ||
                   {c('f.description')} || ' ' || {c('f.reported_equipment_text')} || ' ' || {c('d.txt')} || ' ' || {c('i.txt')} AS doc
            FROM faults f
            LEFT JOIN equipment e ON e.id = f.equipment_id
            LEFT JOIN (SELECT fault_id, {_agg(dialect, c('possible_cause') + " || ' ' || " + c('quick_check'))} AS txt
                       FROM diagnoses GROUP BY fault_id) d ON d.fault_id = f.id
            LEFT JOIN (SELECT fault_id, {_agg(dialect, c('corrective_action') + " || ' ' || " + c('notes'))} AS txt
                       FROM interventions GROUP BY fault_id) i ON i.fault_id = f.id""",
        "procedure": f"""
            SELECT id, {c('title')} || ' ' || {c('observed_symptom')} || ' ' || {c('confirmed_cause')} || ' ' ||
                   {c('diagnostic_procedure')} || ' ' || {c('corrective_action')} || ' ' || {c('safety')} AS doc
            FROM procedure_updates WHERE status = 'APPROVED'""",
        "expert": f"""
            SELECT id, {c('title')} || ' ' || {c('equipment_type')} || ' ' || {c('how_it_fails')} || ' ' || {c('first_checks')} || ' ' ||
                   {c('what_fools_people')} || ' ' || {c('tricks')} || ' ' || {c('safety')} AS doc
            FROM expert_sessions WHERE status = 'APPROVED'""",
        "instruction": f"""
            SELECT id, {c('title')} || ' ' || {c('symptom')} || ' ' || {c('confirmed_cause')} || ' ' ||
                   {c('diagnostic_procedure')} || ' ' || {c('corrective_action')} AS doc
            FROM knowledge_entries WHERE status = 'APPROVED'""",
    }


def has_trigram(db: Session) -> bool:
    if db.get_bind().dialect.name != "postgresql":
        return False
    url = str(db.get_bind().url)
    cached = _trigram_cache.get(url)
    if cached is None:
        cached = bool(db.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")).first())
        _trigram_cache[url] = cached
    return cached


_trigram_cache: dict[str, bool] = {}


def _postgres(db: Session, kind: str, inner: str, query: str, groups: list[list[str]], limit: int) -> list[Hit]:
    params: dict = {"q": query, "need": needed(groups), "similar": SIMILAR_ENOUGH, "limit": limit}
    coverage = []
    for index, group in enumerate(groups):
        params[f"g{index}"] = " | ".join(group)
        coverage.append(f"(CASE WHEN vec @@ to_tsquery('english', :g{index}) THEN 1 ELSE 0 END)")
    params["all"] = " | ".join(" | ".join(group) for group in groups)
    similarity = "word_similarity(:q, doc)" if has_trigram(db) else "0"
    sql = f"""
        WITH s AS ({inner}),
             v AS (SELECT id, doc, to_tsvector('english', doc) AS vec FROM s),
             r AS (SELECT id, doc, vec, ({' + '.join(coverage)}) AS cov,
                          ts_rank_cd(vec, to_tsquery('english', :all)) AS rank, {similarity} AS sim FROM v)
        SELECT id, cov, rank, sim,
               ts_headline('english', doc, to_tsquery('english', :all),
                           'StartSel=[[, StopSel=]], MaxWords=28, MinWords=10, ShortWord=2, MaxFragments=1') AS snippet
        FROM r WHERE cov >= :need OR sim >= :similar
        ORDER BY cov DESC, rank DESC, sim DESC LIMIT :limit"""
    return [Hit(kind, row.id, (int(row.cov), float(row.rank), float(row.sim)), row.snippet or "")
            for row in db.execute(text(sql), params)]


def _plain(db: Session, kind: str, inner: str, groups: list[list[str]], limit: int) -> list[Hit]:
    hits = []
    for row in db.execute(text(inner)):
        doc = (row.doc or "").lower()
        words = set(re.findall(r"[a-z0-9]+", doc))
        cov = sum(any(word in words or (len(word) > 3 and word in doc) for word in group) for group in groups)
        if cov >= needed(groups):
            first = min((doc.find(word) for group in groups for word in group if doc.find(word) >= 0), default=0)
            start = max(0, first - 60)
            hits.append(Hit(kind, row.id, (cov, 0.0, 0.0), ("…" if start else "") + (row.doc or "")[start:start + 200]))
    return sorted(hits, key=lambda hit: hit.score, reverse=True)[:limit]


def search(db: Session, query: str, kinds: tuple[str, ...] = ("case", "procedure", "expert", "instruction"),
           limit: int = 25) -> list[Hit]:
    groups = terms(query)
    if not groups:
        return []
    dialect = db.get_bind().dialect.name
    hits: list[Hit] = []
    for kind, inner in sources(dialect).items():
        if kind not in kinds:
            continue
        if dialect == "postgresql":
            hits.extend(_postgres(db, kind, inner, query, groups, limit))
        else:
            hits.extend(_plain(db, kind, inner, groups, limit))
    return sorted(hits, key=lambda hit: hit.score, reverse=True)[:limit]


def ranked_fault_ids(db: Session, query: str, limit: int = 200) -> list[str]:
    """Faults matching the search, best first (history search). Exact references and tags always match."""
    return [hit.id for hit in search(db, query, ("case",), limit)]
