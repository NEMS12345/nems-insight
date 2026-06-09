-- 0013_site_timezone.sql
-- IANA timezone per site, e.g. 'Australia/Brisbane'. Time-of-use windows are evaluated in
-- the site's LOCAL clock time (see CLAUDE.md §5 + src/core/time), so the analytics/cost
-- engine needs to know each site's zone to bucket intervals correctly across daylight
-- saving. Optional: when absent the app falls back to NEM time (AEST, UTC+10), which is
-- correct for SE QLD / Energex sites (QLD does not observe DST) — the v1 scope.

alter table site add column timezone text;
