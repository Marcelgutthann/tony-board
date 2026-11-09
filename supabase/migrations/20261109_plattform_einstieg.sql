-- Plattform Stufe 1: Sitzungskarten wissen, zu welchem Workspace und Mitarbeiter sie gehoeren,
-- und tragen den Einstieg, den der Mitarbeiter vor einer Frage an Marcel vorbereitet.
-- Alle Spalten sind optional; bestehende Karten bleiben unveraendert lesbar.
alter table tony_board_fenster
  add column if not exists workspace   text,   -- NoraNotes | KIOS | Marketplace | ...
  add column if not exists mitarbeiter text,   -- Bereich innerhalb des Workspaces, z. B. 'UI und UX'
  add column if not exists einstieg    jsonb,  -- {bereich, thema, kette[], zahlen[{wert,text}], stand{code,staging,prod}, empfehlung, risiko, am}
  add column if not exists desktop_id  text;   -- local_... der Claude-Desktop-Sitzung, zum Oeffnen per claude://
