import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSQLiteStore } from '../sqlite-store.mjs';
import { createAccounts } from '../accounts.mjs';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresStore,migratePostgres } from '../postgres-store.mjs';
for(const backend of ['SQLite','Postgres'])test(backend+': in-flight old password cannot establish a session after reset',async t=>{
 let store;
 if(backend==='SQLite'){
  const dir=await mkdtemp(join(tmpdir(),'tkpst-reset-'));store=createSQLiteStore(join(dir,'db.sqlite'));
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 }else{
  const db=new PGlite();t.after(()=>db.close());
  const driver={query:async(text,params)=>(await db.query(text,params)).rows,transaction:statements=>db.transaction(async tx=>{const results=[];for(const s of statements)results.push((await tx.query(s.text,s.params)).rows);return results;})};
  await migratePostgres(driver);store=createPostgresStore(driver);
 }
 const accounts=await createAccounts({store});
 await accounts.register({username:'race_student',displayName:'Студент',password:'old-password'});
 let started,proceed;
 const waiting=new Promise(resolve=>started=resolve);const gate=new Promise(resolve=>proceed=resolve);
 const blocked=await createAccounts({store:{...store,createSession:async(...args)=>{started();await gate;return store.createSession(...args);}}});
 const login=blocked.login({username:'race_student',password:'old-password'});
 const rejected=assert.rejects(login,error=>error.status===401);
 await waiting;await accounts.resetPassword({username:'race_student',password:'new-password'});proceed();await rejected;
 assert.ok((await accounts.login({username:'race_student',password:'new-password'})).token);
});
