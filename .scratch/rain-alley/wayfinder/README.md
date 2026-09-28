# Wayfinding operations (local markdown)

This folder is the issue tracker for the Rain Alley wayfinder map. There is no GitHub project board for these decision tickets.

## Layout

- `MAP.md` — the map (`wayfinder:map`)
- `issues/Wxx-*.md` — child tickets
- `research/` — cited findings written by research tickets

## Identity

The filename stem is the issue id (`W01`, `W07`). Refer to tickets by **title**, with the path inside the name.

## Labels

Frontmatter `labels` uses one of: `wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, `wayfinder:task`.

## Blocking

Local tracker has no native graph. `blocked_by` is a list of ids. A ticket is unblocked when every id in `blocked_by` has `status: closed`.

## Claim

Set `assignee` to the person or agent driving the ticket **before** work. `assignee: null` means unclaimed.

## Frontier

Open tickets whose `blocked_by` are all closed and `assignee` is null.

## Resolution

1. Comment the answer under `## Resolution` in the ticket file.
2. Set `status: closed`.
3. Append one gist line to `MAP.md` → Decisions so far, linking the ticket.

## Charting vs old whitebox tickets

`.scratch/rain-alley/issues/01–14` are build tickets from the whitebox spec. They are not children of this map. Do not treat them as the destination.
