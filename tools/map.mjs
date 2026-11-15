// Top-down plan of the layout -> out/shots/map.png
import { launch } from './browser.mjs';
import { LAYOUT as L } from '../src/world/layout.js';
import fs from 'node:fs'; import path from 'node:path'; import { ROOT } from './server.mjs';
const b = L.buildings; const hs = b.map(x => x.h);
console.log('buildings', b.length, 'blocks', L.blocks.length, 'bounds', L.bounds, 'maxH', Math.max(...hs).toFixed(0), 'avgH', (hs.reduce((a, c) => a + c, 0) / hs.length).toFixed(1));
const st = {}; b.forEach(x => st[x.style] = (st[x.style] || 0) + 1); console.log('styles', st);
const ds = {}; b.forEach(x => ds[x.district] = (ds[x.district] || 0) + 1); console.log('districts', ds, 'tramX', L.tram.x, 'streets', L.streets.length, 'bridges', L.bridges.length);
const data = JSON.stringify({ b: b.map(x => [x.x0, x.z0, x.x1, x.z1, x.h, x.style]), blocks: L.blocks.map(k => [k.x0, k.z0, k.x1, k.z1, k.kind]), canal: L.canal, basin: L.basin, tram: L.tram, harbor: L.harbor, lantern: L.lantern, bridges: L.bridges, bounds: L.bounds, QX: L.QUAY_X });
const html = `<canvas id=c width=1700 height=1150></canvas><script>
const D=${data}; const c=document.getElementById('c'), g=c.getContext('2d');
const X0=-1300, X1=1300, Z0=-900, Z1=860; const sx=c.width/(X1-X0), sz=c.height/(Z1-Z0); const s=Math.min(sx,sz);
const px=x=>(x-X0)*s, pz=z=>(z-Z0)*s;
g.fillStyle='#27455c'; g.fillRect(0,0,c.width,c.height);
g.fillStyle='#8f8a80'; g.fillRect(px(D.QX),0,c.width,c.height);
g.fillStyle='#27455c'; g.fillRect(px(D.canal.x0),pz(D.canal.z0),(D.canal.x1-D.canal.x0)*s,(D.canal.z1-D.canal.z0)*s); g.fillRect(px(D.basin.x0),pz(D.basin.z0),(D.basin.x1-D.basin.x0)*s,(D.basin.z1-D.basin.z0)*s);
for(const k of D.blocks){ g.fillStyle=k[4]==='park'?'#4f7a45':k[4]==='square'?'#b9ad98':k[4]==='built'?'#a59f93':'#c9b28a'; g.fillRect(px(k[0]),pz(k[1]),(k[2]-k[0])*s,(k[3]-k[1])*s); }
const col={brick:[150,80,60],stone:[190,180,160],glass:[90,140,170],concrete:[140,140,140],stucco:[210,180,140],deco:[200,170,110]};
for(const q of D.b){ const cc=col[q[5]]||[255,0,255]; const k=0.45+0.55*Math.min(1,q[4]/160); g.fillStyle='rgb('+cc.map(v=>Math.round(v*k)).join(',')+')'; g.fillRect(px(q[0])+0.5,pz(q[1])+0.5,(q[2]-q[0])*s-1,(q[3]-q[1])*s-1); if(q[4]>70){ g.fillStyle='#fff'; g.font='9px sans-serif'; g.fillText(Math.round(q[4]),px(q[0])+2,pz(q[1])+10);} }
g.strokeStyle='#ff3'; g.lineWidth=2; g.beginPath(); g.moveTo(px(D.tram.x),pz(D.tram.z0)); g.lineTo(px(D.tram.x),pz(D.tram.z1)); g.stroke();
g.fillStyle='#ff3'; for(const t of D.tram.stations) g.fillRect(px(D.tram.x)-4,pz(t.z)-t.length*s/2,8,t.length*s);
g.fillStyle='#f55'; for(const br of D.bridges) g.fillRect(px(br.x0),pz(br.z0),(br.x1-br.x0)*s,(br.z1-br.z0)*s);
const h=D.harbor; g.fillStyle='#ddd'; g.beginPath(); g.arc(px(h.lighthouse.x),pz(h.lighthouse.z),h.lighthouse.islandRadius*s,0,7); g.fill();
g.strokeStyle='#999'; g.lineWidth=h.breakwater.width*s; g.beginPath(); g.moveTo(px(h.breakwater.x0),pz(h.breakwater.z0)); g.lineTo(px(h.breakwater.x1),pz(h.breakwater.z1)); g.stroke();
g.fillStyle='#b98'; g.fillRect(px(h.pier.x0),pz(h.pier.z0),(h.pier.x1-h.pier.x0)*s,(h.pier.z1-h.pier.z0)*s); for(const j of h.jetties) g.fillRect(px(j.x0),pz(j.z0),(j.x1-j.x0)*s,(j.z1-j.z0)*s);
g.strokeStyle='#8cf'; g.lineWidth=1; g.setLineDash([4,4]); g.beginPath(); h.ferryRoute.forEach((p,i)=>i?g.lineTo(px(p[0]),pz(p[1])):g.moveTo(px(p[0]),pz(p[1]))); g.stroke();
g.fillStyle='#fff'; g.font='13px sans-serif'; g.fillText('N (-Z) up, sun sets WEST (left)   grid 100 m',10,18);
g.strokeStyle='rgba(255,255,255,.12)'; g.setLineDash([]); for(let x=-1300;x<=1300;x+=100){g.beginPath();g.moveTo(px(x),0);g.lineTo(px(x),c.height);g.stroke(); g.fillStyle='rgba(255,255,255,.5)'; g.font='9px sans-serif'; g.fillText(x,px(x)+2,c.height-4);} for(let z=-900;z<=860;z+=100){g.beginPath();g.moveTo(0,pz(z));g.lineTo(c.width,pz(z));g.stroke(); g.fillText(z,2,pz(z)-2);}
<\/script>`;
const br = await launch({ width: 1700, height: 1150 }); const p = await br.newPage(); await p.setContent(html);
fs.mkdirSync(path.join(ROOT, 'out/shots'), { recursive: true });
await p.screenshot({ path: path.join(ROOT, 'out/shots/map.png') }); await br.close(); console.log('map written');
