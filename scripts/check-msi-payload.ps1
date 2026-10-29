param([Parameter(Mandatory=$true)][string]$TaskRoot,[string]$Version='1.1.0')
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $TaskRoot).Path
$release=Join-Path $root ('output\windows-'+$Version)
$wix=Join-Path $root 'work\builder-cache\wix\wix-4.0.0.5512.2'
$zip=Join-Path $root 'work\shelf-stock-sense\desktop\node_modules\7zip-bin\win\x64\7za.exe'
$expected=Join-Path $release 'win-unpacked'
$out=Join-Path $root ('work\verification\msi-payload-'+[guid]::NewGuid().ToString('N'))
[void][System.IO.Directory]::CreateDirectory($out)
[void][System.Reflection.Assembly]::LoadFrom((Join-Path $wix 'WixToolset.Dtf.WindowsInstaller.dll'))
$db=[WixToolset.Dtf.WindowsInstaller.Database]::new((Join-Path $release ('Dawa-Setup-'+$Version+'-x64.msi')),[WixToolset.Dtf.WindowsInstaller.DatabaseOpenMode]::ReadOnly)
$cabCount=0
try{
 $view=$db.OpenView('SELECT Name,Data FROM _Streams',@());$view.Execute()
 try{
  while($record=$view.Fetch()){
   try{
    $name=$record.GetString(1)
    if($name -notmatch '^cab[0-9]+\.cab$'){continue}
    $cab=Join-Path $out $name;$record.GetStream(2,$cab)
    & $zip t $cab | Out-Null
    if($LASTEXITCODE -ne 0){throw ('Cabinet integrity failed: '+$name)}
    & $zip x $cab ('-o'+(Join-Path $out 'files')) -y | Out-Null
    if($LASTEXITCODE -ne 0){throw ('Cabinet extraction failed: '+$name)}
    $cabCount++
   }finally{$record.Dispose()}
  }
 }finally{$view.Dispose()}
 if($cabCount -ne 2){throw 'Expected two embedded cabinet streams'}
 $sourceFiles=Get-ChildItem -LiteralPath $expected -Recurse -File
 $files=$db.OpenView('SELECT File,FileName,FileSize FROM File',@());$files.Execute();$checked=0
 try{
  while($record=$files.Fetch()){
   try{
    $id=$record.GetString(1);$name=($record.GetString(2) -split '\|')[-1]
    $candidate=@($sourceFiles | Where-Object {$_.Name -eq $name})
    if($candidate.Count -ne 1){throw ('Ambiguous or missing expected payload: '+$name)}
    $unpacked=Join-Path (Join-Path $out 'files') $id
    if((Get-Item -LiteralPath $unpacked).Length -ne [long]$record.GetString(3)){throw ('Size mismatch: '+$name)}
    if((Get-FileHash -LiteralPath $unpacked -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $candidate[0].FullName -Algorithm SHA256).Hash){throw ('Payload hash mismatch: '+$name)}
    $checked++
   }finally{$record.Dispose()}
  }
 }finally{$files.Dispose()}
 if($checked -ne 100){throw ('Unexpected installer file count: '+$checked)}
 [pscustomobject]@{filesHashCompared=$checked;embeddedCabinetsTested=$cabCount;installerExecuted=$false;readOnlyExtraction=$true;output=$out}|ConvertTo-Json
}finally{$db.Dispose()}
