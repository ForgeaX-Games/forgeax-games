(function () {
  const named = query({ with: ['Name'] }).rows;
  const revision = named.find((row) => /^WorldAssetBindingOffset_\d+$/.test(row.Name.value));
  const bindingOffset = revision ? Number(revision.Name.value.split('_').at(-1)) : 0;
  if (bindingOffset < 82) return { ok: false, reason: 'story binding revision incomplete', bindingOffset, requiredOffset: 82 };
  const story = named.filter((row) => /^Story/.test(row.Name.value));
  const meshes = new Map(query({ with: ['Name', 'MeshFilter'] }).rows.map((row) => [row.Name.value, row]));
  const renderers = new Map(query({ with: ['Name', 'MeshRenderer'] }).rows.map((row) => [row.Name.value, row]));
  const sharedRaw = (value) => typeof value === 'number' ? value : value?.raw;
  const invalid = story.filter((row) => {
    const mesh = sharedRaw(meshes.get(row.Name.value)?.MeshFilter?.assetHandle);
    const materials = renderers.get(row.Name.value)?.MeshRenderer?.materials;
    return !(typeof mesh === 'number' && mesh > 0 && materials?.length > 0 && sharedRaw(materials[0]) > 0);
  });
  if (invalid.length > 0) return { ok: false, reason: 'story assets remain unbound', invalid: invalid.map((row) => row.Name.value) };
  const visible = new Map(query({ with: ['Name', 'Visibility'] }).rows.map((row) => [row.Name.value, row]));
  const commands = story.map((row) => ({
    kind: 'setComponent', entity: row.entity, component: 'Visibility', patch: { state: 0 },
  })).filter((_, index) => visible.has(story[index].Name.value));
  if (commands.length === 0) return { ok: true, revealed: 0, reason: 'already inherited-visible' };
  const result = gateway.dispatch({ kind: 'transaction', label: 'Reveal fully bound Sundering story assets', commands }, 'ai');
  return { ok: result.ok, revealed: commands.length, bindingOffset, result };
})()
