param([Parameter(Mandatory=$true)][string]$Path,[string]$ExpectedVersion='1.1.0.0')
$ErrorActionPreference='Stop'
$installer=New-Object -ComObject WindowsInstaller.Installer
$database=$installer.OpenDatabase((Resolve-Path -LiteralPath $Path).Path,0)
function Read-Table([string]$Query,[int]$Columns){
 $view=$database.OpenView($Query);$null=$view.Execute()
 $rows=@()
 try{
  while($record=$view.Fetch()){
   $values=@()
   for($i=1;$i -le $Columns;$i++){$values+=$record.StringData($i)}
   $rows+=,@($values)
  }
 }finally{$null=$view.Close()}
 return ,$rows
}
$properties=@{}
foreach($row in (Read-Table 'SELECT Property,Value FROM Property' 2)){$properties[$row[0]]=$row[1]}
if($properties.ProductName -ne 'Dawa' -or $properties.ProductVersion -ne $ExpectedVersion){throw 'Unexpected product metadata'}
if($properties.MSIINSTALLPERUSER -ne '1'){throw 'Installer is not configured per user'}
$shortcuts=Read-Table 'SELECT Name,Directory_ FROM Shortcut' 2
if(!($shortcuts | Where-Object {$_[0] -like '*دواء*' -and $_[1] -eq 'DesktopFolder'})){throw 'Arabic desktop shortcut missing'}
if(!($shortcuts | Where-Object {$_[0] -like '*دواء*' -and $_[1] -eq 'ProgramMenuFolder'})){throw 'Arabic Start menu shortcut missing'}
$files=Read-Table 'SELECT FileName,FileSize FROM File' 2
foreach($required in @('Dawa.exe','app.asar','better_sqlite3.node')){
 if(!($files | Where-Object {($_[0] -split '\|')[-1] -eq $required})){throw "Missing installer file: $required"}
}
if($files | Where-Object {$_[0] -match '\.(db|sqlite|xlsx?|env)$'}){throw 'User data found in installer'}
$media=Read-Table 'SELECT Cabinet FROM Media' 1
if(!$media.Count -or ($media | Where-Object {$_[0] -notlike '#*'})){throw 'Installer depends on external cabinet files'}
$conditions=Read-Table 'SELECT Condition FROM LaunchCondition' 1
if(!($conditions | Where-Object {$_[0] -like '*DAWA_OS_MAJOR*'})){throw 'Windows 10/11 condition missing'}
[pscustomobject]@{product=$properties.ProductName;version=$properties.ProductVersion;files=$files.Count;shortcuts=$shortcuts.Count;embeddedCabinets=$media.Count;perUser=$true;includesHospitalData=$false;readOnlyDatabaseValidation=$true;fullIceValidation=$false}|ConvertTo-Json
