# DropHunter backup format

DropHunter backups are local JSON files for moving user preferences and personal history between installations. The format belongs to DropHunter and remains independent of the extension's release version.

## Envelope

Use a stable root identifier and a root format version. Version each section independently so one section can evolve without making the others unreadable.

```json
{
  "format": "drophunter-backup",
  "formatVersion": 1,
  "extensionVersion": "4.0.0",
  "exportedAt": "2026-10-01T12:00:00.000Z",
  "sections": {
    "settings": { "version": 1, "data": {} },
    "favorites": { "version": 1, "data": [] },
    "hidden": { "version": 1, "data": [] },
    "statistics": { "version": 1, "data": {} },
    "history": { "version": 1, "data": [] }
  }
}
```

`format` must equal `drophunter-backup`. `extensionVersion` records which DropHunter build created the file; it does not control compatibility. Root `formatVersion` is an exact compatibility gate: this implementation accepts version 1 and rejects other values. Ignore and report unknown root keys, section names, section metadata, and data fields; never apply them. If a known section has an unsupported or invalid version, skip that section and explain why. The user can still select compatible sections for import.

`totalTwitchAdsBlocked` is a local-only usage count with low sensitivity. It defaults to zero, is never exported or imported, and remains local during backup imports.

Accept JSON files up to 10 MiB, and enforce the same limit when exporting. Validate the envelope, section versions, and every field before changing local state. Treat imported content as untrusted data: do not execute it or interpret markup. Parsing makes no network requests. Reward images may use only HTTPS on `static-cdn.jtvnw.net`, without credentials or an explicit port. Strip other image URLs, report the excluded field in the preview, and retain the reward entry.

## Portable fields

Only these sections and fields may be exported. Adding a field requires documenting its portability, default, sensitivity, and import behavior here before implementation.

| Section and fields | Portable | Default | Sensitivity | Import behavior |
| --- | --- | --- | --- | --- |
| `settings`: `monitorAutoOpen`, `muteFarmingTab`, `twitchAdblockEnabled`, `notificationsEnabled`, `autoClaimChannelPointsBonus`, `autoClaimDrops`, `autoStartFavoriteGames`, `streamerSelectionMode`, `preferredStreamerLanguage`, `campaignPriorityMode`, `farmCategoryScope`, `watchTransportPreference` | Yes | `twitchAdblockEnabled` defaults to `true` on fresh installs; absent import fields preserve local values | Low; personal choices | Apply valid present fields when backup settings are selected. Missing optional fields preserve local values; older importers may ignore this field. Disable desktop notifications when those settings are applied; favorite auto-start is disabled after every import. Never import Telegram credentials or chat identifiers. |
| `favorites`: entries with required `gameId`, `lastKnownName`, `addedAt`, and optional `identityKeys` | Yes | Empty list on a fresh installation; retain the local list when the section or field is absent | Low; reveals game preferences | Merge by shared `gameId` or `identityKeys` overlap. These identities classify games; they do not inherently identify separate campaigns. Replacement uses the imported list only when the user selected this section and the section data is valid. |
| `hidden`: entries with required `gameId`, `lastKnownName`, `hiddenAt`, and optional `identityKeys` | Yes | Empty list on a fresh installation; retain the local list when the section or field is absent | Low; reveals game preferences | Merge by shared `gameId` or `identityKeys` overlap. These identities classify games; they do not inherently identify separate campaigns. Replacement uses the imported list only when the user selected this section and the section data is valid. |
| `statistics`: optional `totalDropsClaimed`, `totalChannelPointsClaimed` | Yes | Zero on a fresh installation; retain local values when a field is absent | Low; aggregate usage history | Merge channel-point totals by addition, including on repeated imports. Derive the drop total from distinct merged history entries, floored at the local total before history is capped. Replacement sets present values only. Values must be nonnegative safe integers; invalid values reject the section, and an overflowing channel-point sum rejects the import. |
| `history`: entries with required `id`, `dropId`, `dropName`, `gameId`, `gameName`, `campaignLabel`, `claimedAt`; optional `claimId`, `benefitName`, `campaignId`, `campaignName`, `imageUrl` | Yes | Empty list on a fresh installation; retain the local log when the section or field is absent | Moderate; reveals claimed rewards and dates | Merge by distinct entry `id`, keeping the newest copy, sort newest first, and cap at 5,000 entries. Repeated imports do not duplicate entries. Replacement replaces the log only when the user selected this section and valid section data is present; still sort and cap. Invalid entries reject the section. |

Settings never include current running/paused state, selected game, queue, queue authorization, active streamer, drops snapshot, campaign cache, recovery data, session identifiers, browser tab/window IDs, tokens, cookies, Telegram secrets, runtime timestamps, or diagnostic data (including `twitchAdblockUnavailable`). This denylist applies even if those values appear in the local application state.

## Import behavior

Present sections are independent. Let the user choose which compatible sections to import. A missing section or missing optional field leaves its local value untouched; on a fresh installation that value stays at its default. This rule lets newer backups add optional fields without overwriting preferences on older installations.

For merge imports, combine favorites and hidden categories by campaign-aware identity, add channel-point totals (so importing the same backup twice adds them twice), derive the drop total from the distinct merged history count with the local total as a floor, and union history entries by distinct ID. For replacement imports, replace only selected sections and only when their section data is present. Within a present replacement section, leave any omitted optional field unchanged (or at its default on a fresh installation).

Favorite auto-start is disabled after every import, including imports that contain only favorites or history. Desktop notifications are disabled when backup settings are applied; if settings are left local, preserve the local notification choice. Import must never start farming or resume a paused session. Apply an import only while farming is stopped; if the session is running or paused, explain that the user must stop it first. The user can explicitly enable favorite auto-start and any restored notification preference afterward.

Validate and normalize sections before applying them. Invalid sections are marked unavailable while compatible sections remain selectable. If the final import fails validation or its local data changed after preview, leave local data unchanged. Report skipped unsupported sections and ignored unknown fields so the user can review what the file contained.

## Versioning and migrations

When replacing just Favorites or Hidden categories, preserve the opposing local collection. Exclude conflicting imported entries and show their count in the preview; select both sections to replace their classifications together. Confirm preview warnings before applying partial results.

Keep every section migration pure: take JSON-like section data and a source version, return normalized data or a validation failure, and perform no storage, UI, clock, or network operations. Retain historical backup fixtures permanently and test every supported migration against them. A migration must not reinterpret unknown fields as known fields or broaden the export allowlist.

Keep a section version when adding optional fields that older importers can ignore. Bump that section version when its representation changes incompatibly, and provide a pure migration for every supported prior version. Retain permanent tests and fixtures for each published historical format; never rewrite or remove an old fixture. The root `formatVersion` is the envelope's major compatibility gate, separate from `extensionVersion`: bump it only when envelope-level compatibility changes, and reject unknown root versions unless a root migration is explicitly implemented. Section incompatibility still permits import of other compatible sections.
