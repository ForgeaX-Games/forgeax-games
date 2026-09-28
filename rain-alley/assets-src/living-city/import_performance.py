"""Official glTF metadata import for the derived performance assets only.
Pass the matching Engine cli-gltf.mjs path as the sole argument on another machine.
"""
import json, subprocess, sys
from pathlib import Path
G=Path(__file__).resolve().parents[2]
CLI=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/Users/you/dev/ForgeaX-Games/forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/gltf/dist/cli-gltf.mjs')
for source in sorted((G/'assets/performance').glob('*.glb')):
    meta=Path(str(source)+'.meta.json')
    before=json.loads(meta.read_text()) if meta.exists() else None
    subprocess.run(['bun',str(CLI),'import',str(source)],check=True)
    data=json.loads(meta.read_text());live={s['sourceKey'] for s in data['subAssets']}
    stale=[key for key in data.get('sourceOverrides',{}) if key not in live]
    for key in stale:
        assert key.startswith('mesh:') and set(data['sourceOverrides'][key]) <= {'materialSlots'}
        del data['sourceOverrides'][key]
    ids=[s['guid'] for s in data['subAssets']]
    assert len(ids)==len(set(ids)), 'Duplicate subasset GUID; stop before publishing'
    scene=lambda j:next(s['guid'] for s in j['subAssets'] if s['kind']=='scene')
    if before:assert scene(before)==scene(data), 'Scene GUID drift'
    if stale:meta.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    print(source.name,scene(data),'removed obsolete slots',len(stale))
