// Conservative render-only HTML/CSS rendition. No filesystem, network or execution.
const fail=code=>{throw Error(code);};
const MAX_BYTES=1_000_000,MAX_STYLESHEETS=32;
const warnings=['JavaScript and storage are disabled in this static view.','Images, fonts, media and external resources are unavailable.'];
function cssPath(href,entry){
 if(typeof href!=='string'||!href||/[^A-Za-z0-9_.@+/-]/.test(href)||href.startsWith('/')||!href.endsWith('.css'))fail('static_stylesheet_path_unsupported');
 const parts=entry.split('/').slice(0,-1);
 for(const part of href.split('/')){if(!part)fail('static_stylesheet_path_unsupported');if(part==='.')continue;if(part==='..'){if(!parts.length)fail('static_stylesheet_path_unsupported');parts.pop();}else parts.push(part);}
 return parts.join('/');
}
function stylesheetAttributes(tag){
 const inner=tag.replace(/^<link\b/i,'').replace(/\/?\s*>$/,'');let rest=inner;const attrs=new Map();
 while(rest.trim()){
  const match=/^\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(["'])([^"'<>]*)\2/.exec(rest);
  if(!match)fail('static_link_syntax_unsupported');const name=match[1].toLowerCase();if(attrs.has(name))fail('static_link_syntax_unsupported');attrs.set(name,match[3]);rest=rest.slice(match[0].length);
 }
 if(!attrs.has('rel'))fail('static_link_syntax_unsupported');
 if(attrs.get('rel').toLowerCase()!=='stylesheet'){
  if(/stylesheet|[&\\]/i.test(attrs.get('rel')))fail('static_link_syntax_unsupported');return null;
 }
 if(attrs.size!==2||!attrs.has('href'))fail('static_link_syntax_unsupported');return attrs.get('href');
}
function checkedCSS(css){
 if(typeof css!=='string'||/[\\<\x00]/.test(css))fail('static_stylesheet_content_unsupported');
 const plain=css.replace(/\/\*[\s\S]*?\*\//g,'');
 if(plain.includes('/*')||/@import\b|\burl\s*\(|\b(?:image-set|src)\s*\(|@font-face\b/i.test(plain))fail('static_stylesheet_content_unsupported');
 return css;
}
export function compileStaticSource(source,entryPath){
 if(!source||!Array.isArray(source.files)||!Array.isArray(source.entrypoints))fail('static_source_invalid');
 const files=new Map();for(const file of source.files){if(!file||typeof file.path!=='string'||typeof file.content!=='string'||files.has(file.path))fail('static_source_invalid');files.set(file.path,file.content);}
 const entries=source.entrypoints.filter(e=>e&&typeof e.path==='string'&&e.path.endsWith('.html')&&files.has(e.path)).map(e=>({path:e.path,purpose:e.purpose}));
 if(!entries.length)fail('static_html_entry_required');
 if(entryPath===undefined||entryPath===null||entryPath===''){if(entries.length!==1)return {status:'entry_required',entrypoints:entries};entryPath=entries[0].path;}
 if(!entries.some(e=>e.path===entryPath))fail('static_entry_not_declared');
 const html=files.get(entryPath),inlinedFiles=[];let count=0;
 // Skip raw script/style text and comments. Only a deliberately narrow, quoted link form is supported.
 const token=/<!--[\s\S]*?(?:-->|$)|<(script|style)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<link\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
 const compiled=html.replace(token,tag=>{
  if(!/^<link\b/i.test(tag))return tag;const href=stylesheetAttributes(tag);if(href===null)return tag;
  if(++count>MAX_STYLESHEETS)fail('static_stylesheet_limit');const path=cssPath(href,entryPath);if(!files.has(path))fail('static_stylesheet_missing');const css=checkedCSS(files.get(path));inlinedFiles.push(path);return '<style>'+css+'</style>';
 });
 // Any unmatched stylesheet link is unsupported, not silently claimed as rendered.
 const residual=compiled.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>/gi,'');
 if(/<link\b[^>]*(?:stylesheet|&|\\)/i.test(residual))fail('static_link_syntax_unsupported');
 if(Buffer.byteLength(compiled)>MAX_BYTES)fail('static_compiled_size_limit');
 return {entryPath,html:compiled,inlinedFiles,warnings:[...warnings,...(source.dependencies?.length?['Declared dependencies are not installed or executed.']:[])]};
}
