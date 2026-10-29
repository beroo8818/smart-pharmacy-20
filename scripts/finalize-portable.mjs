import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.argv[2])throw new Error('Supply the task root');
const root=path.resolve(process.argv[2]);
const version=JSON.parse(await fs.readFile(path.join(repo,'desktop','package.json'),'utf8')).version;
const release=path.resolve(process.env.DAWA_RELEASE_ROOT||path.join(root,'output','windows-'+version)),name='Dawa-Portable-'+version,destination=path.join(release,name);
const archive=path.join(release,name+'.zip');
try{await fs.access(archive);throw new Error('Archive already exists; use a new release name rather than merging archives');}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.cp(path.join(release,'win-unpacked'),destination,{recursive:true,dereference:true,filter:entry=>!path.relative(path.join(release,'win-unpacked'),entry).split(path.sep).includes('DawaData')});
await fs.writeFile(path.join(destination,'portable.json'),JSON.stringify({mode:'portable',dataDirectory:'DawaData',copyWholeFolder:true}));
await fs.mkdir(path.join(destination,'DawaData'),{recursive:true});
await fs.copyFile(path.join(repo,'docs','windows-delivery.ar.md'),path.join(destination,'START-HERE-ar.txt'));
await fs.copyFile(path.join(repo,'docs','network-handoff.ar.md'),path.join(destination,'NETWORK-ar.txt'));
await fs.copyFile(path.join(repo,'docs','screen-parity.ar.md'),path.join(destination,'SCREENS-ar.txt'));
await fs.copyFile(path.join(repo,'docs','item-dictionary.ar.md'),path.join(destination,'NEW-ITEMS-ar.txt'));
await fs.copyFile(path.join(root,'output','pdf','dawa-workflows-ar.pdf'),path.join(destination,'Dawa-Guide-ar.pdf'));
async function verify(dir){
 for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);
  if(entry.isSymbolicLink())throw new Error('Portable archive cannot contain junctions or symlinks');
  if(entry.isDirectory())await verify(file);
  else if(/\.(db|sqlite|xlsx?|env)$/i.test(entry.name))throw new Error('Unexpected user data in distribution: '+entry.name);
 }
}
await verify(destination);
const zip=path.join(repo,'..','desktop','node_modules','7zip-bin','win','x64','7za.exe');
const result=spawnSync(zip,['a','-tzip','-mx=5',archive,name],{cwd:release,stdio:'inherit'});
if(result.status!==0)throw new Error('Portable ZIP creation failed');
const check=spawnSync(zip,['t',archive],{stdio:'inherit'});
if(check.status!==0)throw new Error('Portable ZIP verification failed');
const sha256=crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
const installer=path.join(release,`Dawa-Setup-${version}-x64.msi`);
let setup=null;
try{const bytes=await fs.readFile(installer);setup={file:path.basename(installer),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),installationVerified:false,uninstallationVerified:false,fullIceValidation:false};}catch(e){if(e.code!=='ENOENT')throw e;}
const manifest={version,archive:path.basename(archive),bytes:(await fs.stat(archive)).size,sha256,platform:'Windows 10/11 x64',hospitalDataIncluded:false,setupInstallerBuilt:!!setup,installer:setup};
await fs.writeFile(path.join(release,'portable-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest));
