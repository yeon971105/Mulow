// Narrow, non-executing advisory. This is not a parser, security check, or proof
// that a project will run. Never include project contents in the result.
export function sourceAdvisories(files){
 if(!Array.isArray(files))return [];
 const warnings=[],entry=files.find(f=>['server/index.mjs','server/index.js','server.mjs'].includes(f?.path));
 if(entry&&typeof entry.content==='string'){
  const value=entry.content.match(/^\s*(?:const|let|var)\s+PORT\s*=\s*([0-9]{1,5})\s*;\s*$/m);
  const usesPort=/^\s*(?!\/\/|\/\*|\*)[^\n]*\.listen\s*\(\s*PORT\s*[,)]/m.test(entry.content);
  if(value&&usesPort&&Number(value[1])!==3001)warnings.push({code:'possible_fixed_backend_port',path:entry.path,port:Number(value[1]),expectedPort:3001});
 }
 const html=files.find(f=>f?.path==='index.html'),frontend=files.find(f=>['src/main.jsx','src/main.tsx','src/main.js'].includes(f?.path));
 if(typeof html?.content==='string'&&/<style(?:\s|>)/i.test(html.content)&&typeof frontend?.content==='string'&&!/\bimport\s*['"][^'"]+\.css['"]|\bimport\s+[^\n]*?from\s*['"][^'"]+\.css['"]/i.test(frontend.content))warnings.push({code:'possible_html_only_styles'});
 return warnings;
}
