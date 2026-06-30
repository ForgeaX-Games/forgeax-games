// Bake per-node world-space AABB colliders from a GLB, applying the scene.json
// entity Transform (scale + offset). Output: assets/<name>.colliders.json
// — a flat list of boxes {nx,ny,nz,xx,xy,xz} (min/max) the FPS uses for
// per-mesh collision (UE-style: every static mesh node = one box).
import { readFileSync, writeFileSync } from 'node:fs';

const GLB = process.argv[2] || 'assets/IntelliScene_Demo.glb';
const OUT = process.argv[3] || 'assets/IntelliScene_Demo.colliders.json';
// Parameterized scale (argv[4]) + auto-derived centring T. Raw GLB bounds:
// x∈[-64,64], z∈[-103,103], floor surface ~y=0.537 (UE5.2 export, 1 unit = 1 m).
// World transform: world_pos = local * S + T, with T chosen so the model is
// centred in X/Z and the floor surface lands at world y=0 (matches scene.json
// IntelliScene_Demo.Transform — keep both in sync).
const S = Number(process.argv[4] ?? 1);
const TX = -64 * S, TY = -0.537 * S, TZ = 84.5 * S;

const buf = readFileSync(GLB);
const magic = buf.readUInt32LE(0); if (magic !== 0x46546c67) throw new Error('not glb');
let off = 12;
const clen = buf.readUInt32LE(off); const ctype = buf.readUInt32LE(off + 4); off += 8;
if (ctype !== 0x4e4f534a) throw new Error('first chunk not JSON');
const gltf = JSON.parse(buf.toString('utf8', off, off + clen));

const A = gltf.accessors || [], M = gltf.meshes || [], N = gltf.nodes || [];
const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const mul = (a,b)=>{const r=new Array(16).fill(0);for(let i=0;i<4;i++)for(let j=0;j<4;j++){let s=0;for(let k=0;k<4;k++)s+=a[i*4+k]*b[k*4+j];r[i*4+j]=s;}return r;};
function loc(n){
  if(n.matrix){const m=n.matrix;return[m[0],m[4],m[8],m[12],m[1],m[5],m[9],m[13],m[2],m[6],m[10],m[14],m[3],m[7],m[11],m[15]];}
  const t=n.translation||[0,0,0],q=n.rotation||[0,0,0,1],s=n.scale||[1,1,1];
  const[qx,qy,qz,qw]=q,xx=qx*qx,yy=qy*qy,zz=qz*qz,xy=qx*qy,xz=qx*qz,yz=qy*qz,wx=qw*qx,wy=qw*qy,wz=qw*qz;
  const R=[1-2*(yy+zz),2*(xy-wz),2*(xz+wy),0, 2*(xy+wz),1-2*(xx+zz),2*(yz-wx),0, 2*(xz-wy),2*(yz+wx),1-2*(xx+yy),0, 0,0,0,1];
  const Sm=[s[0],0,0,0, 0,s[1],0,0, 0,0,s[2],0, 0,0,0,1];
  const Mx=mul(R,Sm); Mx[3]=t[0];Mx[7]=t[1];Mx[11]=t[2]; return Mx;
}
const xf=(m,x,y,z)=>[m[0]*x+m[1]*y+m[2]*z+m[3], m[4]*x+m[5]*y+m[6]*z+m[7], m[8]*x+m[9]*y+m[10]*z+m[11]];

// Mesh-name prefixes whose AABB is intentionally NOT a player blocker. UE
// authored these as decorative or "opening"-class geometry (stair armrails go
// to 5.4 m tall, door panels and door frames are 2.3 m solid AABBs that would
// otherwise seal every opening). Including them here turns the bake from
// "every mesh is a wall" into "every wall mesh is a wall, openings stay open".
const SKIP_PREFIXES = [
  'SM_stair_armrest',   // stair rail — would wall off staircases
  'SM_Door',            // door panel — should be open / passable
  'SM_Door_Frame',      // door frame — opening, not a wall
  'SM_decorative_panel',// decorative
  'SM_curtain',         // curtains
  'SM_armrest',         // armrest (non-stair)
  'Win_',               // windows — visual only, the surrounding wall blocks
];
const isSkipped = (name) => {
  if (!name) return false;
  for (const p of SKIP_PREFIXES) if (name.startsWith(p)) return true;
  return false;
};
let skipped = 0;

const boxes=[];
function walk(ni,par){
  const n=N[ni]; const m=mul(par,loc(n));
  if(n.mesh!==undefined){
    if (isSkipped(n.name)) { skipped++; for(const c of (n.children||[])) walk(c,m); return; }
    let bb=[1e9,1e9,1e9,-1e9,-1e9,-1e9];
    for(const p of (M[n.mesh].primitives||[])){
      const pa=p.attributes&&p.attributes.POSITION; if(pa===undefined)continue;
      const a=A[pa]; if(!a.min||!a.max)continue;
      for(const cx of[a.min[0],a.max[0]])for(const cy of[a.min[1],a.max[1]])for(const cz of[a.min[2],a.max[2]]){
        const[wx,wy,wz]=xf(m,cx,cy,cz);
        bb[0]=Math.min(bb[0],wx);bb[1]=Math.min(bb[1],wy);bb[2]=Math.min(bb[2],wz);
        bb[3]=Math.max(bb[3],wx);bb[4]=Math.max(bb[4],wy);bb[5]=Math.max(bb[5],wz);
      }
    }
    if(bb[0]<1e8){
      // apply entity transform: scale then translate (no entity rotation)
      boxes.push([bb[0]*S+TX, bb[1]*S+TY, bb[2]*S+TZ, bb[3]*S+TX, bb[4]*S+TY, bb[5]*S+TZ]);
    }
  }
  for(const c of (n.children||[])) walk(c,m);
}
const scn=(gltf.scenes||[{}])[gltf.scene||0]; const roots=scn.nodes||[...N.keys()];
for(const r of roots) walk(r,I);
console.log('skipped non-blocker meshes:', skipped);

// stats
const sz=boxes.map(b=>[b[3]-b[0],b[4]-b[1],b[5]-b[2]]);
const tiny=boxes.filter((b,i)=>sz[i][0]<0.05&&sz[i][1]<0.05&&sz[i][2]<0.05).length;
console.log('mesh-node boxes:',boxes.length,' tiny(<5cm):',tiny);
const ys=boxes.map(b=>b[1]).sort((a,b)=>a-b);
console.log('floor-y range: min=%s p10=%s median=%s',ys[0].toFixed(2),ys[(ys.length*0.1|0)].toFixed(2),ys[ys.length>>1].toFixed(2));
console.log('footprint x:[%s,%s] z:[%s,%s] y:[%s,%s]',
  Math.min(...boxes.map(b=>b[0])).toFixed(1),Math.max(...boxes.map(b=>b[3])).toFixed(1),
  Math.min(...boxes.map(b=>b[2])).toFixed(1),Math.max(...boxes.map(b=>b[5])).toFixed(1),
  Math.min(...boxes.map(b=>b[1])).toFixed(1),Math.max(...boxes.map(b=>b[4])).toFixed(1));
writeFileSync(OUT, JSON.stringify({version:1, source:GLB, transform:{s:S,tx:TX,ty:TY,tz:TZ}, boxes:boxes.map(b=>b.map(v=>+v.toFixed(3)))}));
console.log('wrote',OUT, (JSON.stringify(boxes).length/1024|0)+'KB');
