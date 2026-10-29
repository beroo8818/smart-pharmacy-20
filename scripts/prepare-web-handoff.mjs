import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.argv[2])throw new Error('Supply the output directory');
const out=path.resolve(process.argv[2]),source=path.join(repo,'supabase','migrations');
await fs.mkdir(out,{recursive:true});
const files=(await fs.readdir(source)).filter(name=>name.endsWith('.sql')).sort();
const pending=files.filter(name=>/^202610(?:28|29)/.test(name));
if(pending.length!==7)throw new Error('Expected seven pending migrations');
const manifest=[];
for(const name of files){
 const relative=path.join(pending.includes(name)?'pending-review':'baseline-reference',name);
 const bytes=await fs.readFile(path.join(source,name));
 await fs.mkdir(path.dirname(path.join(out,relative)),{recursive:true});
 await fs.writeFile(path.join(out,relative),bytes);
 manifest.push({file:relative.replaceAll(path.sep,'/'),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
for(const [from,to] of [['scripts/web-preflight.sql','READ-ONLY-preflight.sql'],['docs/network-handoff.ar.md','NETWORK-ar.md'],['docs/web-database-handoff.ar.md','START-HERE-ar.md']])await fs.copyFile(path.join(repo,from),path.join(out,to));
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({liveDatabaseChanged:false,containsCredentials:false,migrationFiles:manifest},null,2));
console.log(JSON.stringify({output:out,migrations:manifest.length,pendingReview:pending.length,liveDatabaseChanged:false}));
