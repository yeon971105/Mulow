// Windows DACLs are the privacy authority; stat.mode is only a POSIX assertion.
// Only explicitly supplied app-owned paths are inspected or protected. No recursive
// permission operation, global setting, provider access, or credential read occurs.
import {execFileSync} from 'node:child_process';
import {lstatSync} from 'node:fs';
import path from 'node:path';

let currentWindowsSid=null;
const script = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$targets=@($env:MULOW_PRIVATE_ACL_TARGETS | ConvertFrom-Json)
$snapshots=@()
foreach ($target in $targets) {
$item=Get-Item -LiteralPath $target -Force
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse_point' }
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=Get-Acl -LiteralPath $target
if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'foreign_owner' }
$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object {
  @{principal=$_.IdentityReference.Value;type=$_.AccessControlType.ToString();inheritOnly=(($_.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0)}
})
$snapshots+=@{owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;current=$sid.Value;directory=[bool]$item.PSIsContainer;rules=$rules}
}
ConvertTo-Json -InputObject $snapshots -Compress -Depth 5
`;

export function privateWindowsAcl(snapshot) {
 if(!snapshot||typeof snapshot.current!=='string'||!/^S-\d+(?:-\d+)+$/.test(snapshot.current)||snapshot.owner!==snapshot.current||typeof snapshot.directory!=='boolean'||!Array.isArray(snapshot.rules))return false;
 const trusted=new Set([snapshot.current,'S-1-5-18','S-1-5-32-544']);let ownerAllowed=false;
 for(const rule of snapshot.rules){
  if(!rule||typeof rule.principal!=='string'||!['Allow','Deny'].includes(rule.type)||typeof rule.inheritOnly!=='boolean')return false;
  if(rule.type!=='Allow'||rule.inheritOnly&&!snapshot.directory)continue;
  if(!trusted.has(rule.principal))return false;
  if(rule.principal===snapshot.current)ownerAllowed=true;
 }
 return ownerAllowed;
}

function windowsAcl(targets,action) {
 if(!Array.isArray(targets)||!targets.length||targets.length>97||action==='protect'&&targets.length!==1)throw Error('private_storage_unsafe_path');
 for(const target of targets){const info=lstatSync(target);if(info.isSymbolicLink()||!info.isFile()&&!info.isDirectory()||info.isFile()&&info.nlink!==1)throw Error('private_storage_unsafe_path');}
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 let result;
 try {
  const output=execFileSync(executable,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{
   windowsHide:true,timeout:10000,maxBuffer:8192,encoding:'utf8',
   env:{SystemRoot:process.env.SystemRoot||'C:\\Windows',PATH:process.env.PATH||'',MULOW_PRIVATE_ACL_TARGETS:JSON.stringify(targets.map(target=>path.resolve(target))),MULOW_PRIVATE_ACL_ACTION:action},
   stdio:['ignore','pipe','pipe'],
  });
  result=JSON.parse(output.replace(/^\uFEFF/,''));
 } catch { throw Error('private_storage_acl_unavailable'); }
 const snapshots=Array.isArray(result)?result:[result];
 if(snapshots.length!==targets.length||action!=='read'&&snapshots.some(snapshot=>!privateWindowsAcl(snapshot)))throw Error('private_storage_access_unconfirmed');
 currentWindowsSid=snapshots[0].current;
 return action==='read'?snapshots:true;
}

// A newly created empty wx file has no explicit access grants. Remove inherited
// grants before writing its payload. icacls avoids a PowerShell process on every
// record read; native DACL inspection still verifies the creation contract in QA.
export function protectNewPrivateFileSync(target) {
 if(process.platform!=='win32')return;
 const info=lstatSync(target);
 if(info.isSymbolicLink()||!info.isFile()||info.nlink!==1||info.size!==0||!currentWindowsSid)throw Error('private_storage_unsafe_path');
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','icacls.exe');
 try{execFileSync(executable,[path.resolve(target),'/inheritance:r','/grant:r','*'+currentWindowsSid+':F','*S-1-5-18:F','*S-1-5-32-544:F'],{windowsHide:true,timeout:10000,maxBuffer:8192,stdio:'pipe'});}
 catch{throw Error('private_storage_acl_unavailable');}
}

export function protectPrivatePathSync(target) {
 if(process.platform!=='win32')return;
 const [snapshot]=windowsAcl([target],'read');
 if(privateWindowsAcl(snapshot))return;
 const trusted=[snapshot.current,'S-1-5-18','S-1-5-32-544'],other=[...new Set(snapshot.rules.filter(rule=>rule.type==='Allow'&&!trusted.includes(rule.principal)).map(rule=>rule.principal))];
 if(other.some(sid=>!/^S-\d+(?:-\d+)+$/.test(sid)))throw Error('private_storage_access_unconfirmed');
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','icacls.exe'),resolved=path.resolve(target),inherit=snapshot.directory?'(OI)(CI)':'';
 const run=args=>execFileSync(executable,args,{windowsHide:true,timeout:10000,maxBuffer:8192,stdio:'pipe'});
 try{
  // DACL-only operations preserve owner/audit metadata and need no new privilege.
  run([resolved,'/inheritance:r','/grant:r',...trusted.map(sid=>'*'+sid+':'+inherit+'F')]);
  // Removing inheritance already drops inherited entries. Inspect the resulting
  // DACL before removing any remaining explicit grant, one SID per operation.
  const [restricted]=windowsAcl([target],'read');
  for(const sid of [...new Set(restricted.rules.filter(rule=>rule.type==='Allow'&&!trusted.includes(rule.principal)).map(rule=>rule.principal))]){
   if(!/^S-\d+(?:-\d+)+$/.test(sid))throw Error('private_storage_access_unconfirmed');
   run([resolved,'/remove:g','*'+sid]);
  }
 }catch{throw Error('private_storage_acl_unavailable');}
 windowsAcl([target],'inspect');
}

export function assertPrivatePathSync(target,{mode=0o600}={}) {
 if(process.platform==='win32')return windowsAcl([target],'inspect');
 const info=lstatSync(target);
 if(info.isSymbolicLink()||(info.mode&0o777)!==mode||typeof process.getuid==='function'&&info.uid!==process.getuid())throw Error('private_storage_access_unconfirmed');
 return true;
}

export function assertPrivatePathsSync(targets) {
 if(process.platform==='win32')return windowsAcl(targets,'inspect');
 for(const target of targets)assertPrivatePathSync(target,{mode:lstatSync(target).isDirectory()?0o700:0o600});
 return true;
}
