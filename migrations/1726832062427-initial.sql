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

-- Down

DROP TABLE terms_by_hash;
DROP TABLE terms;
DROP TABLE configs;
DROP TABLE versions;
