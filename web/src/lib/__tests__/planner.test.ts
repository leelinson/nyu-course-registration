import { describe, expect, it } from "vitest";
import {
  likeToRegExp, normalizeCode, parseCourseList, plan, prereqMissing,
  type Offering, type RequirementGroup,
} from "../planner";

let nextId = 1;
const group = (g: Partial<RequirementGroup> & Pick<RequirementGroup, "label" | "rule">): RequirementGroup => ({
  id: nextId++, n: null, credits: null, note: null, members: [], children: [], ...g,
});
const course = (code: string) => ({ kind: "course" as const, code });
const pattern = (p: string) => ({ kind: "pattern" as const, pattern: p });
const offering = (code: string): Offering => ({
  code, title: code, credits: 4,
  sections: [{ sectionCode: "001", classNumber: "1", component: "Lecture", mode: "In-Person",
               status: "Active", meetings: [{ days: "MW", start: "09:30", end: "10:45" }], instructors: [] }],
});

// A slice of the Economics and Computer Science requirements.
const econCs = () => [
  group({ label: "Economics", rule: "all", children: [
    group({ label: "Intro", rule: "choose_n", n: 1, members: [course("ECON-UA 1"), course("ECON-UA 2")] }),
    group({ label: "Core", rule: "all", members: [course("ECON-UA 11"), course("ECON-UA 13")] }),
    group({ label: "Theory electives", rule: "choose_n", n: 2, members: [pattern("ECON-UA 3__")] }),
  ] }),
  group({ label: "CS electives", rule: "choose_n", n: 4,
          members: [pattern("CSCI-UA 4__"), course("MATH-UA 140"), course("ECON-UA 310")] }),
  group({ label: "Other electives", rule: "credits_min", credits: 8, members: [pattern("%")] }),
];

describe("course codes", () => {
  it("normalizes spacing and case", () => {
    expect(normalizeCode(" econ-ua  1 ")).toBe("ECON-UA 1");
    expect(normalizeCode("CSCI-UA101")).toBe("CSCI-UA 101");
    expect(normalizeCode("not a course")).toBeNull();
  });

  it("parses a pasted list and reports what it could not read", () => {
    expect(parseCourseList("ECON-UA 1, csci-ua 101\nECON-UA 1;\nAP Calc")).toEqual({
      codes: ["ECON-UA 1", "CSCI-UA 101"], invalid: ["AP Calc"],
    });
  });

  it("turns LIKE patterns into exact regular expressions", () => {
    expect(likeToRegExp("CSCI-UA 4__").test("CSCI-UA 473")).toBe(true);
    expect(likeToRegExp("CSCI-UA 4__").test("CSCI-UA 4")).toBe(false);
    expect(likeToRegExp("CSCI-UA 4__").test("CSCI-UA 4730")).toBe(false);
    expect(likeToRegExp("FMTV-UT %").test("FMTV-UT 1040")).toBe(true);
  });
});

