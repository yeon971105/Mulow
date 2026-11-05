export const WORK_KINDS=Object.freeze({code:{icon:'code',label:'Code'},document:{icon:'document',label:'Document'},frontend:{icon:'monitor',label:'Frontend'},backend:{icon:'server',label:'Backend'},database:{icon:'database',label:'Database'},research:{icon:'search',label:'Research'},test:{icon:'shield',label:'Test'},plan:{icon:'graph',label:'Plan'},work:{icon:'layers',label:'Work'}});
export function workKind(task){
 if(WORK_KINDS[task.kind])return {...WORK_KINDS[task.kind],kind:task.kind,source:'declared'};
 const text=[task.title,task.text,task.role].filter(Boolean).join(' ');
 const rules=[['database',/\b(database|sql|schema|migration|db)\b|데이터베이스/i],['frontend',/\b(frontend|front.end|interface|ui|ux|css)\b|프론트|화면/i],['backend',/\b(backend|back.end|api|server|endpoint)\b|백엔드|서버/i],['test',/\b(test|verify|validation|regression|qa|review)\b|검증|테스트/i],['research',/\b(research|investigate|inspect|search|diagnose)\b|조사|검색|진단/i],['plan',/\b(plan|roadmap|blueprint|outline)\b|계획|플랜|청사진/i],['document',/\b(document|documentation|report|readme|proposal)\b|문서|보고서/i],['code',/\b(code|implement|build|refactor|fix|debug)\b|코드|구현|수정|디버깅/i]];
 const kind=rules.find(([,r])=>r.test(text))?.[0]||'work';return {...WORK_KINDS[kind],kind,source:kind==='work'?'unknown':'title_hint'};
}
