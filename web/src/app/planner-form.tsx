"use client";

import { useMemo, useState } from "react";
import type { Program } from "@/lib/supabase";

const YEARS = ["First year", "Sophomore", "Junior", "Senior"];

// Accepts "ECON-UA 1, CSCI-UA 101" or one course per line.
export function parseCourseList(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n,;]+/)
        .map((c) => c.trim().toUpperCase().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  );
}

export default function PlannerForm({ programs }: { programs: Program[] }) {
  const schools = useMemo(() => {
    const byCode = new Map(programs.map((p) => [p.school.code, p.school]));
    return Array.from(byCode.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [programs]);

  const [school, setSchool] = useState(schools[0]?.code ?? "");
  const [programId, setProgramId] = useState<number | "">("");
  const [year, setYear] = useState(YEARS[0]);
  const [completed, setCompleted] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const schoolPrograms = programs.filter((p) => p.school.code === school);

  return (
    <form
      className="mt-8 flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-medium">School</span>
        <select
          className="rounded border p-2"
          value={school}
          onChange={(e) => {
            setSchool(e.target.value);
            setProgramId("");
          }}
        >
          {schools.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Major</span>
        <select
          className="rounded border p-2"
          required
          value={programId}
          onChange={(e) => setProgramId(Number(e.target.value))}
        >
          <option value="">Choose a major</option>
          {schoolPrograms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.degree}){p.concentration ? `, ${p.concentration} concentration` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Year</span>
        <select className="rounded border p-2" value={year} onChange={(e) => setYear(e.target.value)}>
          {YEARS.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Courses you&apos;ve completed</span>
        <textarea
          className="min-h-28 rounded border p-2 font-mono text-sm"
          placeholder={"ECON-UA 1\nCSCI-UA 101\nMATH-UA 131"}
          value={completed}
          onChange={(e) => setCompleted(e.target.value)}
        />
        <span className="text-sm text-neutral-500">One per line or comma separated. AP credit counts too.</span>
      </label>

      <button type="submit" className="self-start rounded bg-violet-700 px-5 py-2 font-medium text-white">
        Build my plan
      </button>

      {submitted && (
        <p className="rounded border p-4 text-sm">
          Got {parseCourseList(completed).length} completed courses. Plan results arrive with the planner engine
          (milestone 4).
        </p>
      )}
    </form>
  );
}
