#!/usr/bin/env bash
# Bring a database up to date: apply new migrations, then (re)load seed data.
# Usage: DATABASE_URL=postgres://... scripts/setup_database.sh
#
# Applied migrations are recorded in schema_migrations, so running this again
# only applies files added since. Seeds are written to be safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL is not set}"
psql_() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }

psql_ -c "create table if not exists schema_migrations (
  name text primary key, applied_at timestamptz not null default now())"

for f in supabase/migrations/*.sql; do
  name=$(basename "$f")
  done=$(psql_ -tAc "select 1 from schema_migrations where name = '$name'")
  if [ "$done" = "1" ]; then
    echo "skip  $name"
    continue
  fi
  echo "apply $name"
  psql_ -1 -f "$f" -c "insert into schema_migrations (name) values ('$name')"
done

for f in supabase/seed.sql supabase/seed_requirements.sql; do
  echo "seed  $f"
  psql_ -f "$f"
done
