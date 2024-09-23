-- Up

CREATE TABLE versions (
  current INTEGER NOT NULL,
  latest  INTEGER NOT NULL
);
INSERT INTO versions (current, latest) VALUES (0, 0);

CREATE TABLE configs (
  namespace TEXT NOT NULL,
  version   INTEGER NOT NULL,
  data      TEXT NOT NULL
);

CREATE TABLE urls_to_ping (
  url TEXT NOT NULL
);

CREATE TABLE speedtest_files (
  url  TEXT NOT NULL,
  size INTEGER NOT NULL
);

CREATE TABLE terms (
  version INTEGER NOT NULL,
  hash    TEXT,
  active INTEGER NOT NULL
);

CREATE TABLE terms_by_hash (
  hash    TEXT NOT NULL,
  title   TEXT NOT NULL,
  text    TEXT NOT NULL,
  accept  TEXT NOT NULL,
  cancel  TEXT NOT NULL,
  tcphoto INTEGER NOT NULL,
  delay   INTEGER NOT NULL
);

CREATE TABLE triggers_automation (
  trigger_type TEXT PRIMARY KEY NOT NULL,
  automatic    INTEGER NOT NULL
);

-- Down

DROP TABLE triggers_automation;
DROP TABLE terms_by_hash;
DROP TABLE terms;
DROP TABLE speedtest_files;
DROP TABLE urls_to_ping;
DROP TABLE configs;
DROP TABLE versions;
