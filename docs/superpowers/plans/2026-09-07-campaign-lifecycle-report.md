# Correzione del ciclo di vita delle campagne

Data: 2026-09-07. Implementazione e gate automatici completati; smoke test dell'estensione compilata superato.

## Causa riprodotta

Una campagna favorita già acquisita poteva ricevere uno snapshot successivo con progresso zero. La normalizzazione ricostruiva un summary `farmable` senza riconciliarlo con le prove locali più forti. Il planner accettava così un'aggiunta reale ma invalida, la persisteva e generava la notifica; la transizione poteva fallire nella preparazione oppure avviarla se anche la proiezione precedente aveva già cancellato le prove. Il problema precedeva le notifiche.

La regressione usa il percorso pubblico `FarmingAutomation.request`, un adapter Twitch controllato e la persistenza reale in memoria. Non sono stati acquisiti i payload Twitch dell'episodio originale: è riprodotto il meccanismo e la sequenza di effetti, senza attribuire a uno specifico payload storico una causa non osservata.

L'audit ha riprodotto anche la sopravvivenza di voci manuali completate, il reinserimento dell'incumbent durante preemption, la regressione tramite aggiornamenti content/cache/progressivi, la selezione esplicita e il restore di una campagna terminale. Le race comprendono completamento durante discovery, scadenza durante preparazione watch e cambiamenti di completion/Stop/account durante lo storage.

## Comportamento risultante

- Le prove positive di acquisizione prevalgono sugli snapshot regressivi prima del ranking e degli effetti. La coda esistente viene riconciliata con le stesse prove.
- `acquiredCampaignIds` conserva i Twitch campaign ID anche dopo la scomparsa dal catalogo. `campaignEvidenceUserId` limita le prove all'account: token rinnovato dello stesso viewer conserva i dati, cambio viewer elimina i dati derivati dall'account. Preferenze e identità manuali restano disponibili.
- Il registro contiene soltanto acquisizione positiva (`all-acquired` o flag di completamento già stabilito), mai scadenza, assenza di streamer o `farming-complete`. Quest'ultimo resta rivalutabile con nuove prove farmabili. I campi opzionali sono normalizzati al caricamento; non viene cambiata la versione dei record di automazione.
- Un diverso campaign ID dello stesso gioco resta eleggibile. Nome, lingua e ordine dei risultati non costituiscono nuove identità. Senza campaign ID non si crea un record terminale persistente.
- Claim pendente e acquisizione non sono equivalenti. Un claim osservato resta disponibile anche se uno snapshot debole lo omette; i premi futuri non vengono attivati né interpretati come campagne completate.
- La selezione mentre il farming è attivo rifiuta campagne terminali; l'ispezione in idle/pausa resta consentita. Lo startup usa l'avanzamento della coda esistente prima di riavviare il monitoraggio di una selezione terminale.
- Fingerprint e controlli al commit comprendono le prove di completamento e rileggono il tempo. Una scrittura invalidata non promuove lo stato preparato e ripristina lo stato durevole corrente.

## Mappa dell'audit

| Confine | Verifica/correzione |
| --- | --- |
| Discovery e normalizzazione API | Riconciliazione del progresso per drop + campaign ID prima delle directory e dei preferiti. |
| Identità | Riutilizzo di `gameKey` e `isSameGameIdentity`; registro per campaign ID Twitch, separato dal viewer. |
| Persistenza e caricamento | Normalizzazione dei campi, account binding, conservazione nel reset di inattività, protezione delle scritture concorrenti. |
| Rilevamento completamento | Acquisizione monotona; completezza dell'insieme premi e semantica dei reward esistenti preservate. |
| Preferiti, inserimento e priorità | Filtro condiviso prima dei candidati; deduplica del batch; pulizia di voci terminali anche manuali. |
| Farmabilità | Periodo dei reward, claim pendenti, campagne future e scadute; indisponibilità temporanea non terminale. |
| Selezione e attivazione | Guardie nella selezione attiva e prima del commit; incumbent terminale non reinserito. |
| Refresh content/cache/progressivo | Conservazione e applicazione del registro prima delle sostituzioni dello stato. |
| Restart, skip e completion | Avanzamento reale della coda prima del monitoraggio; future-only attende senza falso completamento. |
| Notifiche | Nessuna soppressione cosmetica: gli effetti continuano a dipendere dal piano persistito e dalla transizione accettata; regressioni per ripetizioni e tentativi invalidati. |
| Diagnostica | Motivi di rifiuto nel debug logger esistente, senza credenziali né log normali per ogni campagna. |

## File principali dell'intervento

Nuovi moduli: `src/shared/campaign-eligibility.ts`, `src/background/campaign-completion-evidence.ts`, `src/background/farming-automation-reconciliation.ts`, `src/background/session-account-evidence.ts`.

Confini modificati: `farming-automation-{normalization,discovery,evaluator,gates,candidates,persistence,effects,contracts}.ts`, `favorite-games.ts`, `drops-projection{,-semantics}.ts`, `service-worker-content-utilities.ts`, `games-cache-{orchestration,progressive,refresh-state}.ts`, `drops-tick-selection.ts`, `service-worker-state-lifecycle.ts`, `farming-session.ts`, `session-lifecycle-{completion,queue,transition,transition-state}.ts`, `session-management.ts`, `state-persistence.ts`; contratti/normalizzazione in `src/types/index.ts` e `src/shared/app-state-sync.ts`.

