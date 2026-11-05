import {createHash} from 'node:crypto';
import {compileStaticSource} from './static-source-compiler.mjs';
// A render-only view, not a JavaScript runtime or replacement for Docker isolation.
export const STATIC_SOURCE_CSP="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; frame-src about:; child-src about:; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; sandbox; frame-ancestors 'self'";
const attr=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function selectedStaticSource(externalSource,{sessionId,revision,entryPath}){
 const state=externalSource.list({sessionId});if(!revision||state.currentRevision!==revision)throw Error('static_source_stale');
 const record=externalSource.export({sessionId,revision});return compileStaticSource(record.source,entryPath);
}
export function reviewStaticSource(externalSource,input){
 const compiled=selectedStaticSource(externalSource,input);if(compiled.status==='entry_required')return {status:'entry_required',revision:input.revision,entrypoints:compiled.entrypoints};
 const view=renderStaticHTML(compiled.html);return {status:'review',revision:input.revision,entryPath:compiled.entryPath,inlinedFiles:compiled.inlinedFiles,warnings:compiled.warnings,derivedDigest:createHash('sha256').update(JSON.stringify(view)).digest('hex'),url:'/api/external-source/preview?'+new URLSearchParams({sessionId:input.sessionId,revision:input.revision,entryPath:compiled.entryPath}),execution:'not_run',tests:'not_run'};
}
export function renderStaticSource(externalSource,input){
 const compiled=selectedStaticSource(externalSource,input);if(compiled.status==='entry_required')throw Error('static_entry_required');
 return {revision:input.revision,...renderStaticHTML(compiled.html)};
}
export function renderStaticHTML(html){
 if(typeof html!=='string')throw Error('static_html_required');
 // The trusted outer document restricts navigation of its nested frame to about:.
 // Opaque sandbox + script-src none apply even if imported markup changes its own CSP.
 // Resource-hint/header tags are omitted from this display-only rendition; source bytes stay immutable.
 const content=html.replace(/<(?:meta|link|base)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,'');
 const inner='<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; frame-src &#39;none&#39;; connect-src &#39;none&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;; object-src &#39;none&#39;">'+content;
 return {html:'<!doctype html><meta charset="utf-8"><title>Static source view</title><style>html,body{margin:0;height:100%;background:white}iframe{display:block;width:100%;height:100%;border:0}</style><iframe title="Static HTML · scripts and storage disabled" sandbox="" referrerpolicy="no-referrer" srcdoc="'+attr(inner)+'"></iframe>',headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':STATIC_SOURCE_CSP,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-DNS-Prefetch-Control':'off','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()'}};
}
