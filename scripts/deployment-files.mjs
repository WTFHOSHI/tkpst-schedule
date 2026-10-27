// Print an allowlisted upload manifest. Never include .env, SQLite or screenshots.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const paths = ['package.json','package-lock.json','vercel.json'];
async function collect(dir) { for (const entry of await readdir(dir,{withFileTypes:true})) { const path=join(dir,entry.name).replaceAll('\\','/'); if(entry.isDirectory()) { if(entry.name!=='.data' && entry.name!=='test') await collect(path); } else if(!entry.name.startsWith('.') && !entry.name.endsWith('.sqlite')) paths.push(path); } }
for (const dir of ['api','server','scripts','web']) await collect(dir);
const files=[]; for(const file of paths) files.push({file,data:(await readFile(file)).toString('base64'),encoding:'base64'});
process.stdout.write(JSON.stringify(files));
