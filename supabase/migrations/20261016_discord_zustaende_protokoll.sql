-- Abholung und Sendeversuch getrennt: abgeholt ohne Sendeversuch = sicher nicht gesendet,
-- sendet = Versuch begonnen, Ausgang erst nach Quittung oder Kanalpruefung bekannt.
alter table public.tony_board_discord drop constraint if exists tony_board_discord_status_check;
alter table public.tony_board_discord add constraint tony_board_discord_status_check
  check (status in ('offen','abgeholt','sendet','gesendet','fehler','ungewiss'));
alter table public.tony_board_discord add column if not exists abgeholt_am timestamptz;
alter table public.tony_board_discord add column if not exists sendeversuch_am timestamptz;
alter table public.tony_board_discord add column if not exists geprueft_am timestamptz;
alter table public.tony_board_discord add column if not exists quelle text;
update public.tony_board_discord set abgeholt_am = angenommen_am, sendeversuch_am = angenommen_am where abgeholt_am is null;

-- Protokoll jedes MCP-Aufrufs (nur Methode/Werkzeug/Auftragsschluessel, keine Inhalte):
-- belegt, ob ein Auftrag aus ChatGPT ueberhaupt bei uns angekommen ist.
create table if not exists public.tony_board_mcp_protokoll (
  id bigint generated always as identity primary key,
  zeit timestamptz not null default now(),
  methode text,
  werkzeug text,
  auftrag text,
  client text,
  fehler text
);
create index if not exists tony_board_mcp_protokoll_zeit on public.tony_board_mcp_protokoll (zeit desc);
alter table public.tony_board_mcp_protokoll enable row level security;
