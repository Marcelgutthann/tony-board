-- Discord-Ausgang: Tony legt Nachrichten ab, der Discord-Bot auf dem Server holt sie ab, sendet und quittiert.
-- schluessel = Idempotenzschluessel: derselbe Schluessel wird nie zweimal gesendet.
create table if not exists public.tony_board_discord (
  id bigint generated always as identity primary key,
  schluessel text not null unique,
  kanal text not null,
  text text not null,
  fenster_id text,
  status text not null default 'offen' check (status in ('offen','sendet','gesendet','fehler','ungewiss')),
  message_id text,
  fehler text,
  versuche int not null default 0,
  erstellt timestamptz not null default now(),
  angenommen_am timestamptz,
  gesendet_am timestamptz
);
create index if not exists tony_board_discord_status on public.tony_board_discord (status, erstellt);
alter table public.tony_board_discord enable row level security;
