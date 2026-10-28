"use client";

import { useMemo, useState } from "react";
import type { Program } from "@/lib/data";
import { YEARS } from "@/lib/years";

type Props = {
  programs: Program[];
  initial?: { programId?: number; year?: string; completed?: string };
};

export default function PlannerForm({ programs, initial }: Props) {
  const schools = useMemo(() => {
    const byCode = new Map(programs.map((p) => [p.schoolCode, p.schoolName]));
    return [...byCode.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [programs]);

  const initialProgram = programs.find((p) => p.id === initial?.programId);
  const [school, setSchool] = useState(initialProgram?.schoolCode ?? schools[0]?.[0] ?? "");
  const [programId, setProgramId] = useState<number | "">(initialProgram?.id ?? "");

  const schoolPrograms = programs.filter((p) => p.schoolCode === school);

  return (
    <form action="/plan" method="get" className="mt-8 flex flex-col gap-5">
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
          {schools.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Major</span>
        <select
          name="program"
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
        <select name="year" className="rounded border p-2" defaultValue={initial?.year ?? YEARS[0]}>
          {YEARS.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Courses you&apos;ve completed</span>
        <textarea
          name="completed"
          className="min-h-28 rounded border p-2 font-mono text-sm"
          placeholder={"ECON-UA 1\nCSCI-UA 101\nMATH-UA 131"}
          defaultValue={initial?.completed ?? ""}
        />
        <span className="text-sm text-neutral-500">
          One per line or comma separated, like ECON-UA 1. Include AP credit by its NYU equivalent.
        </span>
      </label>

      <button type="submit" className="self-start rounded bg-violet-700 px-5 py-2 font-medium text-white">
        Build my plan
      </button>
    </form>
  );
}
