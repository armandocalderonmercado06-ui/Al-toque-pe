create table if not exists public.al_toque_state (
  key text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.al_toque_state enable row level security;
revoke all on table public.al_toque_state from anon, authenticated;
grant all on table public.al_toque_state to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'al-toque-reels',
  'al-toque-reels',
  true,
  52428800,
  array['video/mp4', 'video/webm']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
