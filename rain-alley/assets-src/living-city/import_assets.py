"""Official importer for this generated pack; removes only obsolete generated slot records.
Old importer keeps sourceOverrides for removed mesh names. Never delete sidecars/GUIDs.
"""
from pathlib import Path
import subprocess,json,uuid
H=Path(__file__).resolve().parent;G=H.parents[1]
CLI=Path('/Users/you/dev/ForgeaX-Games/forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/gltf/dist/cli-gltf.mjs')
report=[]
for p in sorted((G/'assets/living-city').glob('*.glb')):
 meta=Path(str(p)+'.meta.json');before=json.loads(meta.read_text()) if meta.exists() else None
 subprocess.run(['bun',str(CLI),'import',str(p)],check=True)
 j=json.loads(meta.read_text());live={s['sourceKey'] for s in j['subAssets']};removed=[]
 for key in list(j.get('sourceOverrides',{})):
  if key not in live:
   payload=j['sourceOverrides'][key]
   assert key.startswith('mesh:') and set(payload)<= {'materialSlots'},(key,payload)
   removed.append(key);del j['sourceOverrides'][key]
 seen=set();remapped=[]
 for item in j['subAssets']:
  if item['guid'] in seen:
   assert item['kind']=='mesh'
   item['guid']=str(uuid.uuid5(uuid.UUID(next(a['guid'] for a in j['subAssets'] if a['kind']=='scene')),item['sourceKey']));remapped.append(item['sourceKey'])
  seen.add(item['guid'])
 if removed or remapped:meta.write_text(json.dumps(j,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
 if before:assert next(s['guid'] for s in before['subAssets'] if s['kind']=='scene')==next(s['guid'] for s in j['subAssets'] if s['kind']=='scene')
 report.append({'asset':p.name,'removedObsoleteGeneratedOverrides':removed,'sceneGuidPreserved':before is not None,'duplicateMeshIdentitiesRepaired':remapped})
(H/'import-audit.json').write_text(json.dumps(report,indent=2)+'\n');print('IMPORTED',len(report),'assets; GUID/schema audits saved')