describe("plan", () => {
  it("marks requirements met by completed courses", () => {
    const result = plan({
      groups: econCs(), credits: {}, offerings: [],
      completed: ["ECON-UA 2", "ECON-UA 11", "ECON-UA 13"],
    });
    const [econ] = result.groups;
    expect(econ.children.map((c) => [c.label, c.satisfied, c.remaining])).toEqual([
      ["Intro", true, ""],
      ["Core", true, ""],
      ["Theory electives", false, "2 more courses"],
    ]);
    expect(econ.satisfied).toBe(false);
    expect(econ.remaining).toBe("1 of 3 parts left");
  });

  it("lists named courses still missing from an all-of group", () => {
    const result = plan({ groups: econCs(), credits: {}, offerings: [], completed: ["ECON-UA 11"] });
    const core = result.groups[0].children[1];
    expect(core.missingCourses).toEqual(["ECON-UA 13"]);
    expect(core.remaining).toBe("Take ECON-UA 13");
  });

  it("counts a pattern course once, in the narrowest place it fits", () => {
    const result = plan({
      groups: econCs(), credits: { "ECON-UA 350": 4 }, offerings: [],
      completed: ["ECON-UA 350"],
    });
    expect(result.groups[0].children[2].applied).toEqual(["ECON-UA 350"]);
    expect(result.groups[2].applied).toEqual([]);
  });

  it("counts a named course everywhere it is named, then keeps it out of patterns", () => {
    const groups = [
      group({ label: "Functional core", rule: "choose_n", n: 5, members: [course("FINC-UB 2"), course("MKTG-UB 1")] }),
      group({ label: "Required finance", rule: "all", members: [course("FINC-UB 2"), course("FINC-UB 7")] }),
      group({ label: "Finance electives", rule: "choose_n", n: 3, members: [pattern("FINC-UB %")] }),
    ];
    const result = plan({ groups, credits: {}, offerings: [], completed: ["FINC-UB 2"] });
    expect(result.groups.map((g) => g.applied)).toEqual([["FINC-UB 2"], ["FINC-UB 2"], []]);
  });

  it("sends extra courses to catch-all electives and sums credits", () => {
    const result = plan({
      groups: econCs(), credits: { "HIST-UA 10": 4 }, offerings: [],
      completed: ["HIST-UA 10", "PHIL-UA 1"],
    });
    const electives = result.groups[2];
    expect(electives.applied).toEqual(["HIST-UA 10", "PHIL-UA 1"]);
    expect(electives.satisfied).toBe(true);
    expect(result.assumedCredits).toEqual(["PHIL-UA 1"]);
  });

  it("reports courses that count toward nothing", () => {
    const groups = [group({ label: "Core", rule: "all", members: [course("ECON-UA 11")] })];
    expect(plan({ groups, credits: {}, offerings: [], completed: ["ECON-UA 1"] }).unused).toEqual(["ECON-UA 1"]);
  });

  it("offers next term's courses that would count, skipping ones already taken", () => {
    const result = plan({
      groups: econCs(), credits: {}, completed: ["ECON-UA 1", "ECON-UA 11"],
      offerings: ["ECON-UA 1", "ECON-UA 2", "ECON-UA 11", "ECON-UA 13", "ECON-UA 310", "ECON-UA 20", "CSCI-UA 472"].map(offering),
    });
    const [econ, cs, other] = result.groups;
    expect(econ.children[0].eligible).toEqual([]); // intro done
    expect(econ.children[1].eligible.map((o) => o.code)).toEqual(["ECON-UA 13"]);
    expect(econ.children[2].eligible.map((o) => o.code)).toEqual(["ECON-UA 310"]);
    expect(cs.eligible.map((o) => o.code)).toEqual(["ECON-UA 310", "CSCI-UA 472"]);
    expect(other.anyCourse).toBe(true);
    expect(other.eligible).toEqual([]);
  });

  it("keeps required and fixed-list courses out of elective options", () => {
    const groups = [
      ...econCs(),
      group({ label: "Additional elective", rule: "choose_n", n: 1, members: [pattern("ECON-UA %")] }),
    ];
    const result = plan({
      groups, credits: {}, completed: ["ECON-UA 2"],
      offerings: ["ECON-UA 1", "ECON-UA 13", "ECON-UA 310", "ECON-UA 400"].map(offering),
    });
    expect(result.groups[3].eligible.map((o) => o.code)).toEqual(["ECON-UA 310", "ECON-UA 400"]);
  });

  it("holds back courses whose prerequisites are not met", () => {
    const groups = [group({ label: "CS core", rule: "all", members: [course("CSCI-UA 101"), course("CSCI-UA 102")] })];
    const offerings = ["CSCI-UA 101", "CSCI-UA 102"].map(offering);
    const prerequisites = { "CSCI-UA 102": { course: "CSCI-UA 101" } };

    const before = plan({ groups, credits: {}, offerings, prerequisites, completed: [] }).groups[0];
    expect(before.eligible.map((o) => o.code)).toEqual(["CSCI-UA 101"]);
    expect(before.blocked.map((b) => [b.offering.code, b.missing])).toEqual([["CSCI-UA 102", ["CSCI-UA 101"]]]);

    const after = plan({ groups, credits: {}, offerings, prerequisites, completed: ["CSCI-UA 101"] }).groups[0];
    expect(after.eligible.map((o) => o.code)).toEqual(["CSCI-UA 102"]);
  });
});

describe("prerequisite rules", () => {
  const done = new Set(["MATH-UA 121"]);
  it("handles all-of and any-of", () => {
    expect(prereqMissing({ any: [{ course: "MATH-UA 121" }, { course: "MATH-UA 131" }] }, done)).toEqual([]);
    expect(prereqMissing({ all: [{ course: "MATH-UA 121" }, { course: "ECON-UA 2" }] }, done)).toEqual(["ECON-UA 2"]);
    expect(prereqMissing({ any: [{ course: "ECON-UA 1" }, { course: "ECON-UA 2" }] }, done))
      .toEqual(["ECON-UA 1 or ECON-UA 2"]);
  });
});