Semantica temporale e callback: `src/shared/reward-scheduling.ts`, `src/shared/drop-order.ts`, `src/shared/drops.ts`, `src/background/drops-selected-projection.ts`, `src/background/farming-session-queue.ts`.

Le modifiche preesistenti del worktree sono state preservate; il diff di baseline è conservato in `/tmp/drophunter-campaign-lifecycle-before.patch`. La verifica rispetto a tale baseline, ricostruita con un indice Git temporaneo senza modificare quello del repository, ha isolato il delta dei file tracciati in `/tmp/drophunter-lifecycle-tracked-delta.patch`: 31 file, 299 inserimenti e 66 rimozioni. Questo conteggio esclude file nuovi e file già non tracciati. Non sono stati creati commit, tag o release.

## Regressioni

- `campaign-completion-lifecycle.test.ts`: percorso pubblico, snapshot regressivi, sparizione/ritorno, nuova identità, completamento durante discovery, expiry durante preparazione, claim, ripetizioni.
- `campaign-queue-invariants.test.ts`: duplicati e summary/flag discordanti.
- `content-campaign-completion.test.ts`: aggiornamento content dopo sparizione, barriera di inizializzazione e prove legacy presenti soltanto in coda/selezione; tre regressioni rosse prima del fix.
- `campaign-selection-completion.test.ts` e `startup-completed-campaign.test.ts`: selezione esplicita e restore.
- `session-account-evidence.test.ts` e `farming-automation-completion-race.test.ts`: account, caricamento, storage intercalato con completion/Stop/cambio viewer.
- `reward-scheduling-period.test.ts`: inizio/fine e claim; suite lifecycle per campagne con soli premi futuri.
- `farming-preemption-terminal-incumbent.test.ts`: regressioni rosse per incumbent acquisito/scaduto, poi verdi.
- `games-cache-acquired-evidence.test.ts`: cinque regressioni per acquisizione preesistente, scomparsa/ritorno, snapshot progressivo e annotazioni restituite ai chiamanti.
- `inspected-campaign-completion.test.ts`: selezione di B dopo ispezione di A acquisita, refresh fallita e automazione successiva; A non riparte.
- `farming-automation-policy-activity-race.test.ts`: una scrittura invalidata non lascia nello storage un'attività di aggiunta inesistente. Le attività sono ora preparate su una copia e persistite insieme al piano.

Il vecchio test che pretendeva la regressione di `allDropsCompleted` sotto dati peggiori è stato aggiornato alla terminalità richiesta. Il test della facade include il metodo di avanzamento già esistente ora esposto al restore.

Il service worker dei test è un singleton condiviso: il nuovo registro rendeva visibili prove lasciate da casi precedenti. Il reset della fixture in `tests/helpers/service-worker-harness.ts` usa un hook accanto a quelli già presenti in `service-worker.ts`, che elimina le prove correlate tra casi senza alterare la regola di runtime. La suite service-worker e quella di transizione gestita passano tutti i 50 test.

## Verifica finale

| Comando | Risultato |
| --- | --- |
| `rtk proxy bun test tests/` | **1790 pass, 0 fail**, 4947 assertion, 178 file. |
| `rtk proxy bun run test:ts` | Superato (`tsc --noEmit`). |
| `rtk proxy bun run lint` | Superato, 627 file controllati. |
| `rtk proxy bun run build:all` | Superato, Chrome MV3 ed Edge MV3. |
| `rtk proxy bun audit` | Nessuna vulnerabilità rilevata. |
| `rtk proxy bun /tmp/drophunter-lifecycle-smoke.mjs` | Superato su Chromium con la build finale. |

Log: `/tmp/drophunter-lifecycle-tests-final-gate.log`, `/tmp/drophunter-lifecycle-build-final-gate.log`, `/tmp/drophunter-lifecycle-browser-final.log`.

Lo smoke test invia messaggi runtime reali: campagna acquisita → catalogo vuoto → stessa campagna con flag falso e summary farmabile → aggiunta manuale → Start. Risultato: `added: false`, motivo `already-completed`; Start rifiutato con errore esplicito; stato persistito non in esecuzione, coda vuota, campagna ancora acquisita. Nessun errore JavaScript della pagina. Screenshot ispezionato: `/tmp/drophunter-lifecycle-final-popup.png`, indicatore Complete e pulsante Add disabilitato.

## Limiti e policy

La terminalità vale per lo stesso campaign ID. Se Twitch riutilizzasse quell'ID aggiungendo nuovi reward dopo l'acquisizione completa, il registro continuerebbe a escluderlo, coerentemente con il requisito approvato. Il reset esplicito dei dati dell'estensione elimina anche questa memoria; il reset di inattività la conserva.

Le prove legacy prive di owner sono associate al viewer persistito se disponibile; in assenza di identità affidabile vengono scartate al binding, evitando contaminazione tra account. Non si ricostruisce una provenienza storica che i vecchi record non contenevano.

Le notifiche esterne non hanno una garanzia exactly-once attraverso un crash fra invio e ack locale. Restano la policy e le ricevute esistenti; i test verificano gli effetti locali dei tentativi rifiutati e dei replay gestiti.

La QA browser usa un profilo Chromium isolato con estensione reale. Non sostituisce un soak Twitch autenticato con campagne disponibili: quest'ultimo resta da eseguire secondo `docs/soak-test-checklist.md`.
