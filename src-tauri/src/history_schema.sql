CREATE TABLE IF NOT EXISTS analysis_daily_bars (
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,
    payload TEXT NOT NULL,
    fetched_ms INTEGER NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY(symbol, date)
);
CREATE TABLE IF NOT EXISTS analysis_history_years (
    symbol TEXT NOT NULL,
    year INTEGER NOT NULL,
    metadata TEXT NOT NULL,
    fetched_ms INTEGER NOT NULL,
    PRIMARY KEY(symbol, year)
);

CREATE TABLE IF NOT EXISTS analysis_suspensions (
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,
    reference_date TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY(symbol, date)
);
