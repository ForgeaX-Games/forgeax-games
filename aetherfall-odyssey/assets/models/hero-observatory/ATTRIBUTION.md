# Aetherfall Hero Observatory — Attribution

> [!IMPORTANT]
> This asset is a modified derivative of **Sponza Atrium** and remains licensed under
> [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).
> Preserve this file and `LICENSE` with every redistribution.

## Credits

| Contribution | Author / project |
|:--|:--|
| Original Sponza Atrium model, August 19, 2010 | Frank Meinl / Crytek |
| Geometry corrections, July 14, 2011 | Morgan McGuire |
| PBR texture preparation | Alexandre Pestana |
| glTF 2.0 conversion | Khronos Group, `glTF-Sample-Models`, using glTF-Transform |
| Aetherfall derivative packaging, August 7, 2026 | ForgeaX project contributors |

## Upstream

- Repository: <https://github.com/KhronosGroup/glTF-Sample-Models>
- Source directory: [`2.0/Sponza`](https://github.com/KhronosGroup/glTF-Sample-Models/tree/main/2.0/Sponza)
- ForgeaX verified source: `packages/editor/packages/engine/forgeax-engine-assets/khronos-gltf-samples/Sponza/`
- Upstream license: CC BY 3.0 Unported

## Derivative changes

| Change | Applied result |
|:--|:--|
| Spatial selection | Central three-span, negative-Z colonnade; every retained triangle is fully inside source bounds `x[-610, 570]`, `y[-10, 940]`, `z[-350, -120]` |
| Geometry | 1 mesh, 9 material-grouped primitives, 26,329 triangles; unused vertices compacted and compatible same-material primitives joined without changing vertices, bounds, or textures |
| Materials | 9 retained architectural/fabric materials; unrelated foliage, flowers, roof, chains, and distant ornament removed |
| Textures | 27 embedded 1024×1024 JPEG PBR textures, recompressed at quality 88 |
| Coordinates | Recentered at ground level and converted from source units to meters with scale `0.008` |
| Packaging | Standalone binary glTF (`hero-observatory.glb`) plus ForgeaX importer sidecar; vertex attributes use separate dense buffer views accepted by the ForgeaX importer |

No new third-party geometry or texture data was introduced.

> [!NOTE]
> On August 8, 2026, glTF-Transform 4.4.2 repacked the joined mesh from
> interleaved 48-byte vertex records to separate dense attribute buffers. The
> 45 logical accessor arrays and all 27 embedded JPEG payloads remain
> byte-for-byte identical after decoding; primitive, triangle, material,
> texture, scene, and draw counts are unchanged. The importer-compatible GLB is
> 9,334,720 bytes with SHA-256
> `6408184b84d0cfe28f44d34056de078210b506dceb657e697d9eb4b5f5facb09`.
