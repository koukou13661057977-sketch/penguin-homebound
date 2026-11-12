import {STATIC_COPY} from './copy-static.js';
import {WORLD_COPY} from './copy-world.js';
import {GAME_COPY} from './copy-game.js';
import {BOOTH_COPY} from './copy-booth.js';
import {COAST_COPY} from './copy-coast.js';

let language='zh';
export const GAME_LANGUAGES=Object.freeze(['zh','zh-Hant','en']);
const LANGUAGE_TAGS={zh:'zh-Hans','zh-Hant':'zh-Hant',en:'en'};
const entries=[...STATIC_COPY,...WORLD_COPY,...GAME_COPY,...BOOTH_COPY,...COAST_COPY];
const exact=new Map(entries.map(row=>[row[0],row]));
const sourceKeys=new Map(entries.map(row=>[row[0],row[0]]));
for(const row of exact.values())for(const value of row.slice(1))if(!sourceKeys.has(value))sourceKeys.set(value,row[0]);
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const templates=entries.filter(([source])=>/\{\d+\}/.test(source)).map(row=>{
 const ids=[];let pattern='',last=0;
 for(const match of row[0].matchAll(/\{(\d+)\}/g)){pattern+=escape(row[0].slice(last,match.index))+'(.*?)';ids.push(match[1]);last=match.index+match[0].length;}
 pattern+=escape(row[0].slice(last));return {row,ids,re:new RegExp('^'+pattern+'$','u'),weight:row[0].replace(/\{\d+\}/g,'').length};
}).sort((a,b)=>b.weight-a.weight);
export const getLanguage=()=>language;
export function setLanguage(value){language=GAME_LANGUAGES.includes(value)?value:'zh';return language;}
export function tr(value,locale=language,depth=0){
 const source=String(value??'');if(!source||depth>8)return source;
 const index=locale==='en'?2:locale==='zh-Hant'?3:1,row=exact.get(source);if(row&&!/\{\d+\}/.test(source))return row[index];
 for(const template of templates){const match=template.re.exec(source);if(!match)continue;const values={};template.ids.forEach((id,i)=>values[id]=match[i+1]);return template.row[index].replace(/\{(\d+)\}/g,(_,id)=>tr(values[id]??'',locale,depth+1));}
 return source;
}

let documentRef,staticNodes=[],staticAttrs=[];
export function initLanguage(preferred='zh',doc=globalThis.document){
 documentRef=doc;setLanguage(doc?.documentElement?.dataset?.defaultLanguage==='en'?'en':preferred);staticNodes=[];staticAttrs=[];
 if(doc?.createTreeWalker){
  const walker=doc.createTreeWalker(doc.documentElement,4);let node;
  while((node=walker.nextNode())){
   if(['SCRIPT','STYLE','NOSCRIPT'].includes(node.parentElement?.tagName))continue;
   const source=node.nodeValue,trimmed=source.trim(),key=sourceKeys.get(trimmed);if(!key)continue;
   staticNodes.push({node,source,trimmed,key});
  }
  for(const element of doc.querySelectorAll('[aria-label], [title], meta[name="description"]'))for(const name of ['aria-label','title','content']){
   const source=element.getAttribute(name),key=sourceKeys.get(source);if(source&&key)staticAttrs.push({element,name,source:key});
  }
 }
 applyLanguage();return language;
}
export function applyLanguage(){
 if(documentRef?.documentElement){documentRef.documentElement.lang=LANGUAGE_TAGS[language];documentRef.documentElement.setAttribute?.('data-language',language);}
 for(const {node,source,trimmed,key}of staticNodes)if(node.isConnected!==false)node.nodeValue=source.replace(trimmed,()=>tr(key));
 for(const {element,name,source}of staticAttrs)element.setAttribute(name,tr(source));
 const picker=documentRef?.getElementById?.('language');if(picker)picker.value=language;
}
