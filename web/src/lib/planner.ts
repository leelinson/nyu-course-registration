// The planner engine: given a program's requirement tree, the courses a
// student has completed, and next term's offerings, work out what is done,
// what is still needed, and which offered courses would count.
//
// Pure functions only; data loading lives in ./data.ts.

export type Rule = "all" | "choose_n" | "credits_min";

export type Member = { kind: "course"; code: string } | { kind: "pattern"; pattern: string };

export type RequirementGroup = {
  id: number;
  label: string;
  rule: Rule;
  n: number | null;
  credits: number | null;
  note: string | null;
  members: Member[];
  children: RequirementGroup[];
};

export type Meeting = { days: string; start: string | null; end: string | null };

export type Section = {
  sectionCode: string;
  classNumber: string | null;
  component: string | null;
  mode: string | null;
  status: string | null;
  meetings: Meeting[];
  instructors: { name: string; rmpUrl: string | null; rmpRating: number | null }[];
};

export type Offering = { code: string; title: string; credits: number | null; sections: Section[] };

// A prerequisite rule from the prerequisites table.
export type PrereqRule = { all: PrereqRule[] } | { any: PrereqRule[] } | { course: string };

export type PlannerInput = {
  groups: RequirementGroup[];
  completed: string[];
  credits: Record<string, number | null>; // known credits by course code
  offerings: Offering[];
  prerequisites?: Record<string, PrereqRule>;
};

export type GroupResult = {
  id: number;
  label: string;
  rule: Rule;
  note: string | null;
  satisfied: boolean;
  applied: string[]; // completed courses counted here
  remaining: string; // plain-language summary of what is left
  missingCourses: string[]; // named courses still required ("all" groups)
  anyCourse: boolean; // the group accepts any course, so we don't list options
  eligible: Offering[]; // offered next term, would count here, prerequisites met
  blocked: { offering: Offering; missing: string[] }[]; // offered but prerequisites not met
  children: GroupResult[];
};

export type PlanResult = {
  groups: GroupResult[];
  unused: string[]; // completed courses that counted toward nothing
  assumedCredits: string[]; // completed courses whose credits we had to assume
};

// Most NYU undergraduate courses are 4 credits. Used only when a course's
// credits are unknown, and reported back so the page can say so.
export const DEFAULT_CREDITS = 4;

const CODE_RE = /^([A-Z]+-[A-Z]+)\s*([0-9A-Z.]+)$/;

