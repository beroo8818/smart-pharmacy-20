const fs=require('fs');
const path=require('path');
function configureRuntime(app,env=process.env){
 if(!app.isPackaged)return {portable:false,dataDir:app.getPath('userData')};
 const exeDir=path.dirname(app.getPath('exe'));
 const portableDir=env.PORTABLE_EXECUTABLE_DIR||(fs.existsSync(path.join(exeDir,'portable.json'))?exeDir:null);
 const dataDir=portableDir?path.join(path.resolve(portableDir),'DawaData'):path.join(app.getPath('appData'),'Dawa');
 fs.mkdirSync(dataDir,{recursive:true});
 fs.accessSync(dataDir,fs.constants.R_OK|fs.constants.W_OK);
 app.setPath('userData',dataDir);
 const sessionDir=path.join(dataDir,'browser-cache');fs.mkdirSync(sessionDir,{recursive:true});
 app.setPath('sessionData',sessionDir);
 app.setAppUserModelId('com.dawa.hospital');
 return {portable:!!portableDir,dataDir};
}
module.exports={configureRuntime};
