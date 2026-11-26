/**
 * Similar earlier faults, computed on the phone from the offline case index when there is no
 * connection. Same rules as the server (backend/app/services/analytics/similarity.py and
 * services/vocabulary.py): the weights and the vocabulary come from the server with the index.
 */
export type Vocabulary = { synonyms: Record<string, string[]>; stopwords: string[]; suffixes: string[] };
export type Case = {
  id: string; reference: string; equipment_id: string | null; equipment_tag: string; equipment_name: string;
  equipment_type: string; system_id: string | null; system_name: string; category: string; symptom: string;
  description: string; reported_at: string; causes: string[]; worked: string[]; did_not_work: string[];
};
export type CaseIndex = {
  generated_at: string; weights: [number, number, number, number]; min_score: number; half_life_days: number;
  related_equipment: number; same_type: number; type_aliases: Record<string, string>; vocabulary: Vocabulary; cases: Case[];
};
export type SimilarResult = {
  fault_id: string; reference: string; equipment_tag: string; equipment_name: string; reported_at: string; symptom: string;
  causes: string[]; worked: string[]; did_not_work: string[]; score: number; reasons: string[];
};

export function stem(word: string, suffixes: string[]): string {
  for (const suffix of suffixes) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      let base = word.slice(0, -suffix.length);
      // valves -> valve (drop only the s), boxes -> box: same rule as the server.
      if (suffix === "es" && !/(s|x|ch|sh|z)$/.test(base)) continue;
      if ((suffix === "ing" || suffix === "ed") && base.length >= 4 && base[base.length - 1] === base[base.length - 2]) base = base.slice(0, -1);
      return base;
    }
  }
  return word;
}

export function words(text: string, vocabulary: Vocabulary): string[] {
  const stop = new Set(vocabulary.stopwords);
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => !stop.has(word) && (word.length > 1 || /^\d+$/.test(word)));
}

function expanded(word: string, vocabulary: Vocabulary): Set<string> {
  return new Set([stem(word, vocabulary.suffixes), ...(vocabulary.synonyms[word] ?? []).map((item) => stem(item, vocabulary.suffixes))]);
}

/** How much two descriptions are about the same thing, 0..1 (shorthand and word forms count). */
export function overlap(left: string, right: string, vocabulary: Vocabulary): number {
  const a = [...new Set(words(left, vocabulary))];
  const b = [...new Set(words(right, vocabulary))];
  if (!a.length || !b.length) return 0;
  const aConcepts = new Set(a.flatMap((word) => [...expanded(word, vocabulary)]));
  const bConcepts = new Set(b.flatMap((word) => [...expanded(word, vocabulary)]));
  const hits = (list: string[], other: Set<string>) => list.filter((word) => [...expanded(word, vocabulary)].some((item) => other.has(item))).length;
  return (hits(a, bConcepts) + hits(b, aConcepts)) / (a.length + b.length);
}

export function score(target: Case, candidate: Case, index: CaseIndex, now = new Date()): { value: number; reasons: string[] } {
  const [wEquipment, wSymptom, wCategory, wRelevance] = index.weights;
  const kind = (code: string) => index.type_aliases[code] ?? code;
  const reasons: string[] = [];
  let equipment = 0;
  if (target.equipment_id && candidate.equipment_id === target.equipment_id) {
    equipment = 1;
    reasons.push("Same equipment");
  } else {
    if (target.system_id && candidate.system_id === target.system_id) {
      equipment = index.related_equipment;
      reasons.push(`Related equipment (${candidate.equipment_tag}, same ${candidate.system_name || "system"})`);
    }
    if (target.equipment_type && kind(candidate.equipment_type) === kind(target.equipment_type)) {
      equipment = Math.max(equipment, index.same_type);
      reasons.push(`Same type of equipment (${kind(candidate.equipment_type)})`);
    }
  }
  let symptom = overlap(`${target.symptom} ${target.description}`, `${candidate.symptom} ${candidate.description}`, index.vocabulary);
  if (symptom >= 0.6) reasons.push("Same problem described");
  else if (symptom >= 0.3) reasons.push("Similar problem description");
  else symptom = 0;
  const category = target.category && candidate.category === target.category ? 1 : 0;
  if (category) reasons.push(`Same fault category (${candidate.category})`);
  const fixed = candidate.worked.length > 0;
  const ageDays = Math.max(0, (now.getTime() - new Date(candidate.reported_at).getTime()) / 86_400_000);
  const recency = Math.exp((-Math.LN2 * ageDays) / index.half_life_days);
  const relevance = (fixed ? 0.6 : 0) + 0.4 * recency;
  if (fixed) reasons.push("A fix that worked is recorded");
  const value = wEquipment * equipment + wSymptom * symptom + wCategory * category + wRelevance * relevance;
  return { value: Math.round(value * 1000) / 1000, reasons };
}

export function similarFaults(target: Case, index: CaseIndex, limit = 5, now = new Date()): SimilarResult[] {
  const reported = new Date(target.reported_at).getTime();
  return index.cases
    .filter((candidate) => candidate.id !== target.id && new Date(candidate.reported_at).getTime() < reported)
    .map((candidate) => ({ candidate, ...score(target, candidate, index, now) }))
    .filter((row) => row.value >= index.min_score)
    .sort((left, right) => right.value - left.value || new Date(right.candidate.reported_at).getTime() - new Date(left.candidate.reported_at).getTime())
    .slice(0, limit)
    .map(({ candidate, value, reasons }) => ({
      fault_id: candidate.id, reference: candidate.reference, equipment_tag: candidate.equipment_tag, equipment_name: candidate.equipment_name,
      reported_at: candidate.reported_at, symptom: candidate.symptom, causes: candidate.causes, worked: candidate.worked,
      did_not_work: candidate.did_not_work, score: value, reasons,
    }));
}
