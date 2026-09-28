/** Runtime LOD transitions must not issue new asset requests after bootstrap. */
export async function runLodSmoke() {
  const api = window.__rainFps;
  const assets = () => performance.getEntriesByType('resource')
    .filter(r => /\/(asset|import)\//.test(r.name)).length;
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const before = assets();
  api.relocate([28, .9, -58]); await delay(300);
  const far = api.snapshot().targets[0].lod;
  api.relocate([0, .9, -3]); await delay(300);
  const near = api.snapshot().targets[0].lod;
  return { pass: far?.far === true && near?.far === false && assets() === before,
    far, near, assetRequestsBefore: before, assetRequestsAfter: assets() };
}
