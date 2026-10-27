import { getSupabase, type Program } from "@/lib/supabase";
import PlannerForm from "./planner-form";

export const dynamic = "force-dynamic";

async function loadPrograms(): Promise<Program[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("programs")
    .select("id, name, degree, concentration, school:schools(code, name)")
    .order("name")
    .returns<Program[]>();
  if (error) throw error;
  return data;
}

export default async function Home() {
  const programs = await loadPrograms();

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-semibold">NYU Course Planner</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Tell us your school, major, and year. We&apos;ll show what you still need,
        what you can take next term, and every section of each course.
      </p>
      {programs ? (
        <PlannerForm programs={programs} />
      ) : (
        <p className="mt-8 rounded border border-amber-400 p-4 text-sm">
          The database isn&apos;t connected yet. Set NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY in <code>.env.local</code>.
        </p>
      )}
    </main>
  );
}
