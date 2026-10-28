const {DOMParser,XMLSerializer}=require('../desktop/node_modules/@xmldom/xmldom');
const ns='http://wixtoolset.org/schemas/v4/wxs';
function configureMsiXml(source){
 const document=new DOMParser().parseFromString(source,'application/xml');
 const product=document.getElementsByTagNameNS(ns,'Product')[0],pkg=document.getElementsByTagNameNS(ns,'Package')[0];
 if(!product||!pkg)throw new Error('MSI product/package elements not found');
 product.setAttribute('Codepage','1256');pkg.setAttribute('SummaryCodepage','1256');
 const condition=document.getElementsByTagNameNS(ns,'Condition')[0];
 if(!condition)throw new Error('MSI operating system condition not found');
 condition.setAttribute('Message','Windows 10 or Windows 11 (64-bit) is required.');
 condition.textContent='Installed OR (VersionNT64 AND DAWA_OS_MAJOR = "#10")';
 const property=document.createElementNS(ns,'Property');property.setAttribute('Id','DAWA_OS_MAJOR');
 const registry=document.createElementNS(ns,'RegistrySearch');
 for(const [key,value] of Object.entries({Id:'DawaWindowsMajor',Root:'HKLM',Key:'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion',Name:'CurrentMajorVersionNumber',Type:'raw',Win64:'yes'}))registry.setAttribute(key,value);
 property.appendChild(registry);product.appendChild(property);
 return new XMLSerializer().serializeToString(document);
}
module.exports={configureMsiXml};
