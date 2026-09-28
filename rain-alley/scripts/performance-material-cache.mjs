import { MeshRenderer } from '@forgeax/engine-render';
// Discarded runtime candidate: retained only to reproduce the cache A/B.
// Own a frozen copy; never freeze imported payloads or Shader registry objects.
function staticMaterial(material) {
  const copy=structuredClone(material);
  function freeze(value) {
    if(!value || typeof value!=='object' || ArrayBuffer.isView(value))return;
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  freeze(copy);return copy;
}
const originals = [];
export function swapStaticMaterials() {
  const { world } = window.__forgeax;
  const cache = new Map();
  for (const row of world.query({read:[MeshRenderer]}).unwrap()) {
    const entity = row.entity, data = {...row.get(MeshRenderer)}, materials = [...data.materials];
    let changed = false;
    for(let i=0;i<materials.length;i++) {
      const resolved=world.sharedRefs.resolve(materials[i]);
      if(!resolved.ok || !resolved.value.passes?.some(p=>p.program.module==='forgeax_material::standard'))continue;
      if(!cache.has(materials[i]))cache.set(materials[i],world.internSharedRef('MaterialAsset',staticMaterial(resolved.value)));
      materials[i]=cache.get(materials[i]);changed=true;
    }
    if(changed){originals.push({entity,data});world.set(entity,MeshRenderer,{...data,materials}).unwrap();}
  }
  return {materials:cache.size,entities:originals.length};
}
export function restoreStaticMaterials(){
  const {world}=window.__forgeax;
  for(const {entity,data} of originals.splice(0))world.set(entity,MeshRenderer,data).unwrap();
}
export async function compareStaticMaterialPixels(){
  const {app}=window.__forgeax,canvas=document.querySelector('canvas');
  async function pixels(){
    await app.stepFrame(0);
    const img=new Image();img.src=canvas.toDataURL();await img.decode();
    const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,c.width,c.height).data;
  }
  app.pause();
  try{
    const before=await pixels(),swapped=swapStaticMaterials(),after=await pixels();
    let max=0,total=0,changed=0;
    for(let i=0;i<before.length;i++){const d=Math.abs(before[i]-after[i]);max=Math.max(max,d);total+=d;if(d>1)changed++;}
    return {...swapped,channels:before.length,max,mean:total/before.length,changed};
  }finally{restoreStaticMaterials();app.resume();}
}
