import "server-only";
import postgres from "postgres";
import type { Member, Offering, PrereqRule, RequirementGroup, Rule, Section } from "./planner";

// Server-side only. DATABASE_URL is the same Postgres connection string the
// scrapers use (Supabase: Project settings, Database, connection string).
let sql: postgres.Sql | null = null;

export function getSql(): postgres.Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  sql ??= postgres(url, { max: 3, prepare: false });
  return sql;
}

export type Program = {
  id: number;
  name: string;
  degree: string;
  concentration: string | null;
  schoolCode: string;
  schoolName: string;
  bulletinUrl: string;
  reviewed: boolean;
};

export async function loadPrograms(sql: postgres.Sql): Promise<Program[]> {
  return sql<Program[]>`
    select p.id, p.name, p.degree, p.concentration,
           s.code as "schoolCode", s.name as "schoolName",
           p.bulletin_url as "bulletinUrl", p.requirements_reviewed as reviewed
    from programs p join schools s on s.id = p.school_id
    order by s.name, p.name`;
}

export async function loadRequirements(sql: postgres.Sql, programId: number): Promise<RequirementGroup[]> {
  const groups = await sql<{
    id: number; parentId: number | null; label: string; rule: Rule;
    n: number | null; credits: string | null; note: string | null;
  }[]>`
    select id, parent_id as "parentId", label, rule_type as rule, n, credits, note
    from requirement_groups where program_id = ${programId}
    order by position, id`;

  const members = await sql<{ groupId: number; code: string | null; pattern: string | null }[]>`
    select rc.group_id as "groupId", c.subject || ' ' || c.number as code, rc.subject_pattern as pattern
    from requirement_courses rc
    join requirement_groups g on g.id = rc.group_id
    left join courses c on c.id = rc.course_id
    where g.program_id = ${programId}
    order by rc.id`;

  const byId = new Map<number, RequirementGroup>();
  for (const g of groups) {
    byId.set(g.id, {
      id: g.id, label: g.label, rule: g.rule, n: g.n,
      credits: g.credits == null ? null : Number(g.credits),
      note: g.note, members: [], children: [],
    });
  }
  for (const m of members) {
    const member: Member = m.code ? { kind: "course", code: m.code } : { kind: "pattern", pattern: m.pattern! };
    byId.get(m.groupId)?.members.push(member);
  }
  const roots: RequirementGroup[] = [];
  for (const g of groups) {
    const node = byId.get(g.id)!;
    if (g.parentId == null) roots.push(node);
    else byId.get(g.parentId)?.children.push(node);
  }
  return roots;
}

export type Term = { id: number; code: string; name: string };

/** The latest term that has sections loaded. */
export async function loadCurrentTerm(sql: postgres.Sql): Promise<Term | null> {
  const [term] = await sql<Term[]>`
    select t.id, t.code, t.name from terms t
    where exists (select 1 from sections s where s.term_id = t.id)
    order by t.code desc limit 1`;
  return term ?? null;
}

export async function loadCredits(sql: postgres.Sql, codes: string[]): Promise<Record<string, number | null>> {
  if (!codes.length) return {};
  const rows = await sql<{ code: string; credits: string | null }[]>`
    select subject || ' ' || number as code, credits_min as credits
    from courses where subject || ' ' || number in ${sql(codes)}`;
  return Object.fromEntries(rows.map((r) => [r.code, r.credits == null ? null : Number(r.credits)]));
}

function collectMembers(groups: RequirementGroup[]): { codes: string[]; patterns: string[] } {
  const codes = new Set<string>();
  const patterns = new Set<string>();
  const walk = (g: RequirementGroup) => {
    for (const m of g.members) {
      if (m.kind === "course") codes.add(m.code);
      else if (m.pattern.trim() !== "%") patterns.add(m.pattern);
    }
    g.children.forEach(walk);
  };
  groups.forEach(walk);
  return { codes: [...codes], patterns: [...patterns] };
}

/** Every course offered in the term that could count toward the program. */
export async function loadOfferings(sql: postgres.Sql, termId: number, groups: RequirementGroup[]): Promise<Offering[]> {
  const { codes, patterns } = collectMembers(groups);
  if (!codes.length && !patterns.length) return [];

  const rows = await sql<{
    code: string; title: string; credits: string | null; sectionId: number;
    sectionCode: string; classNumber: string | null; component: string | null;
    mode: string | null; status: string | null;
    meetings: { days: string; start: string | null; end: string | null }[];
    instructors: { name: string; rmpUrl: string | null; rmpRating: string | null }[];
  }[]>`
    select c.subject || ' ' || c.number as code, c.title, c.credits_min as credits,
           s.id as "sectionId", s.section_code as "sectionCode", s.class_number as "classNumber",
           s.component, s.mode, s.status,
           coalesce((select json_agg(json_build_object(
                       'days', m.days,
                       'start', to_char(m.start_time, 'HH24:MI'),
                       'end', to_char(m.end_time, 'HH24:MI')) order by m.id)
                     from meetings m where m.section_id = s.id), '[]') as meetings,
           coalesce((select json_agg(json_build_object(
                       'name', i.name, 'rmpUrl', i.rmp_url, 'rmpRating', i.rmp_rating) order by i.name)
                     from section_instructors si join instructors i on i.id = si.instructor_id
                     where si.section_id = s.id), '[]') as instructors
    from sections s join courses c on c.id = s.course_id
    where s.term_id = ${termId}
      and coalesce(s.status, '') <> 'Cancelled'
      and (c.subject || ' ' || c.number in ${sql(codes.length ? codes : [""])}
           or c.subject || ' ' || c.number like any(${patterns.length ? patterns : [""]}::text[]))
    order by c.subject, nullif(regexp_replace(c.number, '\\D', '', 'g'), '')::int nulls last, c.number,
             s.section_code`;

  const byCode = new Map<string, Offering>();
  for (const r of rows) {
    let o = byCode.get(r.code);
    if (!o) {
      o = { code: r.code, title: r.title, credits: r.credits == null ? null : Number(r.credits), sections: [] };
      byCode.set(r.code, o);
    }
    const section: Section = {
      sectionCode: r.sectionCode, classNumber: r.classNumber, component: r.component,
      mode: r.mode, status: r.status, meetings: r.meetings,
      instructors: r.instructors.map((i) => ({
        name: i.name, rmpUrl: i.rmpUrl, rmpRating: i.rmpRating == null ? null : Number(i.rmpRating),
      })),
    };
    o.sections.push(section);
  }
  return [...byCode.values()];
}

export async function loadPrerequisites(sql: postgres.Sql, codes: string[]): Promise<Record<string, PrereqRule>> {
  if (!codes.length) return {};
  const rows = await sql<{ code: string; rule: PrereqRule }[]>`
    select c.subject || ' ' || c.number as code, p.rule
    from prerequisites p join courses c on c.id = p.course_id
    where p.rule is not null and c.subject || ' ' || c.number in ${sql(codes)}`;
  return Object.fromEntries(rows.map((r) => [r.code, r.rule]));
}
