-- "Bleibt im Blick" ist Wiedervorlage, nicht Archiv: ein Punkt muss sagen koennen, wann er wieder
-- geprueft wird, was die letzte Pruefung ergeben hat und ob er schon gemeldet wurde.
-- Grund = text, Prueftermin = nachfassen_am, Karte = fenster_id (alle schon vorhanden).
-- Alle Spalten sind optional; Punkte von vorher bleiben unveraendert lesbar.
alter table tony_board_blick
  add column if not exists pruefstand  text,          -- was die letzte Pruefung ergeben hat
  add column if not exists geprueft_am timestamptz,   -- wann zuletzt geprueft wurde
  add column if not exists gemeldet_am timestamptz;   -- wann als faellig an Tony gemeldet; null = noch nicht gemeldet
