"""Tests for scrapers/sections.py.

Parsing tests run anywhere. The save test needs a Postgres with the schema
applied; it reads TEST_DATABASE_URL and is skipped without it.
"""

import os
import sys
from datetime import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scrapers"))
import sections  # noqa: E402

# Shaped like real Class Search results for term 1274 (Spring 2027).
RESULTS = [
    {"key": "4773", "code": "ECON-UA 1", "title": "Introduction to Macroeconomics", "crn": "5973",
     "no": "001", "schd": "LEC", "stat": "A", "isCancelled": "",
     "meetingTimes": '[{"meet_day":"0","start_time":"930","end_time":"1045"},'
                     '{"meet_day":"2","start_time":"930","end_time":"1045"}]',
     "instr": "", "start_date": "2027-01-19"},
    {"key": "4774", "code": "ECON-UA 1", "title": "Introduction to Macroeconomics", "crn": "5974",
     "no": "002", "schd": "RCT", "stat": "A", "isCancelled": "",
     "meetingTimes": '[{"meet_day":"4","start_time":"800","end_time":"915"}]',
     "instr": "Jane Q. Doe", "start_date": "2027-01-19"},
    {"key": "13816", "code": "FINC-UB 17", "title": "Restructuring and Distressed Investing", "crn": "2177",
     "no": "001", "schd": "LEC", "stat": "A", "isCancelled": "",
     "meetingTimes": '[{"meet_day":"1","start_time":"1400","end_time":"1515"},'
                     '{"meet_day":"3","start_time":"1400","end_time":"1515"}]',
     "instr": "", "start_date": "2027-01-19"},
]


def test_parse_meetings_groups_days_with_the_same_time():
    raw = RESULTS[0]["meetingTimes"]
    assert sections.parse_meetings(raw) == [("MW", time(9, 30), time(10, 45))]


def test_parse_meetings_keeps_different_times_apart():
    raw = ('[{"meet_day":"1","start_time":"1400","end_time":"1515"},'
           '{"meet_day":"3","start_time":"1600","end_time":"1715"}]')
    assert sections.parse_meetings(raw) == [
        ("T", time(14, 0), time(15, 15)),
        ("R", time(16, 0), time(17, 15)),
    ]


def test_parse_meetings_handles_missing_times():
    assert sections.parse_meetings("") == []
    assert sections.parse_meetings(None) == []


def test_instructor_names():
    assert sections.parse_instructors("Jane Q. Doe; Sam Lee") == ["Jane Q. Doe", "Sam Lee"]
    assert sections.parse_instructors("Staff") == []
    assert sections.normalize_name("Jane Q. Doe") == "jane doe"
    assert sections.normalize_name("O'Neil, Pat") == "o neil pat"


def test_section_row():
    row = sections.section_row(RESULTS[1])
    assert row["subject"] == "ECON-UA" and row["number"] == "1"
    assert row["component"] == "Recitation"
    assert row["status"] == "Active"
    assert row["instructors"] == ["Jane Q. Doe"]


@pytest.fixture
def conn():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set")
    psycopg = pytest.importorskip("psycopg")
    with psycopg.connect(url) as c:
        yield c
        with c.cursor() as cur:
            cur.execute("delete from sections where term_id in (select id from terms where code = '9001')")
            cur.execute("delete from terms where code = '9001'")
        c.commit()


def test_save_is_idempotent_and_drops_vanished_sections(conn):
    rows = [sections.section_row(r) for r in RESULTS]
    details = {"ECON-UA 1": {"description": "Macro.", "sections": {"5973": {"mode": "In-Person"}}}}

    courses, removed = sections.save(conn, "9001", "Test term", rows, details)
    assert (courses, removed) == (2, 0)
    courses, removed = sections.save(conn, "9001", "Test term", rows, details)
    assert removed == 0

    with conn.cursor() as cur:
        cur.execute("""
            select c.subject || ' ' || c.number, s.section_code, s.mode, m.days, m.start_time
            from sections s join courses c on c.id = s.course_id
            join terms t on t.id = s.term_id left join meetings m on m.section_id = s.id
            where t.code = '9001' order by 1, 2""")
        assert cur.fetchall() == [
            ("ECON-UA 1", "001", "In-Person", "MW", time(9, 30)),
            ("ECON-UA 1", "002", None, "F", time(8, 0)),
            ("FINC-UB 17", "001", None, "TR", time(14, 0)),
        ]
        cur.execute("select name from instructors where normalized_name = 'jane doe'")
        assert cur.fetchone() == ("Jane Q. Doe",)

    # A section missing from the next run is removed.
    courses, removed = sections.save(conn, "9001", "Test term", rows[:2], details)
    assert removed == 1
