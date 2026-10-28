const assert=require('node:assert/strict');
const {test}=require('node:test');
const {DOMParser}=require('../desktop/node_modules/@xmldom/xmldom');
const {configureMsiXml}=require('./msi-xml.cjs');
const ns='http://wixtoolset.org/schemas/v4/wxs';
const source=`<Wix xmlns="${ns}"><Product Name="Dawa" Version="1.1.0.0"><Package/><Condition>VersionNT64</Condition><Shortcut Name="دواء"/></Product></Wix>`;
const parse=text=>new DOMParser().parseFromString(text,'application/xml');
test('sets Arabic MSI codepages without changing product or shortcut identity',()=>{
 const doc=parse(configureMsiXml(source));
 const product=doc.getElementsByTagNameNS(ns,'Product')[0],pkg=doc.getElementsByTagNameNS(ns,'Package')[0];
 assert.equal(product.getAttribute('Codepage'),'1256');assert.equal(pkg.getAttribute('SummaryCodepage'),'1256');
 assert.equal(product.getAttribute('Version'),'1.1.0.0');assert.equal(doc.getElementsByTagNameNS(ns,'Shortcut')[0].getAttribute('Name'),'دواء');
});
test('requires a 64-bit Windows 10 family registry major version and permits maintenance',()=>{
 const doc=parse(configureMsiXml(source));
 assert.equal(doc.getElementsByTagNameNS(ns,'Condition')[0].textContent,'Installed OR (VersionNT64 AND DAWA_OS_MAJOR = "#10")');
 const registry=doc.getElementsByTagNameNS(ns,'RegistrySearch')[0];
 assert.equal(registry.getAttribute('Root'),'HKLM');assert.equal(registry.getAttribute('Type'),'raw');assert.equal(registry.getAttribute('Win64'),'yes');
 assert.equal(registry.getAttribute('Name'),'CurrentMajorVersionNumber');
});
test('rejects unexpected WiX templates instead of silently emitting unchecked metadata',()=>{
 assert.throws(()=>configureMsiXml(`<Wix xmlns="${ns}"/>`),/product\/package/);
 assert.throws(()=>configureMsiXml(`<Wix xmlns="${ns}"><Product><Package/></Product></Wix>`),/operating system/);
});
