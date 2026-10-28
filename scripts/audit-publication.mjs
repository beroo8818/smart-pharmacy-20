import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const result=spawnSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:repo,encoding:'utf8'});
if(result.status!==0)throw new Error('Cannot enumerate publication files');
const files=[...new Set(result.stdout.split('\0').filter(Boolean))],findings=[];
for(const name of files){
 const file=path.join(repo,name);if(!fs.existsSync(file))continue;
 if((/(^|\/)\.env/.test(name)&&path.basename(name)!=='.env.example')||/(^|\/)(DawaData|backups)\//i.test(name)||/\.(db(?:-.*)?|sqlite\d*(?:-.*)?|xlsx?|xlsm|msi|exe|zip|asar)$/i.test(name))findings.push({file:name,kind:'private data or generated artifact'});
 const bytes=fs.readFileSync(file);if(bytes.subarray(0,8192).includes(0))continue;
 const lines=bytes.toString('utf8').split(/\r?\n/);
 for(let index=0;index<lines.length;index++){
  const line=lines[index];
  if(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sb_secret_[A-Za-z0-9_-]{20,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{25,})\b/.test(line)||/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line)||/postgres(?:ql)?:\/\/[^\s/:]+:[^\s/@]+@/i.test(line))findings.push({file:name,line:index+1,kind:'possible credential'});
  for(const jwt of line.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g))try{if(JSON.parse(Buffer.from(jwt[0].split('.')[1],'base64url')).role==='service_role')findings.push({file:name,line:index+1,kind:'service role token'});}catch{}
 }
}
console.log(JSON.stringify({filesChecked:files.length,findings,scope:'tracked and nonignored source files; heuristic scan, not a security certification'}));
if(findings.length)process.exitCode=1;
