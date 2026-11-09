-- Plattform Stufe 3: Nachrichten an Sitzungskarten holt die laufende Sitzung selbst ab.
alter table tony_board_eingang add column if not exists an_sitzung timestamptz;  -- wann an die Sitzung ausgeliefert
