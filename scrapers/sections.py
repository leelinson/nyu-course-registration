"""Load one term's class sections from NYU Class Search into Postgres.

Usage:
    DATABASE_URL=postgres://... python3 scrapers/sections.py --term 1274

Class Search (https://bulletins.nyu.edu/class-search/) is a CourseLeaf page
backed by a public JSON API. One search call returns every section in a term
with its meeting times; a details call per course adds the component,
instructional method, and description. We only fetch details for the subjects
the pilot programs use, to keep the request count small.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import time as clock

API = "https://bulletins.nyu.edu/class-search/api/?page=fose&route="
USER_AGENT = "nyu-course-planner (https://github.com/leelinson/nyu-course-registration)"
DAYS = "MTWRFSU"  # meet_day 0 is Monday
COMPONENTS = {
    "LEC": "Lecture", "RCT": "Recitation", "LAB": "Laboratory", "SEM": "Seminar",
    "IND": "Independent Study", "CLI": "Clinic", "STU": "Studio", "WKS": "Workshop",
}
# Subjects the pilot programs' requirements draw from.
PILOT_SUBJECTS = [
    "ECON-UA", "CSCI-UA", "MATH-UA", "CORE-UA", "EXPOS-UA",
    "FMTV-UT", "ASPP-UT",
    "ACCT-UB", "ECON-UB", "FINC-UB", "MGMT-UB", "MKTG-UB", "MULT-UB",
    "OPMG-UB", "SOIM-UB", "STAT-UB", "TECH-UB",
]


def post(route, payload, retries=3):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        API + route, data=body,
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except OSError:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)


def search(srcdb, subject=None):
    criteria = [{"field": "subject", "value": subject}] if subject else []
    return post("search", {"other": {"srcdb": srcdb}, "criteria": criteria})["results"]


def details(srcdb, code, crn):
    return post("details", {
        "group": f"code:{code}", "key": f"crn:{crn}",
        "srcdb": srcdb, "matched": f"crn:{crn}",
    })


def split_code(code):
    subject, number = code.split(" ", 1)
    return subject, number


def parse_hhmm(value):
    value = int(value)
    return clock(value // 100, value % 100)


def parse_meetings(raw):
    """Turn Class Search meetingTimes into rows of (days, start, end).

    Days that share a start and end time collapse into one row, e.g. "MW".
    """
    if not raw:
        return []
    slots = json.loads(raw) if isinstance(raw, str) else raw
    by_time = defaultdict(set)
    for slot in slots:
        day = int(slot["meet_day"])
        if not 0 <= day < len(DAYS):
            continue
        key = (parse_hhmm(slot["start_time"]), parse_hhmm(slot["end_time"]))
        by_time[key].add(day)
    return [
        ("".join(DAYS[d] for d in sorted(days)), start, end)
        for (start, end), days in sorted(by_time.items(), key=lambda kv: (min(kv[1]), kv[0]))
    ]


def parse_instructors(raw):
    """Instructor names come as one string, separated by commas or semicolons."""
    if not raw:
        return []
    names = [n.strip() for n in re.split(r"[;,]", raw)]
    return [n for n in names if n and n.lower() not in {"staff", "tba"}]


def normalize_name(name):
    """Lowercase, drop punctuation and single-letter middle initials."""
    parts = re.sub(r"[^\w\s-]", " ", name.lower()).split()
    if len(parts) > 2:
        parts = [parts[0]] + [p for p in parts[1:-1] if len(p) > 1] + [parts[-1]]
    return " ".join(parts)


def section_row(result):
    subject, number = split_code(result["code"])
    status = "Cancelled" if result.get("isCancelled") else ("Active" if result.get("stat") == "A" else result.get("stat"))
    return {
        "subject": subject,
        "number": number,
        "title": result["title"],
        "section_code": result["no"],
        "class_number": result["crn"],
        "component": COMPONENTS.get(result.get("schd"), result.get("schd")),
        "status": status,
        "meetings": parse_meetings(result.get("meetingTimes")),
        "instructors": parse_instructors(result.get("instr")),
        "start_date": result.get("start_date") or None,
    }


def save(conn, srcdb, term_name, rows, course_details):
    with conn.cursor() as cur:
        start_dates = sorted(r["start_date"] for r in rows if r["start_date"])
        cur.execute(
            "insert into terms (code, name, start_date) values (%s, %s, %s) "
            "on conflict (code) do update set start_date = coalesce(excluded.start_date, terms.start_date) "
            "returning id",
            (srcdb, term_name or srcdb, start_dates[0] if start_dates else None),
        )
        term_id = cur.fetchone()[0]
        cur.execute("select now()")
        run_started = cur.fetchone()[0]

        course_ids = {}
        for r in rows:
            key = (r["subject"], r["number"])
            if key in course_ids:
                continue
            info = course_details.get(f"{r['subject']} {r['number']}", {})
            # Keep a curated title once one exists; fill in the description.
            cur.execute(
                "insert into courses (subject, number, title, description) values (%s, %s, %s, %s) "
                "on conflict (subject, number) do update set "
                "description = coalesce(excluded.description, courses.description), "
                "title = case when courses.title = courses.subject || ' ' || courses.number "
                "then excluded.title else courses.title end "
                "returning id",
                (r["subject"], r["number"], r["title"], info.get("description") or None),
            )
            course_ids[key] = cur.fetchone()[0]

        for r in rows:
            course_id = course_ids[(r["subject"], r["number"])]
            info = course_details.get(f"{r['subject']} {r['number']}", {}).get("sections", {}).get(r["class_number"], {})
            cur.execute(
                "insert into sections (course_id, term_id, section_code, class_number, component, mode, status, updated_at) "
                "values (%s, %s, %s, %s, %s, %s, %s, now()) "
                "on conflict (term_id, course_id, section_code) do update set "
                "class_number = excluded.class_number, component = excluded.component, "
                "mode = coalesce(excluded.mode, sections.mode), status = excluded.status, updated_at = now() "
                "returning id",
                (course_id, term_id, r["section_code"], r["class_number"],
                 info.get("component") or r["component"], info.get("mode"), r["status"]),
            )
            section_id = cur.fetchone()[0]

            cur.execute("delete from meetings where section_id = %s", (section_id,))
            for days, start, end in r["meetings"]:
                cur.execute(
                    "insert into meetings (section_id, days, start_time, end_time, location) values (%s, %s, %s, %s, %s)",
                    (section_id, days, start, end, info.get("location")),
                )

            cur.execute("delete from section_instructors where section_id = %s", (section_id,))
            for name in r["instructors"]:
                cur.execute(
                    "insert into instructors (name, normalized_name) values (%s, %s) "
                    "on conflict (normalized_name) do update set name = excluded.name returning id",
                    (name, normalize_name(name)),
                )
                cur.execute(
                    "insert into section_instructors (section_id, instructor_id) values (%s, %s) on conflict do nothing",
                    (section_id, cur.fetchone()[0]),
                )

        # Sections that vanished from Class Search since the last run were dropped.
        cur.execute(
            "delete from sections where term_id = %s and updated_at < %s",
            (term_id, run_started),
        )
        removed = cur.rowcount
    conn.commit()
    return len(course_ids), removed


def fetch_details(srcdb, results, subjects, delay):
    """One details call per section in the given subjects."""
    wanted = [r for r in results if r["code"].split(" ", 1)[0] in subjects]
    out = {}
    for i, r in enumerate(wanted):
        d = details(srcdb, r["code"], r["crn"])
        course = out.setdefault(r["code"], {"description": d.get("description"), "sections": {}})
        course["sections"][r["crn"]] = {
            "component": d.get("component") or None,
            "mode": d.get("instructional_method") or None,
            "location": d.get("campus_location") or None,
        }
        if (i + 1) % 200 == 0:
            print(f"  details {i + 1}/{len(wanted)}", flush=True)
        time.sleep(delay)
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--term", required=True, help="NYU term code, e.g. 1274 for Spring 2027")
    parser.add_argument("--term-name", help="e.g. 'Spring 2027' (used if the term is new)")
    parser.add_argument("--subjects", help="comma-separated subjects to load (default: every subject)")
    parser.add_argument("--details", choices=["pilot", "none"], default="pilot",
                        help="fetch per-section details for pilot subjects, or skip them")
    parser.add_argument("--delay", type=float, default=0.2, help="seconds between details calls")
    args = parser.parse_args(argv)

    import psycopg

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        sys.exit("DATABASE_URL is not set")

    if args.subjects:
        subjects = [s.strip().upper() for s in args.subjects.split(",") if s.strip()]
        results = [r for s in subjects for r in search(args.term, s)]
    else:
        results = search(args.term)
    print(f"Class Search returned {len(results)} sections for term {args.term}")

    detail_subjects = set(PILOT_SUBJECTS) if args.details == "pilot" else set()
    course_details = fetch_details(args.term, results, detail_subjects, args.delay)
    print(f"Fetched details for {sum(len(c['sections']) for c in course_details.values())} sections")

    rows = [section_row(r) for r in results if " " in r.get("code", "")]
    with psycopg.connect(database_url) as conn:
        courses, removed = save(conn, args.term, args.term_name, rows, course_details)
    print(f"Saved {len(rows)} sections across {courses} courses; removed {removed} stale sections")


if __name__ == "__main__":
    main()
