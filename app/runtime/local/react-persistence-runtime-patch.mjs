import{PERSISTENCE_RUNTIME_PATCH_ID}from'../web/react-persistence-compatibility.js';
// Exact reviewed 2427 -> layout-tolerant exact write admission correction only.
// Prior transition audit rows remain immutable; no direct earlier-version shortcut; bridgeDigest now closes over admission bytes.
const oldPolicy=Object.freeze({
  "contractDigest": "91500df3cbf3d653c9e19acd90d7c4c386197c3af0baf63f3c0c4cec2385bfd5",
  "policyDigest": "51dc5b25d52753db2d3886fc7d6f13cfbeb07438138b6870aeb4a3905ae7b601",
  "parserDigest": "b54b3bb239c5898c27c466a83d0ad176d8afe476b4cfdcfd66a985a4ab3d2510",
  "compilerDigest": "ec9689746a7ec9a3a76f9243c0e98fbd42f8cef5bde615ae74fd34b3b433f158",
  "toolchainDigest": "0bb277cfe80ef52b1923c192bf993b9166f02cda052dc963f869efee5ac2a862",
  "wrapperDigest": "fcbe017335d49c025430a59af5c29c4274af663a05e57ed9c34bf27244d69cde",
  "frameDigest": "0ce2c3240c7247812d9aae0e3ea55a7389faf57f11ec4e2df28617e5336f1cb3",
  "dataRuntimeDigest": "39f293d57bdc1d6911093747c31db07b811036d50aaeba88716eadb5bd83ffcd",
  "runtimeDigest": "9b36dab8ce8284f9dad16d225ac49780cfc555d8e186cfdbb1482a7b5668fef7",
  "bridgeDigest": "c29e97f6388aa530b58f225b2a7da0190ef39c9272d954cfc3babcd1162cd85d"
});
const newPolicy=Object.freeze({
  "contractDigest": "91500df3cbf3d653c9e19acd90d7c4c386197c3af0baf63f3c0c4cec2385bfd5",
  "policyDigest": "51dc5b25d52753db2d3886fc7d6f13cfbeb07438138b6870aeb4a3905ae7b601",
  "parserDigest": "b54b3bb239c5898c27c466a83d0ad176d8afe476b4cfdcfd66a985a4ab3d2510",
  "compilerDigest": "ec9689746a7ec9a3a76f9243c0e98fbd42f8cef5bde615ae74fd34b3b433f158",
  "toolchainDigest": "0bb277cfe80ef52b1923c192bf993b9166f02cda052dc963f869efee5ac2a862",
  "wrapperDigest": "fcbe017335d49c025430a59af5c29c4274af663a05e57ed9c34bf27244d69cde",
  "frameDigest": "0ce2c3240c7247812d9aae0e3ea55a7389faf57f11ec4e2df28617e5336f1cb3",
  "dataRuntimeDigest": "39f293d57bdc1d6911093747c31db07b811036d50aaeba88716eadb5bd83ffcd",
  "runtimeDigest": "9b36dab8ce8284f9dad16d225ac49780cfc555d8e186cfdbb1482a7b5668fef7",
  "bridgeDigest": "5533daff24cf9d5d43f869f4df52488eca4cd0957fa1859db3b50c43ecacaeaa"
});
export function approvedReactPersistenceTransition(current){return JSON.stringify(current)===JSON.stringify(newPolicy)?{patchId:PERSISTENCE_RUNTIME_PATCH_ID,oldPolicy,newPolicy}:null;}
