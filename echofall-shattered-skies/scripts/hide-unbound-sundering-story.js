(function () {
  const named = query({ with: ['Name'] }).rows;
  const story = named.filter((row) => /^Story/.test(row.Name.value));
  const visibility = new Map(query({ with: ['Name', 'Visibility'] }).rows.map((row) => [row.Name.value, row]));
  const commands = [];
  for (const row of story) {
    const current = visibility.get(row.Name.value);
    commands.push(current
      ? { kind: 'setComponent', entity: row.entity, component: 'Visibility', patch: { state: 1 } }
      : { kind: 'addComponent', entity: row.entity, component: 'Visibility', value: { state: 1 } });
  }
  const revision = named.find((row) => /^(WorldAssetRevision|WorldAssetBindingOffset)_\d+$/.test(row.Name.value));
  if (revision && revision.Name.value !== 'WorldAssetBindingOffset_000') {
    commands.push({ kind: 'setComponent', entity: revision.entity, component: 'Name', patch: { value: 'WorldAssetBindingOffset_000' } });
  }
  if (commands.length === 0) return { ok: true, hidden: 0, reason: 'no story entities require fail-safe' };
  const result = gateway.dispatch({ kind: 'transaction', label: 'Hide unbound Sundering story assets before staged binding', commands }, 'ai');
  return { ok: result.ok, hidden: story.length, progressReset: Boolean(revision), result };
})()
