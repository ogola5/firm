/**
 * Equipment matching for how people describe assets ("tank 601 inlet valve",
 * "T601 inlet", "mov 501", "11-MOV-501"). Mirrors backend/app/services/
 * equipment_search.py so offline search on the device behaves like the server.
 */
/** Any record with (some of) tag, name, aliases, location, station. */
type Matchable = Record<string, unknown>;

const STOP_WORDS = new Set(["the", "a", "an", "at", "on", "near", "of", "is", "not", "to", "by", "in", "and"]);
const SYNONYMS: Record<string, string[]> = {
  tank: ["tk", "t"],
  valve: ["mov", "v"],
  mov: ["valve"],
  pump: ["p"],
  transmitter: ["tx"],
  level: ["lt"],
};

function words(text: string): string[] {
  return text.toLowerCase().replace(/([a-z])(\d)/g, "$1 $2").split(/[^a-z0-9]+/).filter(Boolean);
}

const compact = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

// A single letter after these words names a unit ("pump A", "line B"), so it is kept, not dropped as "a".
const UNIT_NOUNS = new Set(["pump", "line", "unit", "train", "motor", "fan", "compressor", "tank", "filter", "skid", "panel"]);

function terms(query: string): string[] {
  const all = words(query);
  return all.filter((word, index) => {
    const unitLetter = word.length === 1 && /[a-z]/.test(word) && index > 0 && UNIT_NOUNS.has(all[index - 1]);
    return unitLetter || !STOP_WORDS.has(word);
  });
}

/** Words in the name the query did not ask for: fewer means a closer match (the pump, not the pump's panel). */
export function extraNameWords(item: Matchable, query: string): number {
  const asked = new Set(terms(query).flatMap((term) => [term, ...(SYNONYMS[term] ?? [])]));
  return words(String(item.name ?? "")).filter((word) => !asked.has(word) && !STOP_WORDS.has(word)).length;
}

export function matchScore(item: Matchable, query: string): number {
  if (compact(String(item.tag ?? "")) === compact(query) && compact(query)) return 1000;
  const queryTerms = terms(query);
  if (!queryTerms.length) return 0;
  const haystack = new Set(words([item.tag, item.name, item.aliases, item.location, item.station].map((v) => String(v ?? "")).join(" ")));
  let score = 0;
  for (const term of queryTerms) {
    const candidates = [term, ...(SYNONYMS[term] ?? [])];
    if (candidates.some((candidate) => haystack.has(candidate))) score += /^\d+$/.test(term) ? 5 : 2;
    else if (term.length > 2 && [...haystack].some((word) => word.startsWith(term))) score += 1;
  }
  return score;
}

export function rankEquipment<T extends Matchable>(items: T[], query: string): T[] {
  return items
    .map((item) => ({ item, score: matchScore(item, query) }))
    .filter((entry) => entry.score > 0)
    // Equal scores: the record whose name adds the fewest words beyond the query, then by tag.
    .sort((left, right) => right.score - left.score
      || extraNameWords(left.item, query) - extraNameWords(right.item, query)
      || String(left.item.tag).localeCompare(String(right.item.tag)))
    .map((entry) => entry.item);
}