/** "econ-ua 1", "ECON-UA1", " ECON-UA  1 " all become "ECON-UA 1". */
export function normalizeCode(raw: string): string | null {
  const m = raw.trim().toUpperCase().replace(/\s+/g, " ").match(CODE_RE);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** Accepts a course list separated by newlines, commas, or semicolons. */
export function parseCourseList(text: string): { codes: string[]; invalid: string[] } {
  const codes = new Set<string>();
  const invalid: string[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    if (!part.trim()) continue;
    const code = normalizeCode(part);
    if (code) codes.add(code);
    else invalid.push(part.trim());
  }
  return { codes: [...codes], invalid };
}

/** SQL LIKE pattern ("CSCI-UA 4__", "FMTV-UT %") as a regular expression. */
export function likeToRegExp(pattern: string): RegExp {
  const body = pattern
    .split("")
    .map((ch) => (ch === "%" ? ".*" : ch === "_" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${body}$`);
}

export function memberMatches(member: Member, code: string): boolean {
  return member.kind === "course" ? member.code === code : likeToRegExp(member.pattern).test(code);
}

const isWildcard = (m: Member) => m.kind === "pattern" && m.pattern.trim() === "%";

function leaves(groups: RequirementGroup[]): RequirementGroup[] {
  return groups.flatMap((g) => (g.children.length ? leaves(g.children) : [g]));
}

type LeafState = { applied: string[]; credits: number };

function creditsOf(code: string, credits: PlannerInput["credits"], assumed: Set<string>): number {
  const known = credits[code];
  if (known == null) {
    assumed.add(code);
    return DEFAULT_CREDITS;
  }
  return known;
}

function leafIsFull(g: RequirementGroup, s: LeafState): boolean {
  switch (g.rule) {
    case "all":
      return g.members.every((m) => m.kind !== "course" || s.applied.includes(m.code)) &&
        s.applied.length >= g.members.length;
    case "choose_n":
      return s.applied.length >= (g.n ?? 1);
    case "credits_min":
      return s.credits >= (g.credits ?? 0);
  }
}

/**
 * Places each completed course. A course named outright in several
 * requirements counts toward each of them (FINC-UB 2 is both business core
 * and finance concentration). Courses that only match a pattern count once,
 * in the most specific place they fit: narrow patterns (CSCI-UA 4__) before
 * catch-all electives.
 */
function allocate(input: PlannerInput, assumed: Set<string>) {
  const state = new Map<number, LeafState>();
  const all = leaves(input.groups);
  for (const g of all) state.set(g.id, { applied: [], credits: 0 });

  const apply = (g: RequirementGroup, code: string) => {
    const s = state.get(g.id)!;
    if (leafIsFull(g, s) || s.applied.includes(code)) return false;
    s.applied.push(code);
    s.credits += creditsOf(code, input.credits, assumed);
    return true;
  };

  const pool = new Set(input.completed);

  // Named courses: count everywhere they are named.
  for (const code of input.completed) {
    let used = false;
    for (const g of all) {
      if (g.members.some((m) => m.kind === "course" && m.code === code)) used = apply(g, code) || used;
    }
    if (used) pool.delete(code);
  }

  // Patterns: count once, narrow patterns first.
  const passes: ((m: Member) => boolean)[] = [
    (m) => m.kind === "pattern" && !isWildcard(m),
    (m) => isWildcard(m),
  ];
  for (const inPass of passes) {
    for (const g of all) {
      for (const code of [...pool]) {
        if (!g.members.some((m) => inPass(m) && memberMatches(m, code))) continue;
        if (apply(g, code)) pool.delete(code);
      }
    }
  }
  return { state, unused: [...pool] };
}

export function prereqMissing(rule: PrereqRule | undefined, done: Set<string>): string[] {
  if (!rule) return [];
  if ("course" in rule) return done.has(rule.course) ? [] : [rule.course];
  if ("all" in rule) return rule.all.flatMap((r) => prereqMissing(r, done));
  const options = rule.any.map((r) => prereqMissing(r, done));
  if (options.some((o) => o.length === 0)) return [];
  return [options.map((o) => o.join(" and ")).join(" or ")];
}

function describeRemaining(g: RequirementGroup, s: LeafState, missing: string[]): string {
  switch (g.rule) {
    case "all":
      return missing.length ? `Take ${missing.join(", ")}` : "";
    case "choose_n": {
      const left = (g.n ?? 1) - s.applied.length;
      return left > 0 ? `${left} more course${left === 1 ? "" : "s"}` : "";
    }
    case "credits_min": {
      const left = (g.credits ?? 0) - s.credits;
      return left > 0 ? `${left} more credit${left === 1 ? "" : "s"}` : "";
    }
  }
}

export function plan(input: PlannerInput): PlanResult {
  const assumed = new Set<string>();
  const { state, unused } = allocate(input, assumed);
  const done = new Set(input.completed);
  const offerings = input.offerings.filter((o) => !done.has(o.code));

  // Courses that a requirement names outright as required or as one of a
  // fixed list (ECON-UA 1 or 2 for intro). Elective patterns like ECON-UA %
  // match them too, but listing them there would be misleading.
  const reserved = new Set(
    leaves(input.groups)
      .filter((g) => g.rule === "all" || g.members.every((m) => m.kind === "course"))
      .flatMap((g) => g.members.flatMap((m) => (m.kind === "course" ? [m.code] : []))),
  );

  const evaluate = (g: RequirementGroup): GroupResult => {
    const children = g.children.map(evaluate);

    if (children.length) {
      const met = children.filter((c) => c.satisfied).length;
      const need = g.rule === "choose_n" ? (g.n ?? 1) : children.length;
      const left = Math.max(need - met, 0);
      return {
        id: g.id, label: g.label, rule: g.rule, note: g.note,
        satisfied: left === 0,
        applied: children.flatMap((c) => c.applied),
        remaining: left ? `${left} of ${need} parts left` : "",
        missingCourses: [], anyCourse: false, eligible: [], blocked: [],
        children,
      };
    }

    const s = state.get(g.id)!;
    const satisfied = leafIsFull(g, s);
    const missing = g.rule === "all"
      ? g.members.flatMap((m) => (m.kind === "course" && !s.applied.includes(m.code) ? [m.code] : []))
      : [];
    const anyCourse = g.members.some(isWildcard);

    const eligible: Offering[] = [];
    const blocked: GroupResult["blocked"] = [];
    if (!satisfied && !anyCourse) {
      for (const o of offerings) {
        const named = g.members.some((m) => m.kind === "course" && m.code === o.code);
        const counts = g.rule === "all"
          ? missing.includes(o.code)
          : named || (!reserved.has(o.code) && g.members.some((m) => memberMatches(m, o.code)));
        if (!counts) continue;
        const why = prereqMissing(input.prerequisites?.[o.code], done);
        if (why.length) blocked.push({ offering: o, missing: why });
        else eligible.push(o);
      }
    }

    return {
      id: g.id, label: g.label, rule: g.rule, note: g.note,
      satisfied, applied: s.applied,
      remaining: describeRemaining(g, s, missing),
      missingCourses: missing, anyCourse, eligible, blocked,
      children: [],
    };
  };

  return {
    groups: input.groups.map(evaluate),
    unused,
    assumedCredits: [...assumed].sort(),
  };
}
