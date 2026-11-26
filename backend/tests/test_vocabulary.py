"""The shared vocabulary. The phone (frontend/src/lib/similarity.ts) has the same cases in its unit test."""
from app.services.vocabulary import overlap, stem


def test_word_forms_reduce_to_the_same_stem():
    assert [stem(word) for word in ("tripped", "leaking", "valves", "valve", "boxes", "switches")] == \
        ["trip", "leak", "valve", "valve", "box", "switch"]


def test_shorthand_counts_and_unrelated_text_does_not():
    assert overlap("VFD hot trip", "Drive tripped on overtemperature") >= 0.6
    assert overlap("VFD hot trip", "Tank level reading frozen") == 0.0
    assert overlap("valves stuck", "valve sticking") >= 0.6
