import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,openSync,closeSync} from 'node:fs';
import {dirname} from 'node:path';
// Provider cache rows that name their season, such as cache:projections:2026:3.
const seasonal=/^cache:(?:games|projections|stats|outlook):(\d{4}):/;
export function openStore(path){
 // The file is created private, rather than tightened after SQLite has already created it.
 if(path!==':memory:'){mkdirSync(dirname(path),{recursive:true,mode:0o700});closeSync(openSync(path,'a',0o600))}
 const db=new DatabaseSync(path);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
 // Earlier versions kept a whole-data snapshot and a settings-change marker that nothing reads now,
 // and past seasons' weekly data only grows. Rows for the newest season present are kept.
 db.exec("DELETE FROM kv WHERE key IN ('snapshot','eventReset')");
 const keys=db.prepare("SELECT key FROM kv WHERE key GLOB 'cache:*:[0-9][0-9][0-9][0-9]:*'").all().map(r=>r.key).filter(k=>seasonal.test(k));
 const newest=Math.max(...keys.map(k=>Number(seasonal.exec(k)[1])));
 const drop=db.prepare('DELETE FROM kv WHERE key=?');for(const key of keys)if(Number(seasonal.exec(key)[1])<newest)drop.run(key);
 const get=db.prepare('SELECT value FROM kv WHERE key=?'),put=db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
 const at=db.prepare("SELECT json_extract(value,'$.at') AS at FROM kv WHERE key=?");
 return {
  // Reads a cache row's timestamp without parsing megabytes of payload.
  at(key){return at.get(key)?.at??null},
  get(key,fallback=null){const row=get.get(key);return row?JSON.parse(row.value):fallback},set(key,value){put.run(key,JSON.stringify(value));return value},transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}},close(){db.close()}};
}
