# NYU Course Planner

A student enters their school, major, year, and completed courses, and gets back
the courses they still need, the ones they can take next term, every section of
each, and a professor rating summary with a link to the source.

Pilot scope: Stern (Business BS, Finance concentration), Tisch (Film and
Television BFA), and CAS (Economics and Computer Science BA).

## Layout

| Path | What it is |
| --- | --- |
| `web/` | Next.js app (App Router, TypeScript, Tailwind), deployed to Vercel |
| `supabase/migrations/` | Postgres schema, applied to Supabase |
| `supabase/seed.sql` | Schools, terms, and the three pilot programs |
| `data/requirements/` | One JSON file per program: its requirement tree, from the NYU Bulletins |
| `scripts/build_requirements_sql.py` | Turns the JSON files into `supabase/seed_requirements.sql` |

## Database

Eleven tables in three groups:

- **Catalog:** `schools`, `programs`, `courses`, `prerequisites`
- **Requirements:** `requirement_groups` (a tree: all of, choose N, minimum credits) and `requirement_courses`
- **Offerings:** `terms`, `sections`, `meetings`, `instructors`, `section_instructors`

All tables are public catalog data with row level security set to read-only for
the anon key. Scrapers write with the service role key.

### Requirements data

Each file in `data/requirements/` is one program's requirement tree. A group is
`all` (every member), `choose_n` (pick `n`), or `credits_min` (reach `credits`),
and holds courses, LIKE patterns such as `CSCI-UA 4__`, or child groups. The
`note` field keeps bulletin wording a pattern can't express.

After editing a JSON file, regenerate the SQL (CI checks that it's current):

```sh
python3 scripts/build_requirements_sql.py > supabase/seed_requirements.sql
```

The pilot data was transcribed from the Bulletins and is marked
`requirements_reviewed = false` until someone checks it against the program page.

### Apply to Supabase

```sh
supabase link --project-ref <your-project-ref>
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql
psql "$DATABASE_URL" -f supabase/seed_requirements.sql
```

### Try it locally with plain Postgres

```sh
createdb planner
for f in supabase/migrations/*.sql supabase/seed.sql supabase/seed_requirements.sql; do
  psql -d planner -v ON_ERROR_STOP=1 -f "$f"
done
```

## Web app

```sh
cd web
cp .env.example .env.local   # fill in your Supabase URL and anon key
npm install
npm run dev
```
