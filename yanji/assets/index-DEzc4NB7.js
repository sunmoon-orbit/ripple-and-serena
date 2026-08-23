var pt=Object.defineProperty;var ct=(e,t,i)=>t in e?pt(e,t,{enumerable:!0,configurable:!0,writable:!0,value:i}):e[t]=i;var g=(e,t,i)=>ct(e,typeof t!="symbol"?t+"":t,i);import{_ as ft}from"./index-B9nUpQxo.js";function Ai(...e){return e.filter(Boolean).join(" ")}var Ze=null;function gt(e){Ze=e}function Xe(){return Ze}function mt(e){let t=new Map;for(let i in e){let n=e[i];if(n)for(let r of n){let s=t.get(r.w);(s===void 0||r.f>s)&&t.set(r.w,r.f)}}return t}function yt(e){let t=new Map;for(let i in e){let n=e[i];if(n)for(let r of n){let s=t.get(r.w);s?s.push(i):t.set(r.w,[i])}}return t}function Le(){return{children:new Map,keysUnderPrefix:[]}}function _t(e){let t=Le();for(let i in e){if(!e[i])continue;let n=t;n.keysUnderPrefix.push(i);for(let r of i){let s=n.children.get(r);s||(s=Le(),n.children.set(r,s)),n=s,n.keysUnderPrefix.push(i)}}return t}function vt(e,t){let i=e;for(let n of t)if(i=i.children.get(n),!i)return[];return i.keysUnderPrefix}var ke=new WeakMap;function bt(e){let t=e,i=mt(t),n=yt(t),r=_t(t),s=new Map,o=new Set(Object.keys(t).filter(h=>/^[a-z]{1,6}$/.test(h)&&/[aeiouv]/.test(h)));function a(h){let u=new Map;for(let p of h)for(let d of p){let f=u.get(d.w);(f===void 0||d.f>f)&&u.set(d.w,d.f)}return Array.from(u.entries()).sort((p,d)=>d[1]-p[1]).map(([p,d])=>({w:p,f:d}))}function l(h){let u=s.get(h);if(u)return u;let p=[],d=t[h];if(d)p.push(d);else{let v=vt(r,h);for(let E of v){let y=t[E];y&&p.push(y)}}let f=a(p);return s.set(h,f),f}function $(h){return n.get(h)??[]}function b(h){let u=new Map,p=d=>{if(d===h.length)return[];let f=u.get(d);if(f!==void 0)return f;for(let v=Math.min(h.length,d+6);v>d;v--){let E=h.substring(d,v);if(!o.has(E))continue;let y=p(v);if(y){let L=[E,...y];return u.set(d,L),L}}return u.set(d,null),null};return p(0)}function c(h,u){if(h.startsWith(u))return u.length;let p=b(u);if(!p)return 0;let d=0,f=(v,E)=>{if(E>d&&(d=E),v>=p.length||E>=h.length)return;let y=p[v];h.startsWith(y,E)&&f(v+1,E+y.length),h[E]===y[0]&&f(v+1,E+1)};return f(0,0),d}function w(h,u){if(!h||!u)return 0;let p=0,d=0;for(;p<h.length&&d<u.length;){let f=h[p];for(;d<u.length&&u[d]!==f;)d+=1;if(d>=u.length)break;p+=1,d+=1}return p}function A(h,u,p,d){let f=u.get(p);if(f===void 0){u.set(p,h.length),h.push({word:p,matchedLength:d});return}d>h[f].matchedLength&&(h[f]={...h[f],matchedLength:d})}function M(h){return i.get(h)??0}function U(h,u){let p=u<=2,d=f=>{let v=M(f.word);return p&&f.word.length===1&&(v+=5e4),v};return[...h].sort((f,v)=>v.matchedLength!==f.matchedLength?v.matchedLength-f.matchedLength:d(v)-d(f))}function m(h,u){if(u>2||h.length===0)return h;let p=h.slice(0,Math.min(h.length,10)),d=p.filter(L=>L.word.length===1).length;if(d>=2)return h;let f=2-d,v=h.slice(p.length).filter(L=>L.word.length===1).slice(0,f);if(v.length===0)return h;let E=[...h];for(let L of v){let R=E.indexOf(L);R>=0&&E.splice(R,1)}let y=Math.min(E.length,Math.max(2,d));return E.splice(y,0,...v),E}function x(h,u,p){let d=u.toLowerCase().replace(/'/g,"");if(!d)return 0;let f=p,v=$(h);for(let E of v){let y=Math.max(c(d,E),w(d,E));y>f&&(f=y)}return f}function I(h){if(!h)return{candidates:[]};let u=h.toLowerCase().replace(/'/g,""),p=[],d=new Map,f=l(u);for(let{w:y}of f)A(p,d,y,u.length);if(u.length>=2)for(let y=1;y<u.length;y++){let L=u.substring(0,y),R=l(L);y===1&&u.length>y&&R.length>200&&(R=R.slice(0,200));for(let{w:ye}of R)A(p,d,ye,y)}if(p.length===0)for(let y=u.length-1;y>=1;y--){let L=u.substring(0,y),R=l(L);if(R.length>0){for(let{w:ye}of R)A(p,d,ye,y);break}}let v=U(p,u.length),E=m(v,u.length);return E.length<=300?{candidates:E}:{candidates:E.slice(0,300)}}return{getCandidates:I,computeMatchedLength:x}}function Et(e){let t=ke.get(e);if(t)return t;let i=bt(e);return ke.set(e,i),i}var V=class extends Error{constructor(e,t){super(e,t),this.name="DictionaryLoadError"}};function St(e){if(e===null||typeof e!="object"||Array.isArray(e))throw new V("Dictionary JSON must be a plain object");let t=e;for(let i of Object.keys(t)){let n=t[i];if(!Array.isArray(n))throw new V(`Dictionary key "${i}" must map to an array`);for(let r=0;r<n.length;r++){let s=n[r];if(s===null||typeof s!="object"||typeof s.w!="string"||typeof s.f!="number")throw new V(`Invalid entry at "${i}"[${r}]: expected { w: string, f: number }`)}}return t}async function Pi(e,t){let i;try{i=await fetch(e,t)}catch(r){throw new V("Failed to fetch dictionary",{cause:r})}if(!i.ok)throw new V(`Dictionary request failed: HTTP ${i.status} ${i.statusText}`);let n;try{n=await i.json()}catch(r){throw new V("Dictionary response is not valid JSON",{cause:r})}return St(n)}function xi(e,t,i){let n=Xe();return n?n.computeMatchedLength(e,t,i):i}function Ci(e){let t=Xe();return t?t.getCandidates(e):{candidates:[]}}var Mi=5;function ie(e){return Number.isFinite(e)?Math.min(9,Math.max(1,Math.floor(e))):5}function De(e){if(["=",".","-",","].includes(e.key)||e.key==="+"||e.key==="_")return!0;let t=e.code;return t==="Equal"||t==="Minus"||t==="Period"||t==="Comma"||t==="NumpadSubtract"||t==="NumpadAdd"||t==="NumpadDecimal"}function $t(e){if(e.key==="="||e.key==="."||e.key==="+")return!0;let t=e.code;return t==="Equal"||t==="Period"||t==="NumpadAdd"||t==="NumpadDecimal"}function wt(e){if(e.key==="-"||e.key===","||e.key==="_")return!0;let t=e.code;return t==="Minus"||t==="Comma"||t==="NumpadSubtract"}function Re(e,t){let i=parseInt(e,10);return/^[1-9]$/.test(e)&&i>=1&&i<=t}function At(e){return e==="ShiftLeft"||e==="ShiftRight"}function Te(e){if(At(e.code))return!0;if(e.key!=="Shift")return!1;let t=(e.code??"").trim();return!t||t==="Unidentified"||t==="Shift"}var Pt=class{constructor(e){g(this,"options");g(this,"listeners",new Set);g(this,"pinyinInput","");g(this,"pinyinCursorPosition",0);g(this,"pinyinSelectionStart",0);g(this,"pinyinSelectionEnd",0);g(this,"candidates",[]);g(this,"page",0);g(this,"pageSize",5);g(this,"highlightedCandidateIndex",null);g(this,"recomputeRafId",null);g(this,"missPrefixLock",null);g(this,"chineseMode",!0);g(this,"shiftPhysicalDown",0);g(this,"shiftGestureOtherKeySeen",!1);g(this,"cachedSnapshot",null);this.options=e,this.pageSize=ie(e.pageSize??5)}setOptions(e){this.cancelScheduledRecompute(),this.options={...this.options,...e},e.pageSize!==void 0&&(this.pageSize=ie(e.pageSize),this.page=0),this.recomputeCandidates(),this.emit()}subscribe(e){return this.listeners.add(e),()=>this.listeners.delete(e)}getSnapshot(){if(this.cachedSnapshot===null){let e=this.candidates.slice(this.page*this.pageSize,(this.page+1)*this.pageSize);this.cachedSnapshot={pinyinInput:this.pinyinInput,pinyinCursorPosition:this.pinyinCursorPosition,pinyinSelectionStart:this.pinyinSelectionStart,pinyinSelectionEnd:this.pinyinSelectionEnd,candidates:this.candidates,displayCandidates:e,page:this.page,pageSize:this.pageSize,highlightedCandidateIndex:this.highlightedCandidateIndex,hasActiveComposition:this.pinyinInput.length>0,chineseMode:this.chineseMode}}return this.cachedSnapshot}emit(){this.cachedSnapshot=null;for(let e of this.listeners)e()}setPinyinSelection(e,t){let i=this.pinyinInput.length,n=Math.max(0,Math.min(i,e)),r=Math.max(0,Math.min(i,t));this.pinyinSelectionStart=Math.min(n,r),this.pinyinSelectionEnd=Math.max(n,r),this.pinyinCursorPosition=r}collapsePinyinSelection(e){this.setPinyinSelection(e,e)}hasPinyinSelection(){return this.pinyinSelectionStart!==this.pinyinSelectionEnd}replacePinyinSelection(e){let t=this.pinyinInput.substring(0,this.pinyinSelectionStart),i=this.pinyinInput.substring(this.pinyinSelectionEnd);this.pinyinInput=t+e+i,this.collapsePinyinSelection(t.length+e.length)}deleteSelectedPinyin(){return this.hasPinyinSelection()?(this.replacePinyinSelection(""),!0):!1}syncHighlightedCandidate(){if(this.candidates.length===0){this.highlightedCandidateIndex=null;return}if(this.highlightedCandidateIndex!==null&&this.highlightedCandidateIndex>=0&&this.highlightedCandidateIndex<this.candidates.length)return;let e=this.page*this.pageSize;this.highlightedCandidateIndex=Math.min(e,this.candidates.length-1)}cancelScheduledRecompute(){this.recomputeRafId!==null&&(cancelAnimationFrame(this.recomputeRafId),this.recomputeRafId=null)}flushRecomputeAndEmit(){this.cancelScheduledRecompute(),this.recomputeCandidates(),this.emit()}scheduleRecomputeAndEmit(){this.recomputeRafId===null&&(this.recomputeRafId=requestAnimationFrame(()=>{this.recomputeRafId=null,this.recomputeCandidates(),this.emit()}))}clearMissPrefixLock(){this.missPrefixLock=null}shouldSkipByMissPrefixLock(e){let t=this.missPrefixLock;return t?e.length>t.length&&e.startsWith(t):!1}updateMissPrefixLock(e){if(e.length===0){this.clearMissPrefixLock();return}if(this.candidates.length===0){(this.missPrefixLock===null||e.length<this.missPrefixLock.length||!e.startsWith(this.missPrefixLock))&&(this.missPrefixLock=e);return}this.clearMissPrefixLock()}recomputeCandidates(){let e=this.options.getEngine();if(!this.pinyinInput||!e){this.candidates=[],this.page=0,this.highlightedCandidateIndex=null,this.clearMissPrefixLock();return}if(this.shouldSkipByMissPrefixLock(this.pinyinInput)){this.candidates=[],this.page=0,this.highlightedCandidateIndex=null;return}this.candidates=e.getCandidates(this.pinyinInput).candidates;let t=Math.max(0,Math.ceil(this.candidates.length/this.pageSize)-1);this.page>t&&(this.page=t),this.updateMissPrefixLock(this.pinyinInput),this.syncHighlightedCandidate()}selectCandidate(e){this.cancelScheduledRecompute();let t=this.options.getEngine();if(!t)return;this.insertText(e.word);let i=t.computeMatchedLength(e.word,this.pinyinInput,e.matchedLength),n=this.pinyinInput.substring(i),r=n.startsWith("'")?n.substring(1):n;this.pinyinInput=r,this.collapsePinyinSelection(r.length),this.clearMissPrefixLock(),this.recomputeCandidates(),this.page=0,this.highlightedCandidateIndex=this.candidates.length>0?0:null,this.emit()}addPage(e){this.setPage(t=>Math.max(0,t+e))}setPage(e){let t=e(this.page),i=Math.max(0,Math.ceil(this.candidates.length/this.pageSize)-1);this.page=Math.min(i,Math.max(0,t)),this.highlightedCandidateIndex=this.candidates.length>0?Math.min(this.page*this.pageSize,this.candidates.length-1):null,this.emit()}insertText(e){let t=this.options.getElement();if(!t)return;let i=t.selectionStart??0,n=t.selectionEnd??i,r=String(this.options.getValue()||""),s=r.substring(0,i)+e+r.substring(n);this.options.onValueChange(s),requestAnimationFrame(()=>{t.selectionStart=t.selectionEnd=i+e.length,t.focus()})}commitPinyinBufferAsRaw(){this.insertText(this.pinyinInput),this.pinyinInput="",this.collapsePinyinSelection(0),this.clearMissPrefixLock(),this.recomputeCandidates(),this.emit()}resetShiftGestureState(){this.shiftPhysicalDown=0,this.shiftGestureOtherKeySeen=!1}handleBeforeInput(e){if(this.options.enabled===!1||e.inputType==="insertFromPaste"||e.inputType==="insertFromDrop"||e.inputType==="insertCompositionText"||e.inputType==="insertFromComposition"||e.inputType!=="insertText"||!e.data||e.data.length!==1)return;let t=e.data;if(this.pinyinInput.length>0){if(t===" "){e.preventDefault();return}if(Re(t,this.pageSize)){e.preventDefault();return}if(/^[=\-.,]$/.test(t)){e.preventDefault();return}}this.chineseMode&&/^[a-zA-Z']$/.test(t)&&e.preventDefault()}handleKeyUp(e){if(this.options.enabled===!1||!Te(e)||this.shiftPhysicalDown===0||(this.shiftPhysicalDown-=1,this.shiftPhysicalDown>0))return;let t=!this.shiftGestureOtherKeySeen;this.shiftGestureOtherKeySeen=!1,t&&(e.preventDefault(),this.pinyinInput.length>0?this.commitPinyinBufferAsRaw():(this.chineseMode=!this.chineseMode,this.emit()))}handleKeyDown(e){var t,i,n,r,s,o;if(this.options.enabled===!1){(i=(t=this.options).onKeyDown)==null||i.call(t,e);return}if(Te(e)){this.shiftPhysicalDown===0&&(this.shiftGestureOtherKeySeen=!1),this.shiftPhysicalDown++,(r=(n=this.options).onKeyDown)==null||r.call(n,e);return}if(this.shiftPhysicalDown>0&&(this.shiftGestureOtherKeySeen=!0),this.pinyinInput.length>0&&De(e)&&(e.preventDefault(),e.stopPropagation()),this.pinyinInput.length>0){if(e.key.toLowerCase()==="a"&&e.ctrlKey&&!e.altKey&&!e.metaKey){e.preventDefault(),this.setPinyinSelection(0,this.pinyinInput.length),this.emit();return}if(/^[a-z']$/i.test(e.key)||this.flushRecomputeAndEmit(),e.key==="Backspace"){if(e.preventDefault(),this.deleteSelectedPinyin()){this.scheduleRecomputeAndEmit();return}this.pinyinCursorPosition>0&&(this.setPinyinSelection(this.pinyinCursorPosition-1,this.pinyinCursorPosition),this.deleteSelectedPinyin(),this.scheduleRecomputeAndEmit());return}if(e.key==="Delete"){if(e.preventDefault(),this.deleteSelectedPinyin()){this.scheduleRecomputeAndEmit();return}this.pinyinCursorPosition<this.pinyinInput.length&&(this.setPinyinSelection(this.pinyinCursorPosition,this.pinyinCursorPosition+1),this.deleteSelectedPinyin(),this.scheduleRecomputeAndEmit());return}if(e.key==="ArrowLeft"){e.preventDefault();let a=this.pinyinCursorPosition>0?this.pinyinCursorPosition-1:this.pinyinInput.length;if(e.shiftKey){let l=this.hasPinyinSelection()?this.pinyinSelectionStart:this.pinyinCursorPosition;this.setPinyinSelection(l,a)}else this.collapsePinyinSelection(a);this.emit();return}if(e.key==="ArrowRight"){e.preventDefault();let a=this.pinyinCursorPosition<this.pinyinInput.length?this.pinyinCursorPosition+1:0;if(e.shiftKey){let l=this.hasPinyinSelection()?this.pinyinSelectionEnd:this.pinyinCursorPosition;this.setPinyinSelection(l,a)}else this.collapsePinyinSelection(a);this.emit();return}if(e.key==="ArrowDown"){if(e.preventDefault(),this.candidates.length>0){let a=this.highlightedCandidateIndex??this.page*this.pageSize,l=Math.min(this.candidates.length-1,a+1);this.highlightedCandidateIndex=l,this.page=Math.floor(l/this.pageSize),this.emit()}return}if(e.key==="ArrowUp"){if(e.preventDefault(),this.candidates.length>0){let a=this.highlightedCandidateIndex??this.page*this.pageSize,l=Math.max(0,a-1);this.highlightedCandidateIndex=l,this.page=Math.floor(l/this.pageSize),this.emit()}return}if(e.key==="Enter"){e.preventDefault(),this.commitPinyinBufferAsRaw();return}if(e.key==="Escape"){e.preventDefault(),this.pinyinInput="",this.collapsePinyinSelection(0),this.clearMissPrefixLock(),this.recomputeCandidates(),this.emit();return}if(e.key===" "){if(e.preventDefault(),this.candidates.length>0){let a=this.highlightedCandidateIndex??this.page*this.pageSize,l=Math.min(Math.max(0,a),this.candidates.length-1);this.selectCandidate(this.candidates[l])}else this.insertText(this.pinyinInput),this.pinyinInput="",this.collapsePinyinSelection(0),this.clearMissPrefixLock(),this.recomputeCandidates(),this.emit();return}if(Re(e.key,this.pageSize)){e.preventDefault();let a=parseInt(e.key,10)-1,l=this.page*this.pageSize+a;l<this.candidates.length&&this.selectCandidate(this.candidates[l]);return}if($t(e)){(this.page+1)*this.pageSize<this.candidates.length&&this.setPage(a=>a+1);return}if(wt(e)){this.page>0&&this.setPage(a=>a-1);return}}if(this.chineseMode&&/^[a-z']$/i.test(e.key)&&!e.ctrlKey&&!e.altKey&&!e.metaKey){e.preventDefault(),e.stopPropagation();let a=e.key.toLowerCase();this.replacePinyinSelection(a),this.scheduleRecomputeAndEmit();return}this.pinyinInput.length>0&&De(e)||((o=(s=this.options).onKeyDown)==null||o.call(s,e))}},xt=class{get shadowRoot(){return this.__host.__shadowRoot}constructor(e){this.ariaActiveDescendantElement=null,this.ariaAtomic="",this.ariaAutoComplete="",this.ariaBrailleLabel="",this.ariaBrailleRoleDescription="",this.ariaBusy="",this.ariaChecked="",this.ariaColCount="",this.ariaColIndex="",this.ariaColIndexText="",this.ariaColSpan="",this.ariaControlsElements=null,this.ariaCurrent="",this.ariaDescribedByElements=null,this.ariaDescription="",this.ariaDetailsElements=null,this.ariaDisabled="",this.ariaErrorMessageElements=null,this.ariaExpanded="",this.ariaFlowToElements=null,this.ariaHasPopup="",this.ariaHidden="",this.ariaInvalid="",this.ariaKeyShortcuts="",this.ariaLabel="",this.ariaLabelledByElements=null,this.ariaLevel="",this.ariaLive="",this.ariaModal="",this.ariaMultiLine="",this.ariaMultiSelectable="",this.ariaOrientation="",this.ariaOwnsElements=null,this.ariaPlaceholder="",this.ariaPosInSet="",this.ariaPressed="",this.ariaReadOnly="",this.ariaRelevant="",this.ariaRequired="",this.ariaRoleDescription="",this.ariaRowCount="",this.ariaRowIndex="",this.ariaRowIndexText="",this.ariaRowSpan="",this.ariaSelected="",this.ariaSetSize="",this.ariaSort="",this.ariaValueMax="",this.ariaValueMin="",this.ariaValueNow="",this.ariaValueText="",this.role="",this.form=null,this.labels=[],this.states=new Set,this.validationMessage="",this.validity={},this.willValidate=!0,this.__host=e}checkValidity(){return console.warn("`ElementInternals.checkValidity()` was called on the server.This method always returns true."),!0}reportValidity(){return!0}setFormValue(){}setValidity(){}},T=function(e,t,i,n,r){if(typeof t=="function"?e!==t||!0:!t.has(e))throw new TypeError("Cannot write private member to an object whose class did not declare it");return t.set(e,i),i},P=function(e,t,i,n){if(typeof t=="function"?e!==t||!n:!t.has(e))throw new TypeError("Cannot read private member from an object whose class did not declare it");return i==="m"?n:i==="a"?n.call(e):n?n.value:t.get(e)},K,he,de,Z,_e,X,ue,z,Q,N,pe,Ie,Ue=e=>typeof e=="boolean"?e:(e==null?void 0:e.capture)??!1,Ct=class{constructor(){this.__eventListeners=new Map,this.__captureEventListeners=new Map}addEventListener(e,t,i){var o;if(t==null)return;let n=Ue(i)?this.__captureEventListeners:this.__eventListeners,r=n.get(e);if(r===void 0)r=new Map,n.set(e,r);else if(r.has(t))return;let s=typeof i=="object"&&i?i:{};(o=s.signal)==null||o.addEventListener("abort",()=>this.removeEventListener(e,t,i)),r.set(t,s??{})}removeEventListener(e,t,i){if(t==null)return;let n=Ue(i)?this.__captureEventListeners:this.__eventListeners,r=n.get(e);r!==void 0&&(r.delete(t),r.size||n.delete(e))}dispatchEvent(e){let t=[this],i=this.__eventTargetParent;if(e.composed)for(;i;)t.push(i),i=i.__eventTargetParent;else for(;i&&i!==this.__host;)t.push(i),i=i.__eventTargetParent;let n=!1,r=!1,s=0,o=null,a=null,l=null,$=e.stopPropagation,b=e.stopImmediatePropagation;Object.defineProperties(e,{target:{get(){return o??a},..._},srcElement:{get(){return e.target},..._},currentTarget:{get(){return l},..._},eventPhase:{get(){return s},..._},composedPath:{value:()=>t,..._},stopPropagation:{value:()=>{n=!0,$.call(e)},..._},stopImmediatePropagation:{value:()=>{r=!0,b.call(e)},..._}});let c=(m,x,I)=>{typeof m=="function"?m(e):typeof(m==null?void 0:m.handleEvent)=="function"&&m.handleEvent(e),x.once&&I.delete(m)},w=()=>(l=null,s=0,!e.defaultPrevented),A=t.slice().reverse();o=!this.__host||!e.composed?this:null;let M=m=>{for(a=this;a.__host&&m.includes(a.__host);)a=a.__host};for(let m of A){!o&&(!a||a===m.__host)&&M(A.slice(A.indexOf(m))),l=m,s=m===e.target?2:1;let x=m.__captureEventListeners.get(e.type);if(x){for(let[I,h]of x)if(c(I,h,x),r)return w()}if(n)return w()}let U=e.bubbles?t:[this];a=null;for(let m of U){!o&&(!a||m===a.__host)&&M(U.slice(0,U.indexOf(m)+1)),l=m,s=m===e.target?2:3;let x=m.__eventListeners.get(e.type);if(x){for(let[I,h]of x)if(c(I,h,x),r)return w()}if(n)return w()}return w()}},Mt=Ct,_={__proto__:null};_.enumerable=!0;Object.freeze(_);var Pe=(N=class{constructor(e,t={}){if(K.set(this,!1),he.set(this,!1),de.set(this,!1),Z.set(this,!1),_e.set(this,Date.now()),X.set(this,!1),ue.set(this,void 0),z.set(this,void 0),Q.set(this,void 0),this.NONE=0,this.CAPTURING_PHASE=1,this.AT_TARGET=2,this.BUBBLING_PHASE=3,arguments.length===0)throw new Error("The type argument must be specified");if(typeof t!="object"||!t)throw new Error('The "options" argument must be an object');let{bubbles:i,cancelable:n,composed:r}=t;T(this,K,!!n),T(this,he,!!i),T(this,de,!!r),T(this,ue,`${e}`),T(this,z,null),T(this,Q,!1)}initEvent(e,t,i){throw new Error("Method not implemented.")}stopImmediatePropagation(){this.stopPropagation()}preventDefault(){T(this,Z,!0)}get target(){return P(this,z,"f")}get currentTarget(){return P(this,z,"f")}get srcElement(){return P(this,z,"f")}get type(){return P(this,ue,"f")}get cancelable(){return P(this,K,"f")}get defaultPrevented(){return P(this,K,"f")&&P(this,Z,"f")}get timeStamp(){return P(this,_e,"f")}composedPath(){return P(this,Q,"f")?[P(this,z,"f")]:[]}get returnValue(){return!P(this,K,"f")||!P(this,Z,"f")}get bubbles(){return P(this,he,"f")}get composed(){return P(this,de,"f")}get eventPhase(){return P(this,Q,"f")?N.AT_TARGET:N.NONE}get cancelBubble(){return P(this,X,"f")}set cancelBubble(e){e&&T(this,X,!0)}stopPropagation(){T(this,X,!0)}get isTrusted(){return!1}},K=new WeakMap,he=new WeakMap,de=new WeakMap,Z=new WeakMap,_e=new WeakMap,X=new WeakMap,ue=new WeakMap,z=new WeakMap,Q=new WeakMap,N.NONE=0,N.CAPTURING_PHASE=1,N.AT_TARGET=2,N.BUBBLING_PHASE=3,N);Object.defineProperties(Pe.prototype,{initEvent:_,stopImmediatePropagation:_,preventDefault:_,target:_,currentTarget:_,srcElement:_,type:_,cancelable:_,defaultPrevented:_,timeStamp:_,composedPath:_,returnValue:_,bubbles:_,composed:_,eventPhase:_,cancelBubble:_,stopPropagation:_,isTrusted:_});var Qe=(Ie=class extends Pe{constructor(e,t={}){super(e,t),pe.set(this,void 0),T(this,pe,(t==null?void 0:t.detail)??null)}initCustomEvent(e,t,i,n){throw new Error("Method not implemented.")}get detail(){return P(this,pe,"f")}},pe=new WeakMap,Ie);Object.defineProperties(Qe.prototype,{detail:_});var Lt=Pe,kt=Qe,C;C=class{constructor(){this.STYLE_RULE=1,this.CHARSET_RULE=2,this.IMPORT_RULE=3,this.MEDIA_RULE=4,this.FONT_FACE_RULE=5,this.PAGE_RULE=6,this.NAMESPACE_RULE=10,this.KEYFRAMES_RULE=7,this.KEYFRAME_RULE=8,this.SUPPORTS_RULE=12,this.COUNTER_STYLE_RULE=11,this.FONT_FEATURE_VALUES_RULE=14,this.__parentStyleSheet=null,this.cssText=""}get parentRule(){return null}get parentStyleSheet(){return this.__parentStyleSheet}get type(){return 0}},C.STYLE_RULE=1,C.CHARSET_RULE=2,C.IMPORT_RULE=3,C.MEDIA_RULE=4,C.FONT_FACE_RULE=5,C.PAGE_RULE=6,C.NAMESPACE_RULE=10,C.KEYFRAMES_RULE=7,C.KEYFRAME_RULE=8,C.SUPPORTS_RULE=12,C.COUNTER_STYLE_RULE=11,C.FONT_FEATURE_VALUES_RULE=14;globalThis.Event??(globalThis.Event=Lt);globalThis.CustomEvent??(globalThis.CustomEvent=kt);var Ne=new WeakMap,ee=e=>{let t=Ne.get(e);return t===void 0&&Ne.set(e,t=new Map),t},Dt=class extends Mt{constructor(){super(...arguments),this.__shadowRootMode=null,this.__shadowRoot=null,this.__internals=null}get attributes(){return Array.from(ee(this)).map(([e,t])=>({name:e,value:t}))}get shadowRoot(){return this.__shadowRootMode==="closed"?null:this.__shadowRoot}get localName(){return this.constructor.__localName}get tagName(){var e;return(e=this.localName)==null?void 0:e.toUpperCase()}setAttribute(e,t){ee(this).set(e,String(t))}removeAttribute(e){ee(this).delete(e)}toggleAttribute(e,t){if(this.hasAttribute(e)){if(t===void 0||!t)return this.removeAttribute(e),!1}else return t===void 0||t?(this.setAttribute(e,""),!0):!1;return!0}hasAttribute(e){return ee(this).has(e)}attachShadow(e){let t={host:this};return this.__shadowRootMode=e.mode,e&&e.mode==="open"&&(this.__shadowRoot=t),t}attachInternals(){if(this.__internals!==null)throw new Error("Failed to execute 'attachInternals' on 'HTMLElement': ElementInternals for the specified element was already attached.");let e=new xt(this);return this.__internals=e,e}getAttribute(e){return ee(this).get(e)??null}},Rt=class extends Dt{},et=Rt;globalThis.litServerRoot??(globalThis.litServerRoot=Object.defineProperty(new et,"localName",{get(){return"lit-server-root"}}));function Tt(){let e,t;return{promise:new Promise((i,n)=>{e=i,t=n}),resolve:e,reject:t}}var It=class{constructor(){this.__definitions=new Map,this.__reverseDefinitions=new Map,this.__pendingWhenDefineds=new Map}define(e,t){var i;if(this.__definitions.has(e))throw new Error(`Failed to execute 'define' on 'CustomElementRegistry': the name "${e}" has already been used with this registry`);if(this.__reverseDefinitions.has(t))throw new Error(`Failed to execute 'define' on 'CustomElementRegistry': the constructor has already been used with this registry for the tag name ${this.__reverseDefinitions.get(t)}`);t.__localName=e,this.__definitions.set(e,{ctor:t,observedAttributes:t.observedAttributes??[]}),this.__reverseDefinitions.set(t,e),(i=this.__pendingWhenDefineds.get(e))==null||i.resolve(t),this.__pendingWhenDefineds.delete(e)}get(e){var t;return(t=this.__definitions.get(e))==null?void 0:t.ctor}getName(e){return this.__reverseDefinitions.get(e)??null}upgrade(e){throw new Error("customElements.upgrade is not currently supported in SSR. Please file a bug if you need it.")}async whenDefined(e){let t=this.__definitions.get(e);if(t)return t.ctor;let i=this.__pendingWhenDefineds.get(e);return i||(i=Tt(),this.__pendingWhenDefineds.set(e,i)),i.promise}},Ut=It,Nt=new Ut,ne=globalThis,xe=ne.ShadowRoot&&(ne.ShadyCSS===void 0||ne.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,tt=Symbol(),Oe=new WeakMap,Ot=class{constructor(e,t,i){if(this._$cssResult$=!0,i!==tt)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o,t=this.t;if(xe&&e===void 0){let i=t!==void 0&&t.length===1;i&&(e=Oe.get(t)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),i&&Oe.set(t,e))}return e}toString(){return this.cssText}},it=e=>new Ot(typeof e=="string"?e:e+"",void 0,tt),zt=(e,t)=>{if(xe)e.adoptedStyleSheets=t.map(i=>i instanceof CSSStyleSheet?i:i.styleSheet);else for(let i of t){let n=document.createElement("style"),r=ne.litNonce;r!==void 0&&n.setAttribute("nonce",r),n.textContent=i.cssText,e.appendChild(n)}},ze=xe||ne.CSSStyleSheet===void 0?e=>e:e=>e instanceof CSSStyleSheet?(t=>{let i="";for(let n of t.cssRules)i+=n.cssText;return it(i)})(e):e,{is:Ft,defineProperty:Ht,getOwnPropertyDescriptor:Wt,getOwnPropertyNames:Bt,getOwnPropertySymbols:Kt,getPrototypeOf:Gt}=Object,D=globalThis;D.customElements??(D.customElements=Nt);var Fe=D.trustedTypes,jt=Fe?Fe.emptyScript:"",ve=D.reactiveElementPolyfillSupport,re=(e,t)=>e,we={toAttribute(e,t){switch(t){case Boolean:e=e?jt:null;break;case Object:case Array:e=e==null?e:JSON.stringify(e)}return e},fromAttribute(e,t){let i=e;switch(t){case Boolean:i=e!==null;break;case Number:i=e===null?null:Number(e);break;case Object:case Array:try{i=JSON.parse(e)}catch{i=null}}return i}},nt=(e,t)=>!Ft(e,t),He={attribute:!0,type:String,converter:we,reflect:!1,useDefault:!1,hasChanged:nt};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),D.litPropertyMetadata??(D.litPropertyMetadata=new WeakMap);var j=class extends(globalThis.HTMLElement??et){static addInitializer(e){this._$Ei(),(this.l??(this.l=[])).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=He){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){let i=Symbol(),n=this.getPropertyDescriptor(e,i,t);n!==void 0&&Ht(this.prototype,e,n)}}static getPropertyDescriptor(e,t,i){let{get:n,set:r}=Wt(this.prototype,e)??{get(){return this[t]},set(s){this[t]=s}};return{get:n,set(s){let o=n==null?void 0:n.call(this);r==null||r.call(this,s),this.requestUpdate(e,o,i)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??He}static _$Ei(){if(this.hasOwnProperty(re("elementProperties")))return;let e=Gt(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(re("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(re("properties"))){let t=this.properties,i=[...Bt(t),...Kt(t)];for(let n of i)this.createProperty(n,t[n])}let e=this[Symbol.metadata];if(e!==null){let t=litPropertyMetadata.get(e);if(t!==void 0)for(let[i,n]of t)this.elementProperties.set(i,n)}this._$Eh=new Map;for(let[t,i]of this.elementProperties){let n=this._$Eu(t,i);n!==void 0&&this._$Eh.set(n,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){let t=[];if(Array.isArray(e)){let i=new Set(e.flat(1/0).reverse());for(let n of i)t.unshift(ze(n))}else e!==void 0&&t.push(ze(e));return t}static _$Eu(e,t){let i=t.attribute;return i===!1?void 0:typeof i=="string"?i:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){var e;this._$ES=new Promise(t=>this.enableUpdating=t),this._$AL=new Map,this._$E_(),this.requestUpdate(),(e=this.constructor.l)==null||e.forEach(t=>t(this))}addController(e){var t;(this._$EO??(this._$EO=new Set)).add(e),this.renderRoot!==void 0&&this.isConnected&&((t=e.hostConnected)==null||t.call(e))}removeController(e){var t;(t=this._$EO)==null||t.delete(e)}_$E_(){let e=new Map,t=this.constructor.elementProperties;for(let i of t.keys())this.hasOwnProperty(i)&&(e.set(i,this[i]),delete this[i]);e.size>0&&(this._$Ep=e)}createRenderRoot(){let e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return zt(e,this.constructor.elementStyles),e}connectedCallback(){var e;this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostConnected)==null?void 0:i.call(t)})}enableUpdating(e){}disconnectedCallback(){var e;(e=this._$EO)==null||e.forEach(t=>{var i;return(i=t.hostDisconnected)==null?void 0:i.call(t)})}attributeChangedCallback(e,t,i){this._$AK(e,i)}_$ET(e,t){var r;let i=this.constructor.elementProperties.get(e),n=this.constructor._$Eu(e,i);if(n!==void 0&&i.reflect===!0){let s=(((r=i.converter)==null?void 0:r.toAttribute)!==void 0?i.converter:we).toAttribute(t,i.type);this._$Em=e,s==null?this.removeAttribute(n):this.setAttribute(n,s),this._$Em=null}}_$AK(e,t){var r,s;let i=this.constructor,n=i._$Eh.get(e);if(n!==void 0&&this._$Em!==n){let o=i.getPropertyOptions(n),a=typeof o.converter=="function"?{fromAttribute:o.converter}:((r=o.converter)==null?void 0:r.fromAttribute)!==void 0?o.converter:we;this._$Em=n;let l=a.fromAttribute(t,o.type);this[n]=l??((s=this._$Ej)==null?void 0:s.get(n))??l,this._$Em=null}}requestUpdate(e,t,i,n=!1,r){var s;if(e!==void 0){let o=this.constructor;if(n===!1&&(r=this[e]),i??(i=o.getPropertyOptions(e)),!((i.hasChanged??nt)(r,t)||i.useDefault&&i.reflect&&r===((s=this._$Ej)==null?void 0:s.get(e))&&!this.hasAttribute(o._$Eu(e,i))))return;this.C(e,t,i)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,t,{useDefault:i,reflect:n,wrapped:r},s){i&&!(this._$Ej??(this._$Ej=new Map)).has(e)&&(this._$Ej.set(e,s??t??this[e]),r!==!0||s!==void 0)||(this._$AL.has(e)||(this.hasUpdated||i||(t=void 0),this._$AL.set(e,t)),n===!0&&this._$Em!==e&&(this._$Eq??(this._$Eq=new Set)).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}let e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){var i;if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(let[r,s]of this._$Ep)this[r]=s;this._$Ep=void 0}let n=this.constructor.elementProperties;if(n.size>0)for(let[r,s]of n){let{wrapped:o}=s,a=this[r];o!==!0||this._$AL.has(r)||a===void 0||this.C(r,void 0,s,a)}}let e=!1,t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),(i=this._$EO)==null||i.forEach(n=>{var r;return(r=n.hostUpdate)==null?void 0:r.call(n)}),this.update(t)):this._$EM()}catch(n){throw e=!1,this._$EM(),n}e&&this._$AE(t)}willUpdate(e){}_$AE(e){var t;(t=this._$EO)==null||t.forEach(i=>{var n;return(n=i.hostUpdated)==null?void 0:n.call(i)}),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&(this._$Eq=this._$Eq.forEach(t=>this._$ET(t,this[t]))),this._$EM()}updated(e){}firstUpdated(e){}};j.elementStyles=[],j.shadowRootOptions={mode:"open"},j[re("elementProperties")]=new Map,j[re("finalized")]=new Map,ve==null||ve({ReactiveElement:j}),(D.reactiveElementVersions??(D.reactiveElementVersions=[])).push("2.1.2");var q=globalThis,We=e=>e,fe=q.trustedTypes,Be=fe?fe.createPolicy("lit-html",{createHTML:e=>e}):void 0,rt="$lit$",O=`lit$${Math.random().toFixed(9).slice(2)}$`,st="?"+O,Vt=`<${st}>`,B=q.document===void 0?{createTreeWalker:()=>({})}:document,oe=()=>B.createComment(""),le=e=>e===null||typeof e!="object"&&typeof e!="function",Ce=Array.isArray,qt=e=>Ce(e)||typeof(e==null?void 0:e[Symbol.iterator])=="function",be=`[ 	
\f\r]`,te=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,Ke=/-->/g,Ge=/>/g,F=RegExp(`>|${be}(?:([^\\s"'>=/]+)(${be}*=${be}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),je=/'/g,Ve=/"/g,at=/^(?:script|style|textarea|title)$/i,Yt=e=>(t,...i)=>({_$litType$:e,strings:t,values:i}),k=Yt(1),Y=Symbol.for("lit-noChange"),S=Symbol.for("lit-nothing"),qe=new WeakMap,H=B.createTreeWalker(B,129);function ot(e,t){if(!Ce(e)||!e.hasOwnProperty("raw"))throw Error("invalid template strings array");return Be!==void 0?Be.createHTML(t):t}var Jt=(e,t)=>{let i=e.length-1,n=[],r,s=t===2?"<svg>":t===3?"<math>":"",o=te;for(let a=0;a<i;a++){let l=e[a],$,b,c=-1,w=0;for(;w<l.length&&(o.lastIndex=w,b=o.exec(l),b!==null);)w=o.lastIndex,o===te?b[1]==="!--"?o=Ke:b[1]!==void 0?o=Ge:b[2]!==void 0?(at.test(b[2])&&(r=RegExp("</"+b[2],"g")),o=F):b[3]!==void 0&&(o=F):o===F?b[0]===">"?(o=r??te,c=-1):b[1]===void 0?c=-2:(c=o.lastIndex-b[2].length,$=b[1],o=b[3]===void 0?F:b[3]==='"'?Ve:je):o===Ve||o===je?o=F:o===Ke||o===Ge?o=te:(o=F,r=void 0);let A=o===F&&e[a+1].startsWith("/>")?" ":"";s+=o===te?l+Vt:c>=0?(n.push($),l.slice(0,c)+rt+l.slice(c)+O+A):l+O+(c===-2?a:A)}return[ot(e,s+(e[i]||"<?>")+(t===2?"</svg>":t===3?"</math>":"")),n]},Ae=class lt{constructor({strings:t,_$litType$:i},n){let r;this.parts=[];let s=0,o=0,a=t.length-1,l=this.parts,[$,b]=Jt(t,i);if(this.el=lt.createElement($,n),H.currentNode=this.el.content,i===2||i===3){let c=this.el.content.firstChild;c.replaceWith(...c.childNodes)}for(;(r=H.nextNode())!==null&&l.length<a;){if(r.nodeType===1){if(r.hasAttributes())for(let c of r.getAttributeNames())if(c.endsWith(rt)){let w=b[o++],A=r.getAttribute(c).split(O),M=/([.?@])?(.*)/.exec(w);l.push({type:1,index:s,name:M[2],strings:A,ctor:M[1]==="."?Xt:M[1]==="?"?Qt:M[1]==="@"?ei:me}),r.removeAttribute(c)}else c.startsWith(O)&&(l.push({type:6,index:s}),r.removeAttribute(c));if(at.test(r.tagName)){let c=r.textContent.split(O),w=c.length-1;if(w>0){r.textContent=fe?fe.emptyScript:"";for(let A=0;A<w;A++)r.append(c[A],oe()),H.nextNode(),l.push({type:2,index:++s});r.append(c[w],oe())}}}else if(r.nodeType===8)if(r.data===st)l.push({type:2,index:s});else{let c=-1;for(;(c=r.data.indexOf(O,c+1))!==-1;)l.push({type:7,index:s}),c+=O.length-1}s++}}static createElement(t,i){let n=B.createElement("template");return n.innerHTML=t,n}};function J(e,t,i=e,n){var o,a;if(t===Y)return t;let r=n!==void 0?(o=i._$Co)==null?void 0:o[n]:i._$Cl,s=le(t)?void 0:t._$litDirective$;return(r==null?void 0:r.constructor)!==s&&((a=r==null?void 0:r._$AO)==null||a.call(r,!1),s===void 0?r=void 0:(r=new s(e),r._$AT(e,i,n)),n!==void 0?(i._$Co??(i._$Co=[]))[n]=r:i._$Cl=r),r!==void 0&&(t=J(e,r._$AS(e,t.values),r,n)),t}var Zt=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){let{el:{content:t},parts:i}=this._$AD,n=((e==null?void 0:e.creationScope)??B).importNode(t,!0);H.currentNode=n;let r=H.nextNode(),s=0,o=0,a=i[0];for(;a!==void 0;){if(s===a.index){let l;a.type===2?l=new Me(r,r.nextSibling,this,e):a.type===1?l=new a.ctor(r,a.name,a.strings,this,e):a.type===6&&(l=new ti(r,this,e)),this._$AV.push(l),a=i[++o]}s!==(a==null?void 0:a.index)&&(r=H.nextNode(),s++)}return H.currentNode=B,n}p(e){let t=0;for(let i of this._$AV)i!==void 0&&(i.strings!==void 0?(i._$AI(e,i,t),t+=i.strings.length-2):i._$AI(e[t])),t++}},Me=class ht{get _$AU(){var t;return((t=this._$AM)==null?void 0:t._$AU)??this._$Cv}constructor(t,i,n,r){this.type=2,this._$AH=S,this._$AN=void 0,this._$AA=t,this._$AB=i,this._$AM=n,this.options=r,this._$Cv=(r==null?void 0:r.isConnected)??!0}get parentNode(){let t=this._$AA.parentNode,i=this._$AM;return i!==void 0&&(t==null?void 0:t.nodeType)===11&&(t=i.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,i=this){t=J(this,t,i),le(t)?t===S||t==null||t===""?(this._$AH!==S&&this._$AR(),this._$AH=S):t!==this._$AH&&t!==Y&&this._(t):t._$litType$!==void 0?this.$(t):t.nodeType!==void 0?this.T(t):qt(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==S&&le(this._$AH)?this._$AA.nextSibling.data=t:this.T(B.createTextNode(t)),this._$AH=t}$(t){var s;let{values:i,_$litType$:n}=t,r=typeof n=="number"?this._$AC(t):(n.el===void 0&&(n.el=Ae.createElement(ot(n.h,n.h[0]),this.options)),n);if(((s=this._$AH)==null?void 0:s._$AD)===r)this._$AH.p(i);else{let o=new Zt(r,this),a=o.u(this.options);o.p(i),this.T(a),this._$AH=o}}_$AC(t){let i=qe.get(t.strings);return i===void 0&&qe.set(t.strings,i=new Ae(t)),i}k(t){Ce(this._$AH)||(this._$AH=[],this._$AR());let i=this._$AH,n,r=0;for(let s of t)r===i.length?i.push(n=new ht(this.O(oe()),this.O(oe()),this,this.options)):n=i[r],n._$AI(s),r++;r<i.length&&(this._$AR(n&&n._$AB.nextSibling,r),i.length=r)}_$AR(t=this._$AA.nextSibling,i){var n;for((n=this._$AP)==null?void 0:n.call(this,!1,!0,i);t!==this._$AB;){let r=We(t).nextSibling;We(t).remove(),t=r}}setConnected(t){var i;this._$AM===void 0&&(this._$Cv=t,(i=this._$AP)==null||i.call(this,t))}},me=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,i,n,r){this.type=1,this._$AH=S,this._$AN=void 0,this.element=e,this.name=t,this._$AM=n,this.options=r,i.length>2||i[0]!==""||i[1]!==""?(this._$AH=Array(i.length-1).fill(new String),this.strings=i):this._$AH=S}_$AI(e,t=this,i,n){let r=this.strings,s=!1;if(r===void 0)e=J(this,e,t,0),s=!le(e)||e!==this._$AH&&e!==Y,s&&(this._$AH=e);else{let o=e,a,l;for(e=r[0],a=0;a<r.length-1;a++)l=J(this,o[i+a],t,a),l===Y&&(l=this._$AH[a]),s||(s=!le(l)||l!==this._$AH[a]),l===S?e=S:e!==S&&(e+=(l??"")+r[a+1]),this._$AH[a]=l}s&&!n&&this.j(e)}j(e){e===S?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}},Xt=class extends me{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===S?void 0:e}},Qt=class extends me{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==S)}},ei=class extends me{constructor(e,t,i,n,r){super(e,t,i,n,r),this.type=5}_$AI(e,t=this){if((e=J(this,e,t,0)??S)===Y)return;let i=this._$AH,n=e===S&&i!==S||e.capture!==i.capture||e.once!==i.once||e.passive!==i.passive,r=e!==S&&(i===S||n);n&&this.element.removeEventListener(this.name,this,i),r&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){var t;typeof this._$AH=="function"?this._$AH.call(((t=this.options)==null?void 0:t.host)??this.element,e):this._$AH.handleEvent(e)}},ti=class{constructor(e,t,i){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=i}get _$AU(){return this._$AM._$AU}_$AI(e){J(this,e)}},Ee=q.litHtmlPolyfillSupport;Ee==null||Ee(Ae,Me),(q.litHtmlVersions??(q.litHtmlVersions=[])).push("3.3.2");var ii=(e,t,i)=>{let n=(i==null?void 0:i.renderBefore)??t,r=n._$litPart$;if(r===void 0){let s=(i==null?void 0:i.renderBefore)??null;n._$litPart$=r=new Me(t.insertBefore(oe(),s),s,void 0,i??{})}return r._$AI(e),r},W=globalThis,se=class extends j{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var t;let e=super.createRenderRoot();return(t=this.renderOptions).renderBefore??(t.renderBefore=e.firstChild),e}update(e){let t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=ii(t,this.renderRoot,this.renderOptions)}connectedCallback(){var e;super.connectedCallback(),(e=this._$Do)==null||e.setConnected(!0)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this._$Do)==null||e.setConnected(!1)}render(){return Y}},Je;se._$litElement$=!0,se.finalized=!0,(Je=W.litElementHydrateSupport)==null||Je.call(W,{LitElement:se});var Se=W.litElementPolyfillSupport;Se==null||Se({LitElement:se});(W.litElementVersions??(W.litElementVersions=[])).push("4.2.2");var ni=e=>e.strings===void 0,ri={CHILD:2},si=e=>(...t)=>({_$litDirective$:e,values:t}),ai=class{constructor(e){}get _$AU(){return this._$AM._$AU}_$AT(e,t,i){this._$Ct=e,this._$AM=t,this._$Ci=i}_$AS(e,t){return this.update(e,t)}update(e,t){return this.render(...t)}},ae=(e,t)=>{var n;let i=e._$AN;if(i===void 0)return!1;for(let r of i)(n=r._$AO)==null||n.call(r,t,!1),ae(r,t);return!0},ge=e=>{let t,i;do{if((t=e._$AM)===void 0)break;i=t._$AN,i.delete(e),e=t}while((i==null?void 0:i.size)===0)},dt=e=>{for(let t;t=e._$AM;e=t){let i=t._$AN;if(i===void 0)t._$AN=i=new Set;else if(i.has(e))break;i.add(e),hi(t)}};function oi(e){this._$AN!==void 0?(ge(this),this._$AM=e,dt(this)):this._$AM=e}function li(e,t=!1,i=0){let n=this._$AH,r=this._$AN;if(r!==void 0&&r.size!==0)if(t)if(Array.isArray(n))for(let s=i;s<n.length;s++)ae(n[s],!1),ge(n[s]);else n!=null&&(ae(n,!1),ge(n));else ae(this,e)}var hi=e=>{e.type==ri.CHILD&&(e._$AP??(e._$AP=li),e._$AQ??(e._$AQ=oi))},di=class extends ai{constructor(){super(...arguments),this._$AN=void 0}_$AT(e,t,i){super._$AT(e,t,i),dt(this),this.isConnected=e._$AU}_$AO(e,t=!0){var i,n;e!==this.isConnected&&(this.isConnected=e,e?(i=this.reconnected)==null||i.call(this):(n=this.disconnected)==null||n.call(this)),t&&(ae(this,e),ge(this))}setValue(e){if(ni(this._$Ct))this._$Ct._$AI(e,this);else{let t=[...this._$Ct._$AH];t[this._$Ci]=e,this._$Ct._$AI(t,this,0)}}disconnected(){}reconnected(){}},ui=()=>new pi,pi=class{},$e=new WeakMap,Ye=si(class extends di{render(e){return S}update(e,[t]){var n;let i=t!==this.G;return i&&this.G!==void 0&&this.rt(void 0),(i||this.lt!==this.ct)&&(this.G=t,this.ht=(n=e.options)==null?void 0:n.host,this.rt(this.ct=e.element)),S}rt(e){if(this.isConnected||(e=void 0),typeof this.G=="function"){let t=this.ht??globalThis,i=$e.get(t);i===void 0&&(i=new WeakMap,$e.set(t,i)),i.get(this.G)!==void 0&&this.G.call(this.ht,void 0),i.set(this.G,e),e!==void 0&&this.G.call(this.ht,e)}else this.G.value=e}get lt(){var e,t;return typeof this.G=="function"?(e=$e.get(this.ht??globalThis))==null?void 0:e.get(this.G):(t=this.G)==null?void 0:t.value}disconnected(){this.lt===this.ct&&this.rt(void 0)}reconnected(){this.rt(this.ct)}}),ut=new Set(["top","bottom","left","right"]);function ci(e){if(e===null)return!0;let t=e.trim().toLowerCase();return!(t==="false"||t==="0"||t==="off"||t==="no"||t==="disabled")}function fi(e){if(e===null)return"top";let t=e.trim().toLowerCase();return ut.has(t)?t:"top"}function gi(e){return ut.has(e)?e:"top"}function mi(e){return e===null?"input":e.trim().toLowerCase()==="textarea"?"textarea":"input"}function yi(e){if(e===null)return ie(5);let t=Number.parseInt(e.trim(),10);return Number.isNaN(t)?ie(5):ie(t)}var _i=`/**\r
 * 默认样式（无前缀框架）；与 \`defaultPinyinPopupClassNames\` / 输入框默认 class 对应。\r
 * 发布时复制到 \`dist/pinyin-ime.css\`。\r
 * 支持 CSS 变量覆盖：--pinyin-ime-border-color、--pinyin-ime-focus-border 等。\r
 */\r
\r
:host {\r
  --pinyin-ime-border-color: #d4d4d8;\r
  --pinyin-ime-focus-border: #3b82f6;\r
  --pinyin-ime-focus-shadow: rgba(59, 130, 246, 0.25);\r
  --pinyin-ime-popup-bg: #fff;\r
  --pinyin-ime-popup-border: #e4e4e7;\r
  --pinyin-ime-cursor-color: #2563eb;\r
  --pinyin-ime-hover-bg: #f4f4f5;\r
  --pinyin-ime-active-bg: #e0ecff;\r
  --pinyin-ime-text-color: #18181b;\r
  --pinyin-ime-muted-color: #71717a;\r
  --pinyin-ime-selection-bg: #bfdbfe;\r
  --pinyin-ime-mode-badge-color: #71717a;\r
}\r
\r
.pinyin-ime-field-wrap {\r
  position: relative;\r
  width: 100%;\r
}\r
\r
.pinyin-ime-mode-badge {\r
  position: absolute;\r
  bottom: 0.5rem;\r
  right: 0.5rem;\r
  line-height: 1;\r
  font-size: 0.65rem;\r
  font-weight: 700;\r
  color: var(--pinyin-ime-mode-badge-color);\r
  pointer-events: none;\r
  user-select: none;\r
}\r
\r
.pinyin-ime-input,\r
.pinyin-ime-textarea {\r
  box-sizing: border-box;\r
  width: 100%;\r
  border: 1px solid var(--pinyin-ime-border-color);\r
  border-radius: 0.375rem;\r
  background: var(--pinyin-ime-popup-bg);\r
  color: var(--pinyin-ime-text-color);\r
  font-size: 0.875rem;\r
  line-height: 1.25rem;\r
  padding: 0.5rem 0.75rem;\r
  outline: none;\r
  transition: box-shadow 0.15s ease, border-color 0.15s ease;\r
}\r
\r
.pinyin-ime-field--with-mode-badge {\r
  padding-right: 2rem;\r
  padding-bottom: 1rem;\r
}\r
\r
.pinyin-ime-textarea {\r
  min-height: 5rem;\r
  resize: vertical;\r
}\r
\r
.pinyin-ime-input::placeholder,\r
.pinyin-ime-textarea::placeholder {\r
  color: var(--pinyin-ime-muted-color);\r
}\r
\r
.pinyin-ime-input:focus-visible,\r
.pinyin-ime-textarea:focus-visible {\r
  border-color: var(--pinyin-ime-focus-border);\r
  box-shadow: 0 0 0 2px var(--pinyin-ime-focus-shadow);\r
}\r
\r
.pinyin-ime-input:disabled,\r
.pinyin-ime-textarea:disabled {\r
  opacity: 0.5;\r
  cursor: not-allowed;\r
}\r
\r
.pinyin-ime-popup {\r
  position: fixed;\r
  z-index: 9999;\r
  display: flex;\r
  flex-direction: column;\r
  min-width: 8rem;\r
  border-radius: 0.375rem;\r
  border: 1px solid var(--pinyin-ime-popup-border);\r
  background: var(--pinyin-ime-popup-bg);\r
  color: var(--pinyin-ime-text-color);\r
  font-size: 0.75rem;\r
  line-height: 1rem;\r
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);\r
  padding: 2px;\r
}\r
\r
.pinyin-ime-pinyin-bar {\r
  flex-shrink: 0;\r
  margin-bottom: 2px;\r
  border-bottom: 1px solid var(--pinyin-ime-popup-border);\r
  background: var(--pinyin-ime-hover-bg);\r
  padding: 2px 4px;\r
  font-family: ui-monospace, monospace;\r
  font-size: 10px;\r
}\r
\r
.pinyin-ime-cursor {\r
  display: inline-block;\r
  height: 0.75rem;\r
  width: 1px;\r
  margin: 0 1px;\r
  vertical-align: middle;\r
  background: var(--pinyin-ime-cursor-color);\r
  animation: pinyin-ime-caret-blink 1s step-end infinite;\r
}\r
\r
.pinyin-ime-pinyin-selection {\r
  border-radius: 2px;\r
  background: var(--pinyin-ime-selection-bg);\r
}\r
\r
@keyframes pinyin-ime-caret-blink {\r
  50% {\r
    opacity: 0;\r
  }\r
}\r
\r
.pinyin-ime-candidate-row {\r
  display: flex;\r
  flex-shrink: 0;\r
  align-items: center;\r
  padding: 4px;\r
  cursor: pointer;\r
  border-radius: 2px;\r
}\r
\r
.pinyin-ime-candidate-row:hover {\r
  background: var(--pinyin-ime-hover-bg);\r
}\r
\r
.pinyin-ime-candidate-row--active {\r
  background: var(--pinyin-ime-active-bg);\r
}\r
\r
.pinyin-ime-candidate-index {\r
  margin-right: 4px;\r
  width: 1rem;\r
  flex-shrink: 0;\r
  font-size: 0.75rem;\r
  font-weight: 600;\r
  color: var(--pinyin-ime-muted-color);\r
}\r
\r
.pinyin-ime-candidate-text {\r
  font-size: 11px;\r
}\r
\r
.pinyin-ime-empty,\r
.pinyin-ime-loading {\r
  padding: 4px;\r
  font-size: 10px;\r
  font-style: italic;\r
  color: var(--pinyin-ime-muted-color);\r
}\r
\r
.pinyin-ime-footer {\r
  margin-top: 2px;\r
  display: flex;\r
  flex-shrink: 0;\r
  align-items: center;\r
  justify-content: space-between;\r
  border-top: 1px solid var(--pinyin-ime-popup-border);\r
  padding: 4px;\r
  font-size: 10px;\r
  color: var(--pinyin-ime-muted-color);\r
  user-select: none;\r
}\r
\r
.pinyin-ime-candidate-list {\r
  display: flex;\r
  flex-direction: column;\r
  flex-shrink: 0;\r
}\r
\r
.pinyin-ime-footer-nav {\r
  display: flex;\r
  gap: 0.5rem;\r
}\r
\r
.pinyin-ime-page-link {\r
  cursor: pointer;\r
}\r
\r
.pinyin-ime-page-link:hover {\r
  color: var(--pinyin-ime-text-color);\r
}\r
\r
.pinyin-ime-page-link--disabled {\r
  cursor: default;\r
  opacity: 0.5;\r
}\r
`,vi=null;function bi(){return vi??(vi=(async()=>{try{return(await ft(async()=>{const{dict:e}=await import("./google_pinyin_dict-CpBL7cx9.js");return{dict:e}},[])).dict}catch{throw new Error("Failed to import default google dictionary")}})())}function G(...e){}var Ei=new Set(["value","editor-type","page-size","enabled","class","dictionary-load","popup-position"]),ce,Si=(ce=class extends se{constructor(){super();g(this,"inputRef",ui());g(this,"_controller",null);g(this,"_unsub",null);g(this,"_cleanupNativeListeners",null);g(this,"_customEngine",null);g(this,"_dictionaryState","idle");g(this,"_dictionaryLoadSeq",0);g(this,"_position",null);g(this,"_idleCallbackHandle",null);g(this,"_idleCallbackIsRic",!1);g(this,"_deferredFocusCleanup",null);g(this,"_onWinResize",()=>{this._syncPosition(),this.requestUpdate()});this.value="",this.editorType="input",this.enabled=!0,this.pageSize=5,this.popupPosition="top"}focus(t){let i=this.inputRef.value;if(i){i.focus(t);return}super.focus(t)}blur(){let t=this.inputRef.value;if(t){t.blur();return}super.blur()}_resolvedEngine(){return this._customEngine}_syncPosition(){var r;let t=this.inputRef.value,i=(r=this._controller)==null?void 0:r.getSnapshot();if(!t||!(i!=null&&i.hasActiveComposition)){this._position=null;return}let n=t.getBoundingClientRect();this._position={top:n.top,left:n.left,width:n.width,height:n.height}}_popupStyle(t){return this.popupPosition==="bottom"?`top: ${t.top+t.height+2}px; left: ${t.left}px; width: ${t.width}px;`:this.popupPosition==="left"?`top: ${t.top}px; left: ${t.left-2}px; width: ${t.width}px; transform: translateX(-100%);`:this.popupPosition==="right"?`top: ${t.top}px; left: ${t.left+t.width+2}px; width: ${t.width}px;`:`top: ${t.top}px; left: ${t.left}px; width: ${t.width}px; transform: translateY(-100%) translateY(-2px);`}_getPassThroughAttributes(){let t={};for(let i=0;i<this.attributes.length;i++){let n=this.attributes[i];Ei.has(n.name)||(t[n.name]=n.value)}return t}_importDefaultGoogleDict(){return bi()}_cancelDeferredDictionaryWaiters(){var t;this._idleCallbackHandle!==null&&(this._idleCallbackIsRic&&typeof cancelIdleCallback=="function"?cancelIdleCallback(this._idleCallbackHandle):clearTimeout(this._idleCallbackHandle),this._idleCallbackHandle=null),(t=this._deferredFocusCleanup)==null||t.call(this),this._deferredFocusCleanup=null}_scheduleDeferredIdleCallback(){if(this._dictionaryState==="loading"||this._dictionaryState==="ready"){G("scheduleDeferredIdle skipped",{state:this._dictionaryState});return}if(this._idleCallbackHandle!==null)return;let t=globalThis.requestIdleCallback;typeof t=="function"?(this._idleCallbackIsRic=!0,this._idleCallbackHandle=t.call(globalThis,()=>{this._idleCallbackHandle=null,this._tryKickoffDeferredDictionaryLoad("idle")},{timeout:2e3}),G("scheduled requestIdleCallback (unified-defer)",{timeoutMs:2e3})):(this._idleCallbackIsRic=!1,this._idleCallbackHandle=window.setTimeout(()=>{this._idleCallbackHandle=null,this._tryKickoffDeferredDictionaryLoad("idle")},0),G("scheduled setTimeout(0) fallback (unified-defer)"))}_tryKickoffDeferredDictionaryLoad(t){this.isConnected&&this._dictionaryState!=="loading"&&this._dictionaryState!=="ready"&&(G("deferred kickoff → _loadDictionary",{source:t,stateBefore:this._dictionaryState}),this._cancelDeferredDictionaryWaiters(),this._loadDictionary(`deferred:${t}`))}_attachDeferredFocusKickoff(t){var n;if(this._dictionaryState==="ready")return;(n=this._deferredFocusCleanup)==null||n.call(this);let i=()=>{this._tryKickoffDeferredDictionaryLoad("focusin")};t.addEventListener("focusin",i,!0),this._deferredFocusCleanup=()=>{t.removeEventListener("focusin",i,!0)}}_loadDictionary(t){let i=++this._dictionaryLoadSeq;this._dictionaryState="loading",this._customEngine=null,(typeof this.getDictionary=="function"?Promise.resolve(this.getDictionary()):this._importDefaultGoogleDict()).then(r=>{if(i!==this._dictionaryLoadSeq)return;let s=Et(r);this._customEngine=s,gt(s),this._dictionaryState="ready",G("_loadDictionary ok",{trigger:t,requestSeq:i,dictKeyCount:Object.keys(r).length})}).catch(()=>{i===this._dictionaryLoadSeq&&(this._customEngine=null,this._dictionaryState="error",G("_loadDictionary error",{trigger:t,requestSeq:i}))}).finally(()=>{var r;i===this._dictionaryLoadSeq&&((r=this._controller)==null||r.setOptions({getEngine:()=>this._resolvedEngine()}),this.requestUpdate())})}connectedCallback(){super.connectedCallback(),window.addEventListener("resize",this._onWinResize),window.addEventListener("scroll",this._onWinResize,!0),queueMicrotask(()=>{this.isConnected&&this._scheduleDeferredIdleCallback()})}disconnectedCallback(){var t,i;super.disconnectedCallback(),this._cancelDeferredDictionaryWaiters(),(t=this._cleanupNativeListeners)==null||t.call(this),this._cleanupNativeListeners=null,(i=this._unsub)==null||i.call(this),this._unsub=null,this._controller=null,window.removeEventListener("resize",this._onWinResize),window.removeEventListener("scroll",this._onWinResize,!0)}willUpdate(t){t.has("getDictionary")&&(this._cancelDeferredDictionaryWaiters(),this._loadDictionary("property:getDictionary"))}firstUpdated(){let t=this.inputRef.value;t&&(this._controller=new Pt({getValue:()=>this.value,onValueChange:i=>this._onValueChange(i),getElement:()=>this.inputRef.value??null,getEngine:()=>this._resolvedEngine(),enabled:this.enabled,pageSize:this.pageSize}),this._unsub=this._controller.subscribe(()=>{this._syncPosition(),queueMicrotask(()=>this.requestUpdate())}),queueMicrotask(()=>this.requestUpdate()),this._cleanupNativeListeners=this._bindNativeListeners(t),this._dictionaryState!=="ready"&&this._attachDeferredFocusKickoff(t))}_bindNativeListeners(t){let i=l=>{var $;($=this._controller)==null||$.handleBeforeInput(l)},n=l=>{var $;($=this._controller)==null||$.handleKeyDown(l)},r=l=>{var $;($=this._controller)==null||$.handleKeyUp(l)},s=l=>{this._forwardFocusEvent(l)},o=l=>{this._forwardSimpleEvent(l,"select",!1)},a=l=>{this._forwardSimpleEvent(l,"invalid",!0)};return t.addEventListener("beforeinput",i,!0),t.addEventListener("keydown",n,!0),t.addEventListener("keyup",r,!0),t.addEventListener("focus",s,!0),t.addEventListener("blur",s,!0),t.addEventListener("focusin",s,!0),t.addEventListener("focusout",s,!0),t.addEventListener("select",o,!0),t.addEventListener("invalid",a,!0),()=>{t.removeEventListener("beforeinput",i,!0),t.removeEventListener("keydown",n,!0),t.removeEventListener("keyup",r,!0),t.removeEventListener("focus",s,!0),t.removeEventListener("blur",s,!0),t.removeEventListener("focusin",s,!0),t.removeEventListener("focusout",s,!0),t.removeEventListener("select",o,!0),t.removeEventListener("invalid",a,!0)}}_forwardFocusEvent(t){var n;if(t.target!==this.inputRef.value)return;(t.type==="blur"||t.type==="focusout")&&((n=this._controller)==null||n.resetShiftGestureState());let i=new FocusEvent(t.type,{bubbles:!0,composed:!0,cancelable:t.cancelable,relatedTarget:t.relatedTarget});!this.dispatchEvent(i)&&t.cancelable&&t.preventDefault()}_forwardSimpleEvent(t,i,n){if(t.target!==this.inputRef.value)return;let r=new Event(i,{bubbles:!0,composed:!0,cancelable:n});!this.dispatchEvent(r)&&n&&t.cancelable&&t.preventDefault()}_onValueChange(t){this.value=t;let i=this.inputRef.value;i&&(i.value=t),this.dispatchEvent(new CustomEvent("change",{detail:{value:t},bubbles:!0,composed:!0}))}updated(t){var n;(t.has("enabled")||t.has("pageSize")||t.has("value"))&&((n=this._controller)==null||n.setOptions({getValue:()=>this.value,onValueChange:r=>this._onValueChange(r),getElement:()=>this.inputRef.value??null,getEngine:()=>this._resolvedEngine(),enabled:this.enabled,pageSize:this.pageSize}));let i=this.inputRef.value;if(i){i.value!==this.value&&(i.value=this.value);let r=this._getPassThroughAttributes();for(let[s,o]of Object.entries(r))i.setAttribute(s,o)}}_onSelect(t){var i;(i=this._controller)==null||i.selectCandidate(t)}_onPageDelta(t){var i;(i=this._controller)==null||i.addPage(t)}_modeDescription(t){return t?"中文输入模式，按 Shift 切换英文":"英文输入模式，按 Shift 切换中文"}render(){var a;let t=(a=this._controller)==null?void 0:a.getSnapshot(),i=(t==null?void 0:t.hasActiveComposition)&&this._position!=null&&t.pinyinInput.length>0,n=(t==null?void 0:t.chineseMode)!==!1,r=this.enabled?this._modeDescription(n):void 0,s=this.enabled?" pinyin-ime-field--with-mode-badge":"",o=this.editorType==="textarea"?k`<textarea
            ${Ye(this.inputRef)}
            class=${`pinyin-ime-textarea${s}`}
            .value=${this.value}
            aria-label=${r}
            title=${r}
            @input=${this._onNativeInput}
          ></textarea>`:k`<input
            ${Ye(this.inputRef)}
            class=${`pinyin-ime-input${s}`}
            .value=${this.value}
            aria-label=${r}
            title=${r}
            @input=${this._onNativeInput}
          />`;return k`
      <div class="pinyin-ime-field-wrap">
        ${o}
        ${this.enabled?k`<span
              part="mode-badge"
              class="pinyin-ime-mode-badge"
              aria-hidden="true"
              >${n?"中":"A"}</span
            >`:S}
        ${i?this._renderPopup():S}
      </div>
    `}_onNativeInput(t){let i=t.target;i.value!==this.value&&this._onValueChange(i.value)}_onPopupMouseDown(t){t.preventDefault()}_renderPopup(){let t=this._controller,i=this._position;if(!t||!i)return S;let n=this._dictionaryState==="loading",{pinyinInput:r,pinyinCursorPosition:s,pinyinSelectionStart:o,pinyinSelectionEnd:a,candidates:l,displayCandidates:$,page:b,pageSize:c,highlightedCandidateIndex:w}=t.getSnapshot(),A=Math.ceil(l.length/c)||1,M=b>0,U=(b+1)*c<l.length;return k`
      <div
        part="popup"
        class="pinyin-ime-popup"
        style=${this._popupStyle(i)}
        @mousedown=${this._onPopupMouseDown}
      >
        <div part="pinyin-bar" class="pinyin-ime-pinyin-bar">
          ${o!==a?k`${r.substring(0,o)}<span
                  part="pinyin-selection"
                  class="pinyin-ime-pinyin-selection"
                  >${r.substring(o,a)}</span
                >${r.substring(a)}`:k`${r.substring(0,s)}<span
                  part="cursor"
                  class="pinyin-ime-cursor"
                ></span
                >${r.substring(s)}`}
        </div>
        <div part="candidate-list" class="pinyin-ime-candidate-list">
          ${n?k`<div part="loading" class="pinyin-ime-loading"
                >加载中…</div
              >`:$.length>0?$.map((m,x)=>{let I=b*c+x,h=w===I;return k`
                    <div
                      part=${h?"candidate-row candidate-row-active":"candidate-row"}
                      class="pinyin-ime-candidate-row ${h?"pinyin-ime-candidate-row--active":""}"
                      role="option"
                      aria-selected=${h?"true":"false"}
                      @mousedown=${u=>{u.preventDefault(),this._onSelect(m)}}
                    >
                      <span part="candidate-index" class="pinyin-ime-candidate-index"
                        >${x+1}.</span
                      >
                      <span part="candidate-text" class="pinyin-ime-candidate-text"
                        >${m.word}</span
                      >
                    </div>
                  `}):k`<div part="empty" class="pinyin-ime-empty">无候选词</div>`}
        </div>
        ${!n&&l.length>c?k`
              <div part="footer" class="pinyin-ime-footer">
                <div class="pinyin-ime-footer-nav">
                  <span
                    class="pinyin-ime-page-link ${M?"":"pinyin-ime-page-link--disabled"}"
                    @mousedown=${m=>{m.preventDefault(),M&&this._onPageDelta(-1)}}
                    >&lt; (-)</span
                  >
                  <span
                    class="pinyin-ime-page-link ${U?"":"pinyin-ime-page-link--disabled"}"
                    @mousedown=${m=>{m.preventDefault(),U&&this._onPageDelta(1)}}
                    >(=) &gt;</span
                  >
                </div>
                <span>${b+1} / ${A}</span>
              </div>
            `:S}
      </div>
    `}},g(ce,"styles",[it(_i)]),g(ce,"properties",{value:{type:String,converter:{fromAttribute(t){return t??""}}},editorType:{type:String,attribute:"editor-type",converter:{fromAttribute(t){return mi(t)}}},pageSize:{type:Number,attribute:"page-size",converter:{fromAttribute(t){return yi(t)}}},enabled:{type:Boolean,converter:{fromAttribute(t){return ci(t)},toAttribute(t){return t?null:"false"}},reflect:!0},popupPosition:{type:String,attribute:"popup-position",converter:{fromAttribute(t){return fi(t)},toAttribute(t){return gi(t)}}},getDictionary:{attribute:!1}}),ce);customElements.get("pinyin-ime-editor")||customElements.define("pinyin-ime-editor",Si);/*! Bundled license information:

@lit-labs/ssr-dom-shim/lib/element-internals.js:
@lit-labs/ssr-dom-shim/lib/events.js:
  (**
   * @license
   * Copyright 2023 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit-labs/ssr-dom-shim/lib/css.js:
  (**
   * @license
   * Copyright 2024 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit-labs/ssr-dom-shim/index.js:
@lit/reactive-element/node/css-tag.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/node/lit-html.js:
lit-element/lit-element.js:
lit-html/node/directive.js:
lit-html/node/async-directive.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/node/is-server.js:
  (**
   * @license
   * Copyright 2022 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/node/directive-helpers.js:
lit-html/node/directives/ref.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/export{V as DictionaryLoadError,Mi as IME_PAGE_SIZE,Pt as PinyinIMEController,Si as PinyinIMEEditor,St as assertPinyinDictShape,ie as clampIMPageSize,xi as computeMatchedLength,Et as createPinyinEngine,Ci as getCandidates,Ai as joinClassNames,Pi as loadPinyinDictFromUrl};
//# sourceMappingURL=index-DEzc4NB7.js.map
