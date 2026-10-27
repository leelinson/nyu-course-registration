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

## Database

Eleven tables in three groups:

- **Catalog:** `schools`, `programs`, `courses`, `prerequisites`
- **Requirements:** `requirement_groups` (a tree: all of, choose N, minimum credits) and `requirement_courses`
- **Offerings:** `terms`, `sections`, `meetings`, `instructors`, `section_instructors`

All tables are public catalog data with row level security set to read-only for
the anon key. Scrapers write with the service role key.

### Apply to Supabase

```sh
supabase link --project-ref <your-project-ref>
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql
```

### Try it locally with plain Postgres

```sh
createdb planner
psql -d planner -f supabase/migrations/20261027000000_init.sql
psql -d planner -f supabase/seed.sql
```

## Web app

```sh
cd web
cp .env.example .env.local   # fill in your Supabase URL and anon key
npm install
npm run dev
```
