import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const desktop=path.join(repo,'desktop'),require=createRequire(path.join(desktop,'package.json'));
const source=JSON.parse(await fs.readFile(path.join(desktop,'package.json'),'utf8'));
const releaseRoot=path.resolve(process.env.DAWA_RELEASE_ROOT||path.join(repo,'desktop','release'));
if(!process.env.WIX_TEMP)process.env.WIX_TEMP=path.join(releaseRoot,'wix-temp');
await fs.mkdir(process.env.WIX_TEMP,{recursive:true});
const appDir=path.join(releaseRoot,'staged-app');
await fs.mkdir(appDir,{recursive:true});
for(const folder of ['electron','dist'])await fs.cp(path.join(desktop,folder),path.join(appDir,folder),{recursive:true,dereference:true,filter:entry=>!entry.includes(path.sep+'test'+path.sep)&&path.basename(entry)!=='test'});
await fs.copyFile(path.join(repo,'shared','permissionCatalog.json'),path.join(appDir,'electron','permissionCatalog.json'));
await fs.mkdir(path.join(appDir,'electron','assets'),{recursive:true});
await fs.copyFile(path.join(desktop,'build','icon.ico'),path.join(appDir,'electron','assets','dawa.ico'));
const copied=new Set();
async function copyDependency(name,resolver){
 if(copied.has(name))return;
 const packageFile=resolver.resolve(name+'/package.json'),dir=path.dirname(packageFile),meta=JSON.parse(await fs.readFile(packageFile,'utf8'));
 copied.add(name);
 await fs.cp(dir,path.join(appDir,'node_modules',name),{recursive:true,dereference:true,filter:entry=>!path.relative(dir,entry).split(path.sep).includes('node_modules')});
 const local=createRequire(packageFile);
 for(const dependency of Object.keys(meta.dependencies||{}))await copyDependency(dependency,local);
}
await copyDependency('better-sqlite3',require);
const sqliteVersion=JSON.parse(await fs.readFile(require.resolve('better-sqlite3/package.json'),'utf8')).version;
await fs.writeFile(path.join(appDir,'package.json'),JSON.stringify({name:source.name,productName:source.productName,version:source.version,description:source.description,author:source.author,main:source.main,dependencies:{'better-sqlite3':sqliteVersion}},null,2));
const {build,Platform,Arch}=require('electron-builder');
const electronDist=path.join(path.dirname(require.resolve('electron/package.json')),'dist');
const version=(await fs.readFile(path.join(electronDist,'version'),'utf8')).trim();
const targets=process.argv.includes('--dir')?['dir']:process.argv.includes('--msi')?['msi']:['nsis','portable'];
const skipIce=process.argv.includes('--skip-ice');
const artifacts=await build({targets:Platform.WINDOWS.createTarget(targets,Arch.x64),config:{
 appId:'com.dawa.hospital',productName:'Dawa',executableName:'Dawa',
 electronVersion:version,electronDist,npmRebuild:false,asar:true,
 directories:{app:appDir,output:releaseRoot},
 files:['electron/**/*','dist/**/*','package.json','node_modules/**/*','!electron/test/**/*'],
 asarUnpack:['node_modules/better-sqlite3/build/Release/*.node'],
 win:{icon:path.join(desktop,'build','icon.ico'),artifactName:'Dawa-Setup-${version}-${arch}.${ext}',signAndEditExecutable:process.env.DAWA_SKIP_EXE_RESOURCES!=='1'},
 nsis:{oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:'دواء',installerLanguages:['ar-SA','en-US'],language:'1025',deleteAppDataOnUninstall:false},
 portable:{artifactName:'Dawa-Portable-${version}-${arch}.${ext}'},
 msi:{artifactName:'Dawa-Setup-${version}-${arch}.${ext}',oneClick:false,perMachine:false,createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:'دواء',additionalLightArgs:['-loc',path.join(repo,'scripts','msi-codepage.wxl'),...(skipIce?['-sval']:[])]},
 msiProjectCreated:async project=>{
  const {configureMsiXml}=require(path.join(repo,'scripts','msi-xml.cjs'));
  await fs.writeFile(project,configureMsiXml(await fs.readFile(project,'utf8')),'utf8');
 },
 }});
if(targets.includes('dir'))await fs.writeFile(path.join(releaseRoot,'win-unpacked','portable.json'),JSON.stringify({mode:'portable',dataDirectory:'DawaData',copyWholeFolder:true}));
console.log(JSON.stringify({releaseRoot,artifacts,dependencies:copied.size,includesHospitalData:false,msiIceValidated:targets.includes('msi')&&!skipIce}));
