"""Manual standalone FTS5 SQL integration check. Run with Python 3, no dependencies.

The queries are read from the actual Rust source, not copied into this test.
"""
from pathlib import Path
import re
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / 'src-tauri/src/db.rs').read_text()
start = source.index('        let sql = if terms.is_empty() {')
end = source.index('        let mut statement = connection.prepare(sql)', start)
queries = re.findall(r'\n\s*"(SELECT[^\n]+)"', source[start:end])
assert len(queries) == 2, 'Expected both filter-only and FTS5 search queries'

connection = sqlite3.connect(':memory:')
connection.executescript('''
CREATE TABLE messages (
 id INTEGER PRIMARY KEY, account_id TEXT, folder TEXT, uid INTEGER, message_id TEXT,
 subject TEXT, sender TEXT, recipients TEXT, date INTEGER,
 preview TEXT, flags_json TEXT, thread_key TEXT, body_text TEXT
);
CREATE VIRTUAL TABLE message_fts USING fts5(
 subject, sender, recipients, preview, body_text,
 content='messages', content_rowid='id'
);
''')
connection.executemany('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [
 (1,'alpha','INBOX',1,'<a>','Hello','Alice <alice@example.org>','someone',1793320000,'Hello message','[]','root','meeting now'),
 (2,'bravo','INBOX',2,'<b>','Hello','Bob <bob@example.org>','someone',1793320000,'Hello message','[]','root','meeting now'),
 (3,'alpha','Sent',3,'<c>','Hello','Alice <alice@example.org>','someone',1793320000,'Hello message','[]','root','meeting now'),
])
connection.execute("INSERT INTO message_fts(message_fts) VALUES('rebuild')")
query_filters, query_fts = queries

def ids(sql, term='', account=None, sender=None, folder=None, after=None, before=None):
    return [row[0] for row in connection.execute(sql,(term,account,sender,folder,after,before)).fetchall()]

assert ids(query_filters,'', 'alpha', '%alice%', 'INBOX') == [1]
assert ids(query_filters,'', 'bravo', '%alice%') == []
assert ids(query_fts,'"meeting"', 'alpha', None,'INBOX') == [1]
assert ids(query_fts,'"meeting"', 'alpha', None, 'Sent') == [3]
assert set(ids(query_fts,'"meeting"', None, None, None, '2026-01-01')) == {1,2,3}
assert ids(query_fts,'"meeting"', None, None, None, None, '2026-01-01') == []
assert ids(query_filters,'', None, '%!%%') == [], 'Escaped percent must not behave as a wildcard'
print('SQLite FTS5 search/filter/account isolation: PASS')
