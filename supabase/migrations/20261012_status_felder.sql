-- Statusdarstellung: ein Fenster muss sagen koennen, was wirklich getan wird, wer dran ist,
-- worauf es haengt, was als Naechstes kommt und wann das zuletzt bestaetigt wurde.
-- Alle Spalten sind optional; Fenster von vorher bleiben unveraendert lesbar.
alter table tony_board_fenster
  add column if not exists taetigkeit      text,                      -- was gerade tatsaechlich passiert
  add column if not exists zustaendig      text,                      -- wer arbeitet daran / worauf kommt es an
  add column if not exists warten_auf      text,                      -- marcel | extern | agent | zugang
  add column if not exists wartegrund      text,                      -- die konkrete Abhaengigkeit
  add column if not exists naechste_aktion text,                      -- der naechste Schritt und wer ihn macht
  add column if not exists bestaetigt_am   timestamptz,               -- letztes ausdruecklich bestaetigtes Signal
  add column if not exists fehler          text;                      -- Abbruch im Klartext

alter table tony_board_fenster drop constraint if exists tony_board_fenster_warten_auf_check;
alter table tony_board_fenster add constraint tony_board_fenster_warten_auf_check
  check (warten_auf is null or warten_auf in ('marcel','extern','agent','zugang'));
