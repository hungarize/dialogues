# Public Dialogue Database Sync

This workflow maintains the public Notion dialogue catalogue from the private Dialogue database.

## Safety rules

- The private Dialogue database is the source of truth.
- Only rows with `Status = Published` are eligible.
- The source query is restricted to the inclusive window:
  `checkpoint date <= Last published <= current date in Europe/Budapest`.
- Future-dated source rows are excluded by the Notion API query and are not scanned by the script.
- Public page bodies remain empty. Only approved database properties are copied.
- The public database description contains the checkpoint date. It is advanced only after every create/update succeeds.
- A failed run leaves the previous checkpoint in place, making the next run retry the same window.

## Copied properties

| Private source | Public destination |
| --- | --- |
| Title | Title |
| Patreon URL | Patreon URL |
| Note type | Note type |
| Language note | Language note |
| Tags | Tags |
| Elementary | START \| Elementary |
| Pre-Intermediate | CLASSIC \| Pre-Inter |
| Intermediate | CLASSIC \| Inter |
| Upper-Intermediate | CLASSIC \| Upper |
| Private page ID | Source Page ID |

`Expression` maps to the public database's existing `Expression ` option.

## Matching order

For a source row in the eligible date window, the script searches the public database in this order:

1. Source Page ID
2. Exact normalised Patreon URL
3. Title + mapped Level + Note type + Language note
4. Title + Language note, only when unique
5. If no match exists, create a new empty public row

This allows old public rows to acquire their permanent Source Page ID lazily when they are republished, without a full historical source scan.

## Schedule and manual runs

The workflow runs every day at 07:00 using the `Europe/Budapest` timezone. Scheduled runs always apply changes.

Manual runs offer two modes:

- `dry-run`: reads and reports; writes nothing.
- `apply`: creates/updates public rows and advances the checkpoint after success.

## GitHub secret

The repository must contain an Actions secret named `NOTION_TOKEN`. The corresponding Notion connection needs read access to the private Dialogue database and read/insert/update access to the public database.
