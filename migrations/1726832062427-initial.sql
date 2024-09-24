-- Up

CREATE TABLE static_config (
  version                  INTEGER PRIMARY KEY NOT NULL
  enable_paper_wallet_only BOOLEAN NOT NULL,
  has_lightening           BOOLEAN NOT NULL,
  server_version           TEXT NOT NULL,
  two_way_mode             BOOLEAN NOT NULL,
  country                  TEXT NOT NULL,
  fiat_code                TEXT NOT NULL,
  primary_locale           TEXT NOT NULL
);

CREATE TABLE urls_to_ping (
  url TEXT NOT NULL
);

CREATE TABLE speedtest_files (
  url  TEXT NOT NULL,
  size INTEGER NOT NULL
);

CREATE TABLE terms (
  hash TEXT
);

CREATE TABLE terms_by_hash (
  hash    TEXT PRIMARY KEY NOT NULL,
  title   TEXT NOT NULL,
  text    TEXT NOT NULL,
  accept  TEXT NOT NULL,
  cancel  TEXT NOT NULL,
  tcphoto BOOLEAN NOT NULL,
  delay   BOOLEAN NOT NULL
);

CREATE TABLE triggers_automation (
  trigger_type TEXT PRIMARY KEY NOT NULL,
  automatic    BOOLEAN NOT NULL
);

CREATE TABLE locales (
  locale TEXT PRIMARY KEY NOT NULL
);

-- Down

DROP TABLE locales;
DROP TABLE triggers_automation;
DROP TABLE terms_by_hash;
DROP TABLE terms;
DROP TABLE speedtest_files;
DROP TABLE urls_to_ping;
DROP TABLE static_config;
DROP TABLE version;
