"""Equipment matching: the pump itself before its panel or drive, and pump A told from pump B."""
from app.models import Equipment
from app.services.equipment_search import rank_equipment


def item(tag: str, name: str, aliases: str) -> Equipment:
    return Equipment(id=tag, tag=tag, name=name, aliases=aliases, location="Line 4", station="PS04", section="x", category="x", criticality="x")


REGISTRY = [
    item("11-P-401", "Line 4 main pump A (pump 401)", "line 4 pump a line4 pump a pump 401 main pump line 4 p401"),
    item("11-P-402", "Line 4 main pump B (pump 402)", "line 4 pump b line4 pump b pump 402 main pump line 4 p402"),
    item("11-LOP-401", "Line 4 pump A lube oil pumps panel", "lop panel line 4 lube oil pumps lop pump 401 panel 4"),
    item("11-VFD-401", "Line 4 pump A variable speed drive", "line 4 pump a vfd drive panel 4 p401 vfd"),
]


def first(query: str) -> str:
    return rank_equipment(REGISTRY, query)[0].tag


def test_the_pump_itself_ranks_before_its_panel_and_drive():
    assert first("line 4 pump a") == "11-P-401"
    assert first("pump 401") == "11-P-401"


def test_a_unit_letter_is_not_dropped():
    assert first("line 4 pump b") == "11-P-402"


def test_asking_for_the_panel_or_drive_still_finds_them():
    assert first("line 4 pump a lop panel") == "11-LOP-401"
    assert first("pump a vfd") == "11-VFD-401"
