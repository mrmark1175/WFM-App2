import{c as d}from"./index-DsKN475d.js";/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const i=[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"17 8 12 3 7 8",key:"t8dd8p"}],["line",{x1:"12",x2:"12",y1:"3",y2:"15",key:"widbto"}]],u=d("upload",i),s="intraday_forecast",c="intraday_fte";function f(n){return String(n).toLowerCase()==="blended"?"blended":"dedicated"}function y(n){const e=String(n).toLowerCase();return e==="email"||e==="chat"||e==="cases"?e:"voice"}function $({organizationId:n="default",lobId:e,lobName:a,channel:t,staffingMode:o}){const r=e!=null&&e!==""?`lob:${e}`:`lob:${a??"default"}`;return`org:${n??"default"}:${r}:channel:${t}:staffing:${o}`}function _(n,e){return`${s}:${n}:${e}`}function p(n,e){return`${c}:${n}:${e}`}export{s as L,u as U,p as a,_ as b,$ as c,f as d,c as e,y as n};
