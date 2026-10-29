import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getSql, loadCredits, loadCurrentTerm, loadOfferings, loadPrerequisites, loadPrograms, loadRequirements,
} from "@/lib/data";
import { parseCourseList, plan, type GroupResult, type Offering } from "@/lib/planner";
import { YEARS } from "@/lib/years";
import PlannerForm from "../planner-form";
import { formatMeeting } from "./format";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ program?: string; year?: string; completed?: string }>;

export default async function PlanPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const sql = getSql();
  if (!sql) {
    return <main className="mx-auto max-w-3xl px-4 py-12">The database isn&apos;t connected yet.</main>;
  }

  const programs = await loadPrograms(sql);
  const program = programs.find((p) => p.id === Number(params.program));
  if (!program) notFound();
  const year = YEARS.includes(params.year ?? "") ? params.year! : YEARS[0];

  const { codes: completed, invalid } = parseCourseList(params.completed ?? "");
  const groups = await loadRequirements(sql, program.id);
  const term = await loadCurrentTerm(sql);
  const offerings = term ? await loadOfferings(sql, term.id, groups) : [];
  const [credits, prerequisites] = await Promise.all([
    loadCredits(sql, completed),
    loadPrerequisites(sql, offerings.map((o) => o.code)),
  ]);
  const result = plan({ groups, completed, credits, offerings, prerequisites });

  const met = result.groups.filter((g) => g.satisfied).length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-violet-700 dark:text-violet-400">
        ← Start over
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">
        {program.name} ({program.degree}){program.concentration ? `, ${program.concentration}` : ""}
      </h1>
      <p className="mt-1 text-neutral-600 dark:text-neutral-400">
        {program.schoolName} · {year} · {completed.length} completed course{completed.length === 1 ? "" : "s"}
        {term ? ` · Showing ${term.name} sections` : ""}
      </p>

      <p className="mt-4 text-lg">
        You&apos;ve met <strong>{met} of {result.groups.length}</strong> requirement areas.
      </p>

      <Notices
        reviewed={program.reviewed}
        bulletinUrl={program.bulletinUrl}
        invalid={invalid}
        unused={result.unused}
        assumed={result.assumedCredits}
        hasTerm={!!term}
      />

      <div className="mt-6 flex flex-col gap-4">
        {result.groups.map((g) => (
          <GroupCard key={g.id} group={g} depth={0} />
        ))}
      </div>

      <details className="mt-10 rounded border p-4">
        <summary className="cursor-pointer font-medium">Change your details</summary>
        <PlannerForm
          programs={programs}
          initial={{ programId: program.id, year, completed: completed.join("\n") }}
        />
      </details>
    </main>
  );
}

function Notices(props: {
  reviewed: boolean; bulletinUrl: string; invalid: string[]; unused: string[]; assumed: string[]; hasTerm: boolean;
}) {
  const items: React.ReactNode[] = [];
  if (!props.reviewed) {
    items.push(
      <>
        These requirements were transcribed from the{" "}
        <a className="underline" href={props.bulletinUrl}>NYU Bulletin</a> and haven&apos;t been checked yet.
        Confirm with your adviser before registering.
      </>,
    );
  }
  if (!props.hasTerm) items.push(<>Next term&apos;s sections haven&apos;t been loaded yet.</>);
  if (props.invalid.length) {
    items.push(<>We couldn&apos;t read: {props.invalid.join(", ")}. Use codes like ECON-UA 1.</>);
  }
  if (props.unused.length) {
    items.push(<>These courses didn&apos;t count toward any requirement: {props.unused.join(", ")}.</>);
  }
  if (props.assumed.length) {
    items.push(<>We assumed 4 credits for {props.assumed.join(", ")}.</>);
  }
  if (!items.length) return null;
  return (
    <ul className="mt-4 flex flex-col gap-1 rounded border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function StatusBadge({ satisfied, started }: { satisfied: boolean; started: boolean }) {
  const [text, cls] = satisfied
    ? ["Done", "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"]
    : started
      ? ["In progress", "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"]
      : ["Not started", "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"];
  return <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{text}</span>;
}

function GroupCard({ group, depth }: { group: GroupResult; depth: number }) {
  const outer = depth === 0;
  return (
    <section className={outer ? "rounded-lg border p-4" : "border-l-2 pl-4 pt-3"}>
      <div className="flex items-start justify-between gap-3">
        <h2 className={outer ? "text-lg font-semibold" : "font-medium"}>{group.label}</h2>
        <StatusBadge satisfied={group.satisfied} started={group.applied.length > 0} />
      </div>
      {group.note && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{group.note}</p>}
      {group.applied.length > 0 && !group.children.length && (
        <p className="mt-1 text-sm">Counted: {group.applied.join(", ")}</p>
      )}
      {!group.satisfied && group.remaining && <p className="mt-1 text-sm font-medium">Still needed: {group.remaining}</p>}

      {!group.satisfied && !group.children.length && (
        <div className="mt-2">
          {group.anyCourse ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Any course can count here.</p>
          ) : group.eligible.length ? (
            <OfferingList offerings={group.eligible} />
          ) : (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Nothing for this requirement is offered next term.</p>
          )}
          {group.blocked.length > 0 && (
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              Also offered, once you have the prerequisites:{" "}
              {group.blocked.map((b) => `${b.offering.code} (needs ${b.missing.join(", ")})`).join("; ")}
            </p>
          )}
        </div>
      )}

      {group.children.map((c) => (
        <GroupCard key={c.id} group={c} depth={depth + 1} />
      ))}
    </section>
  );
}

function OfferingList({ offerings }: { offerings: Offering[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Offered next term ({offerings.length} course{offerings.length === 1 ? "" : "s"}):
      </p>
      {offerings.map((o) => (
        <details key={o.code} className="rounded border px-3 py-2">
          <summary className="cursor-pointer text-sm">
            <span className="font-mono font-medium">{o.code}</span> {o.title}
            <span className="text-neutral-500">
              {" "}· {o.sections.length} section{o.sections.length === 1 ? "" : "s"}
            </span>
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-neutral-500">
                <tr>
                  <th className="pr-3 font-normal">Section</th>
                  <th className="pr-3 font-normal">Type</th>
                  <th className="pr-3 font-normal">When</th>
                  <th className="pr-3 font-normal">Mode</th>
                  <th className="font-normal">Instructor</th>
                </tr>
              </thead>
              <tbody>
                {o.sections.map((s) => (
                  <tr key={s.sectionCode} className="border-t">
                    <td className="py-1 pr-3 font-mono">{s.sectionCode}</td>
                    <td className="py-1 pr-3">{s.component ?? ""}</td>
                    <td className="py-1 pr-3">{s.meetings.length ? s.meetings.map(formatMeeting).join("; ") : "TBA"}</td>
                    <td className="py-1 pr-3">{s.mode ?? ""}</td>
                    <td className="py-1">
                      {s.instructors.length
                        ? s.instructors.map((i, k) => (
                            <span key={i.name}>
                              {k > 0 && ", "}
                              {i.rmpUrl ? <a className="underline" href={i.rmpUrl}>{i.name}</a> : i.name}
                              {i.rmpRating != null && ` (${i.rmpRating.toFixed(1)}/5)`}
                            </span>
                          ))
                        : <span className="text-neutral-500">Not posted yet</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}
