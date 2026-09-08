# Beta.15 — ricorrenza delle notifiche di campagne completate

Data: 2026-09-08. Gate di rilascio superato e beta.15 ricaricata nel Chrome dell'utente.

## Evidenza dal browser installato

Chrome mostra DropHunter `4.0.0-beta.14`, caricato da `~/repos/trevonerd/drophunter/.output/chrome-mv3`, ID `ahibkgdhemobcmobhkokmgekpcfnmnpm`.

Le sette campagne delle notifiche sono presenti nel popup come Complete. Una lettura locale dello storage, limitata a campagna, completion e presenza dei campi, mostra `hasLedger:false` e `hasOwner:false`. L'attività persistita contiene la preemption verso Dead by Daylight del `2026-09-08T07:40:31.128Z` (09:40 locali), confermando che non si trattava soltanto di testo Telegram duplicato.

Il `background.js` aperto dal worker tramite DevTools non contiene `acquiredCampaignIds` (ricerca: 0 risultati); il file su disco prima della nuova build ne contiene 8 occorrenze. Il worker registrato da Chrome non ha quindi caricato la correzione precedente. Ricompilare la cartella unpacked senza ricaricare l'estensione non ha aggiornato quel worker. La precedente consegna aveva verificato una nuova istanza isolata, ma non l'istanza realmente usata dall'utente.

## Due ulteriori difetti riprodotti e corretti

1. **Identità temporaneamente vuota.** Una sessione può essere sanitizzata con `userId: ''` in attesa del rilevamento. Il caricamento preferiva quella stringa vuota all'owner persistito e cancellava le campagne acquisite. Ora conserva le prove mentre l'identità è sconosciuta; lo stesso account le mantiene e un account diverso le invalida. L'automazione aspetta un'identità non vuota prima di discovery/directory.
2. **Inventario nullo accettato.** `TwitchApiClient.fetchInventorySnapshot` restituiva i drop base invariati anche se `currentUser.inventory` era nullo o malformato. L'adapter interpretava questa risposta come verifica riuscita. Attraverso client reale e percorso pubblico di automazione, il test rosso produceva 1 ricerca directory, 2 notifiche e farming avviato. Ora fallisce prima degli effetti; un inventario strutturalmente valido ma vuoto continua a consentire premi realmente disponibili.

Questi test provano i due meccanismi; non dimostrano quale payload Twitch o quale sessione abbia prodotto l'episodio storico. La differenza fra bundle caricato e bundle su disco è invece stata osservata direttamente.

## Modifiche funzionali e regressioni

- `src/background/session-account-evidence.ts`: nessuna cancellazione per identità assente.
- `src/background/state-persistence.ts`: fallback sull'owner persistito quando il viewer della sessione è vuoto.
- `src/background/farming-automation-twitch.ts`: attesa dell'identità prima di refresh/directory.
- `src/background/twitch-api/client.ts`: controllo strutturale dell'inventario prima di restituire successo.
- `tests/session-evidence-missing-user.test.ts`: restart, recupero e risoluzione dello stesso/diverso account; rosso prima del fix.
- `tests/farming-automation-inventory-validation.test.ts`: quattro forme invalide, due identità vuote e inventario valido vuoto; percorso notifiche/avvio verificato.
- `package.json`, `tests/manifest-permissions.test.ts`: versione pubblica `4.0.0-beta.15`, tecnica `3.99.0.15`.

Il gate iniziale ha inoltre rilevato sei file sopra il limite di 250 pure LOC introdotti/ampliati durante il lavoro precedente. Le estrazioni necessarie conservano i contratti pubblici e sono verificate dalla suite completa; nessuna regola del gate è stata disabilitata.

Estratti: storage adapter in `farming-automation-storage.ts`; helper/tipi preferiti in `favorite-campaign-queue-helpers.ts`; validazione dell'insieme premi in `campaign-reward-identity.ts`; refresh della testa in `session-lifecycle-queue-refresh.ts`; storage credenziali in `session-credentials-storage.ts`; `ClaimLogEntry` in `types/claim-log.ts`. I reexport preservano i chiamanti.

## Verifiche

Prima delle estrazioni: 1800 test passati, 0 falliti, 4971 assertion; TypeScript e lint superati; `bun audit` senza vulnerabilità. Log in `/tmp/drophunter-beta15-tests.log`.

Dopo le estrazioni: `bun run release:check` termina con **All release checks passed**, includendo scope TypeScript, compilazione TypeScript, Biome, suite completa, build+ZIP Chrome/Edge, manifest e archivi. Log: `/tmp/drophunter-beta15-release-check-final.log`. `git diff --check` superato. Nessuna strumentazione temporanea aggiunta ai sorgenti; preservate le modifiche preesistenti.

Verifica nativa dopo Reload sulla pagina Chrome dell'estensione:

```json
{"version":"4.0.0-beta.15","ownerPresent":true,"acquiredCount":8,"reportedCount":7,"allReportedAcquired":true,"invalidQueued":0,"running":true,"selected":"Path of Exile 2","progress":43}
```

Quindi tutte e sette le campagne segnalate sono nel registro e nessuna è in coda; il farming corrente di Path of Exile 2 è ripreso. La scheda diagnostica creata per il controllo è stata chiusa. Non è stata forzata alcuna notifica Telegram di prova. Il controllo autenticato di aggiornamento/restore non sostituisce il soak di due ore o una nuova osservazione notturna.

| Archivio | SHA-256 |
| --- | --- |
| `.output/drophunter-4.0.0-beta.15-chrome.zip` | `138e0397b467d00eda579d8a9f0f8053d584271254369848f1d9b28425be44ff` |
| `.output/drophunter-4.0.0-beta.15-edge.zip` | `8b75720eff3d3ff6b0738891c0cc5cee99c4e345c73aa1cde1f67169f0832b5a` |

Entrambi i manifest negli ZIP riportano `version: 3.99.0.15` e `version_name: 4.0.0-beta.15`.

La beta resta per installazioni locali/GitHub, non per gli store. Non sono richiesti nuovi permessi e non sono stati creati commit, tag o pubblicazioni.
