-- Reference data for the pilot: three schools, current terms, three programs.
-- Requirements for each program are loaded separately (seed_requirements.sql).
-- Safe to re-run: existing rows are left alone.

insert into schools (code, name) values
  ('UB', 'Leonard N. Stern School of Business'),
  ('UT', 'Tisch School of the Arts'),
  ('UA', 'College of Arts and Science')
on conflict (code) do nothing;

-- NYU term codes: 1 + two-digit year + season (2 January, 4 Spring, 6 Summer, 8 Fall).
-- start_date is filled in from the academic calendar by the section scraper.
insert into terms (code, name) values
  ('1268', 'Fall 2026'),
  ('1272', 'January 2027'),
  ('1274', 'Spring 2027')
on conflict (code) do nothing;

insert into programs (school_id, slug, name, degree, concentration, bulletin_url, catalog_year, total_credits)
select s.id, p.slug, p.name, p.degree, p.concentration, p.url, '2026-2027', 128
from (values
  ('UA', 'economics-computer-science-ba', 'Economics and Computer Science', 'BA', null,
   'https://bulletins.nyu.edu/undergraduate/arts-science/programs/economics-computer-science-ba/'),
  ('UT', 'film-television-bfa', 'Film and Television', 'BFA', null,
   'https://bulletins.nyu.edu/undergraduate/arts/programs/film-television-bfa/'),
  ('UB', 'business-bs', 'Business', 'BS', 'Finance',
   'https://bulletins.nyu.edu/undergraduate/business/programs/business-bs/')
) as p(school, slug, name, degree, concentration, url)
join schools s on s.code = p.school
where not exists (
  select 1 from programs e
  where e.slug = p.slug and e.catalog_year = '2026-2027'
    and e.concentration is not distinct from p.concentration
);
