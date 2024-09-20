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

-- Down

DROP TABLE configs;
DROP TABLE versions;
