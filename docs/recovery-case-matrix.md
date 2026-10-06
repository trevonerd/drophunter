# Matrice di recupero e aggiornamento

## Play dalla coda, verifica streamer e rotazione — 6 ottobre 2026

Il Play richiede campagne e inventario freschi e completi prima di confermare il cambio. Il watch corrente resta attivo durante la ricerca e viene conservato se la preparazione del candidato fallisce. Sessione assente, campagne indisponibili, inventario indisponibile e cooldown Twitch restituiscono errori distinti. Stop, Pausa, selezione diversa e cambio account rendono obsolete le risposte tardive.

La preparazione gestita accetta anche un candidato senza segnale Drops nel DOM quando il playback è pronto e la verifica conferma esplicitamente diretta, canale e categoria. Un segnale DOM assente conserva lo stato di salute degradato; prove mancanti, player non pronto, canale offline o categoria errata impediscono il cambio.

La ricerca applica i canali autorizzati prima del fallback lingua. Un risultato vuoto richiede un aggiornamento della campagna e una seconda verifica; i canali autorizzati fuori dalla directory vengono interrogati direttamente senza heartbeat di visione. Una verifica incompleta resta un errore temporaneo e non consuma tentativi per assenza di streamer.

Il ciclo di stallo ammette lo streamer iniziale e tre sostituti diversi, con una riparazione iniziale del player e l'intera finestra di osservazione per ogni sostituto. I nomi falliti appartengono all'identità della campagna e sopravvivono a restart e Pausa/Riprendi. Un retry player pendente non provoca un salto della coda; solo quattro stalli confermati o alternative esaurite dopo verifica consentono il parcheggio.

| Caso | Evidenza |
|---|---|
| Snapshot vecchio/parziale, inventario fallito, sessione recuperata e cooldown | `tests/farming-automation-twitch.test.ts`, `tests/managed-watch-startup-integration.test.ts` |
| HTTP 401 nell'inventario, un solo recupero e watch del Play conservato; HTTP 429 nell'inventario o nei dettagli delle campagne | `tests/api-operations.test.ts`, `tests/campaign-detail-rate-limit.test.ts` |
| Play duplicato, altra campagna dello stesso gioco, risposta tardiva dopo Stop | `tests/queued-campaign-start.test.ts` |
| Canale autorizzato in altra lingua o fuori dai primi 30; verifica incompleta, lenta e annullata | `tests/eligible-streamer-discovery.test.ts`, `tests/queued-campaign-start.test.ts` |
| Campagna fresca con catalogo mancante/incompleto; Pausa/Stop durante probe o secondo refresh | `tests/fresh-farmable-game.test.ts`, `tests/queued-campaign-start.test.ts` |
| HTTP 429 nella verifica diretta seguito da refresh indisponibile; cooldown salvato subito e ripristinato dopo riciclo worker | `tests/recovery-loop-regressions.test.ts`, `tests/managed-watch-startup-integration.test.ts` |
| Pulsante Play del popup con refresh completo; candidato playback fallito che conserva il watch | `e2e/queue-campaign-handoff.spec.ts` |
| Play con segnale Drops DOM assente ma playback, diretta, canale e categoria verificati; rifiuto di prove mancanti o negative | `tests/farming-automation-browser.test.ts`, `e2e/queue-campaign-handoff.spec.ts` |
| Streamer iniziale e tre sostituti, retry pendente e stallo verificato | `tests/stalled-progress-recovery.test.ts`, `tests/stalled-campaign-block.test.ts` |
| Progresso fresco durante la verifica di parcheggio; risposta directory tardiva senza ricreare il blocco | `tests/stalled-campaign-progress-race.test.ts` |
| Progresso di campagna inattiva, campagne duplicate e snapshot non verificato; reset limitato alla campagna corretta | `tests/drops-projection-semantics.test.ts` |
| Nomi falliti normalizzati e persistiti dopo restart/Pausa; nuovo ciclo dopo dieci minuti | `tests/state-persistence-session.test.ts`, `tests/queue-acquisition-round.test.ts` |
| Alternativa esaurita e avanzamento reale alla campagna successiva; tab conservata durante più giri | `tests/farming-session-watch-transport.test.ts`, `e2e/queue-campaign-handoff.spec.ts` |

Verifica automatizzata con Bun 1.4.2: TypeScript sorgenti e test, lint senza warning, 2.435 test unitari, 23 E2E Chrome MV3 e build Chrome/Edge superati. `vexp verify_done` non rileva errori di parsing; le segnalazioni di import dell'indice riguardano export/re-export esistenti, verificati dai due compilatori TypeScript e dalla suite completa dei test interessati.

Prova reale del 6 ottobre in Brave: caricata la build finale da `.output/chrome-mv3`, con versione locale invariata `4.0.0-beta.57` e modifiche non pubblicate. Il Play dalla coda ha avviato PAYDAY 3; dopo il ricaricamento finale il monitor ha ripreso la sessione su BadgeBase. Il recupero playback ha poi scelto GALIL_Weevil33. Il tracker ufficiale Twitch confermava inizialmente Chains al 3,33%; i successivi dati Twitch nel popup sono avanzati dal 3% al 13% per Chains, dall'1% al 6% per Hoxton e dall'1% al 4% per Wolf. Verificati Pausa a 13%, conservazione della coda e Riprendi sulla stessa campagna; sessione lasciata in RUNNING. Il Play con candidato non preparabile ha conservato la campagna corrente e mostrato l'errore di playback.

Questa osservazione breve conferma Play, ripresa e progresso reale. La sequenza completa di quattro streamer fermi e sleep/wake restano coperti dai test, non da una prova reale prolungata; un ciclo completo può richiedere fino a ottanta minuti.

## Falso rilevamento della visione manuale — 5 ottobre 2026

Una scheda video conservata da DropHunter dopo il passaggio al trasporto nascosto non è una scheda personale. L'osservazione manuale esclude tutte le schede la cui proprietà è confermata dal registro e dalle prove di sessione o dal marker della pagina, prima di richiedere la telemetria. Un vecchio ID da solo non basta: la navigazione personale resta rilevabile. Se le prove non sono disponibili o sono ambigue, l'osservazione fallisce senza generare una nuova sospensione; la valutazione automatica riceve anche gli ID in preparazione.

Verifica automatizzata con Bun 1.4.2: TypeScript sorgenti e test, lint senza warning, 2.372 test unitari, 20 E2E Chrome MV3, audit dipendenze e build/archivi Chrome/Edge superati con il gate completo `release:check` per `4.0.0-beta.57` (manifest tecnico `3.99.0.57`). Il nuovo E2E verifica il vecchio video gestito durante il farming nascosto, la precedenza di un vero stream personale in background e la ripresa dopo la sua chiusura. Questa modifica è inclusa nella prerelease GitHub beta.57.

| Caso | Evidenza |
|---|---|
| Trasporto nascosto con vecchio video gestito ancora attivo; nessun evento di sospensione | `tests/retained-managed-manual-watch.test.ts`, `e2e/queue-campaign-handoff.spec.ts` |
| Ricostruzione senza trasporto corrente, ID rimappato, più schede gestite e scheda in preparazione | `tests/retained-managed-manual-watch.test.ts` |
| Navigazione personale, registro obsoleto, marker ambiguo o indisponibile, errore storage | `tests/retained-managed-manual-watch.test.ts` |
| Vera visione personale in background e ripresa al termine | `tests/manual-watch-detector.test.ts`, `tests/farming-automation-manual-watch.test.ts` |

Verifica reale sul profilo interessato: caricare la build corretta mantenendo la coda; osservare almeno due tick dopo un cambio campagna e dopo il passaggio al farming nascosto con la vecchia scheda ancora in riproduzione. Non devono comparire stato manuale o avviso Telegram senza una scheda personale. Ripetere dopo riciclo del worker e sleep/wake; aprire poi uno stream personale e verificarne la precedenza e la ripresa al termine. La riproduzione automatizzata conferma il difetto del codice, ma non ricostruisce da sola la sequenza dell'avviso originale delle 21:34.

## Ciclo continuo della coda — 5 ottobre 2026

La sessione autorizzata conserva le campagne temporaneamente senza streamer, con playback fallito o progresso fermo. Ogni campagna mantiene i tentativi e le attese già previste; solo dopo un giro esaurito parte l'attesa di dieci minuti, persistita in `queueAcquisitionRound.nextRoundAt`. L'apertura del video non azzera il giro: servono nuovi minuti, progresso o acquisizione confermati da Twitch. Nuovi streamer idonei possono anticipare una riprova; una directory invariata conserva la scadenza.

Verifica automatizzata della modifica con Bun 1.4.2: TypeScript sorgenti e test, lint senza warning, 2.360 test unitari, 19 E2E Chrome MV3 e build Chrome/Edge superati. Il nuovo E2E percorre due giri completi di campagne senza progresso, verifica il timer tra i giri, conserva il medesimo ID della tab dopo un solo clic iniziale e controlla sostituzione dopo chiusura e assenza di riaperture dopo Stop.

La successiva `4.0.0-beta.56` ha superato anche il gate completo `release:check`: controllo dimensione e regole TypeScript, audit dipendenze, archivi Chrome/Edge e verifica dei manifest `3.99.0.56` con `version_name` coerente.

Popup e monitor mostrano attesa o tentativo in corso e tutte le campagne ancora da recuperare, ricavate da coda, metadati e blocchi persistenti. Pausa e Stop restano autoritativi anche per callback di recupero tardive. La tab gestita resta riutilizzabile durante attesa e cambio campagna; una chiusura effettiva consente una sola sostituzione tramite il registro e la serializzazione esistenti.

| Caso | Evidenza |
|---|---|
| Tre campagne problematiche, più giri, ordine e pausa tra giri | `tests/continuous-queue-recovery.test.ts`, `tests/queue-acquisition-round.test.ts` |
| Directory invariata, comparsa streamer e ripristino worker | `tests/queue-availability-resume.test.ts`, `tests/state-persistence-timing-load.test.ts` |
| Recupero solo con progresso fresco; refresh invariato conserva tentativi e scadenza | `tests/continuous-queue-recovery.test.ts`, `tests/parked-queue-recovery.test.ts`, `tests/games-cache-continuous-recovery.test.ts` |
| Stop/Pausa e callback tardive o duplicate | `tests/farming-recovery-authorization.test.ts`, `tests/farming-stop-pending-acquisition.test.ts` |
| Warning completo, nomi lunghi, oltre venti eventi, campagne risolte/scadute/eliminate | `tests/queue-recovery-notice.test.tsx` |
| Un clic iniziale, tab invariata, riciclo worker e sostituzione dopo chiusura | `e2e/queue-campaign-handoff.spec.ts` |

Per la verifica su Twitch reale in Brave: osservare il progresso prima e dopo un cambio campagna, lasciare esaurire un giro senza progresso, controllare la scadenza reale e la permanenza di Pausa/Stop, verificare il riuso della tab e una sola sostituzione dopo chiusura. Verificare inoltre che Stop impedisca riaperture e che sleep/wake non anticipi o perda il timer. Le simulazioni automatiche non sostituiscono una prova prolungata con Twitch reale.

Prova reale del 5 ottobre: ricaricata in Brave la build locale `4.0.0-beta.55` da `.output/chrome-mv3`, conservando la sessione e la coda esistenti. Su Albion Online · Dragonfire 6 - #1/7, canale ElPelotasssss, il progresso osservato dopo il primo ricaricamento è passato dal 72% all'80%; dopo il ricaricamento della build finale è avanzato dal 94% al 96%, quindi al 100% con stato Claimable. Popup e monitor in stato RUNNING, Pausa/Stop disponibili e warning recuperato rimosso. Verificati Pausa e Riprendi nel monitor reale, lasciando la sessione di nuovo in RUNNING. Questa osservazione breve conferma il progresso reale; il giro completo di campagne tutte bloccate e sleep/wake restano simulati nei test, non verificati durante una notte reale.

## Verifiche delle build precedenti

Build verificata: `4.0.0-beta.48`, manifest tecnico `3.99.0.48`. Il 1 ottobre 2026 il gate completo è passato senza warning: TypeScript, lint, 2.302 test unitari, 9 E2E Chrome MV3, audit, build e archivi Chrome/Edge. Anche audit e rendering CTA/promo del progetto video sono passati. Questa beta è destinata alla prerelease GitHub e ai test locali, non agli store.

La beta.48 evita claim e avvisi duplicati, distingue le campagne nei messaggi e mantiene indipendenti browser e Telegram. Gli errori di lettura/scrittura del registro non cancellano le acquisizioni esistenti né sopprimono il fallback di completamento. Conserva la ripresa delle sessioni attive introdotta nella beta.47 e il rispetto di Pausa e Stop. Pausa resta disponibile anche durante il recovery di una sessione attiva.

Archivi: `.output/drophunter-4.0.0-beta.48-chrome.zip` e `.output/drophunter-4.0.0-beta.48-edge.zip`. SHA-256 di entrambi: `ce6f37462e96255e4d4029424684dd558ab2ddb092e45be6a4584ed7a8a16188`.

**A** = asserzioni automatizzate dirette; **P** = copertura parziale o indiretta. Le chiamate Twitch dei test sono simulate; gli E2E usano un vero Chrome MV3 con profili persistenti. `—` indica che restano da verificare le varianti con Twitch reale. Questa esecuzione non ha svolto una sessione manuale su una campagna reale: progresso prolungato, sleep/wake, fallback hidden→managed, visione personale e notifiche restano verifiche prima della versione stabile.

| Area | Variante | Evidenza automatizzata | Esito | Limite |
|---|---|---|---|---|
| Prima installazione | autenticato | tests/popup-entry.test.ts, tests/popup-reward-auth-sync.test.tsx | P | — |
| Prima installazione | disconnesso | tests/popup-entry.test.ts, tests/popup-reward-auth-sync.test.tsx | P | — |
| Prima installazione | onboarding incompleto | tests/popup-entry.test.ts, tests/popup-reward-auth-sync.test.tsx | P | — |
| Start | campagna singola | tests/queue-start.test.ts, tests/queued-campaign-start.test.ts | A | — |
| Start | coda | tests/queue-start.test.ts, tests/queued-campaign-start.test.ts | A | — |
| Start | selezione diversa dalla testa | tests/queue-start.test.ts, tests/queued-campaign-start.test.ts | A | — |
| Comandi ripetuti | doppio Start | tests/farming-session-revision.test.ts, tests/manual-farming-retry.test.ts | P | — |
| Comandi ripetuti | doppio Resume | tests/farming-session-revision.test.ts, tests/manual-farming-retry.test.ts | P | — |
| Comandi ripetuti | Riprova durante un tentativo | tests/farming-session-revision.test.ts, tests/manual-farming-retry.test.ts | P | — |
| Pause | durante playback | tests/farming-stop-pending-acquisition.test.ts, tests/farming-session-revision.test.ts | P | — |
| Pause | durante ricerca | tests/farming-stop-pending-acquisition.test.ts, tests/farming-session-revision.test.ts | P | — |
| Pause | durante fallback | tests/farming-stop-pending-acquisition.test.ts, tests/farming-session-revision.test.ts | P | — |
| Pause | durante retry | tests/farming-stop-pending-acquisition.test.ts, tests/farming-session-revision.test.ts | P | — |
| Resume | dopo pausa | tests/manual-queue-startup-resume.test.ts, tests/v4-queue-continuation.test.ts | A | — |
| Resume | dopo restart | tests/manual-queue-startup-resume.test.ts, tests/v4-queue-continuation.test.ts | A | — |
| Resume | dopo aggiornamento | tests/manual-queue-startup-resume.test.ts, tests/v4-queue-continuation.test.ts | A | — |
| Stop | durante ogni operazione asincrona | tests/session-start-cancellation.test.ts, tests/streamer-acquisition-cancellation.test.ts, tests/manual-farming-retry.test.ts | P | — |
| Coda non autorizzata | aggiunta senza Start | tests/manual-queue-startup-resume.test.ts, tests/recovery-intent-sequences.test.ts | A | — |
| Coda non autorizzata | ripristino dal browser | tests/manual-queue-startup-resume.test.ts, tests/recovery-intent-sequences.test.ts | A | — |
| Modifica coda | aggiunta durante recovery | tests/queue-management.test.ts, tests/farming-session-revision.test.ts | P | — |
| Modifica coda | rimozione durante recovery | tests/queue-management.test.ts, tests/farming-session-revision.test.ts | P | — |
| Modifica coda | riordino durante recovery | tests/queue-management.test.ts, tests/farming-session-revision.test.ts | P | — |
| Modifica coda | svuotamento durante recovery | tests/queue-management.test.ts, tests/farming-session-revision.test.ts | P | — |
| Campagne duplicate | stesso gioco con campagne differenti | tests/campaign-selection.test.ts, tests/drops-projection-semantics.test.ts | A | — |
| Campagne duplicate | benefit duplicati | tests/campaign-selection.test.ts, tests/drops-projection-semantics.test.ts | A | — |
| Preferiti | auto-start acceso | tests/favorite-games.test.ts, tests/farming-automation-preemption.test.ts | P | — |
| Preferiti | auto-start spento | tests/favorite-games.test.ts, tests/farming-automation-preemption.test.ts | P | — |
| Preferiti | nuovo preferito | tests/favorite-games.test.ts, tests/farming-automation-preemption.test.ts | P | — |
| Preferiti | preemption | tests/favorite-games.test.ts, tests/farming-automation-preemption.test.ts | P | — |
| Filtri | nascosti | tests/streamer-selection.test.ts, tests/favorite-games.test.ts | P | — |
| Filtri | lingua | tests/streamer-selection.test.ts, tests/favorite-games.test.ts | P | — |
| Filtri | categoria | tests/streamer-selection.test.ts, tests/favorite-games.test.ts | P | — |
| Filtri | canali ammessi | tests/streamer-selection.test.ts, tests/favorite-games.test.ts | P | — |
| Directory vuota | nessuno live | tests/parked-queue-recovery.test.ts, tests/streamer-acquisition-recovery-budget.test.ts | P | — |
| Directory vuota | nessuno ammesso | tests/parked-queue-recovery.test.ts, tests/streamer-acquisition-recovery-budget.test.ts | P | — |
| Directory vuota | disponibilità successiva | tests/parked-queue-recovery.test.ts, tests/streamer-acquisition-recovery-budget.test.ts | P | — |
| Directory guasta | timeout | tests/streamer-acquisition-timeout-classification.test.ts, tests/client-parsing.test.ts | P | — |
| Directory guasta | payload incompleto | tests/streamer-acquisition-timeout-classification.test.ts, tests/client-parsing.test.ts | P | — |
| Directory guasta | errore GraphQL | tests/streamer-acquisition-timeout-classification.test.ts, tests/client-parsing.test.ts | P | — |
| Playback | HTTP riuscito e apertura falsa | tests/recovery-loop-regressions.test.ts, tests/streamer-acquisition-timeout-classification.test.ts | A | — |
| Playback | eccezione | tests/recovery-loop-regressions.test.ts, tests/streamer-acquisition-timeout-classification.test.ts | A | — |
| Playback | timeout | tests/recovery-loop-regressions.test.ts, tests/streamer-acquisition-timeout-classification.test.ts | A | — |
| Candidati | primo fallisce e secondo funziona | tests/recovery-loop-regressions.test.ts | A | — |
| Candidati | tutti falliscono | tests/recovery-loop-regressions.test.ts | A | — |
| Modalità nascosta | funziona | tests/farming-session-watch-transport.test.ts, tests/watch-transport.test.ts | P | — |
| Modalità nascosta | fallisce | tests/farming-session-watch-transport.test.ts, tests/watch-transport.test.ts | P | — |
| Modalità nascosta | perde heartbeat | tests/farming-session-watch-transport.test.ts, tests/watch-transport.test.ts | P | — |
| Scheda gestita | chiusa | tests/managed-watch-startup-integration.test.ts, tests/watch-transport-restoration.test.ts | P | — |
| Scheda gestita | navigata | tests/managed-watch-startup-integration.test.ts, tests/watch-transport-restoration.test.ts | P | — |
| Scheda gestita | sospesa | tests/managed-watch-startup-integration.test.ts, tests/watch-transport-restoration.test.ts | P | — |
| Scheda gestita | non raggiungibile | tests/managed-watch-startup-integration.test.ts, tests/watch-transport-restoration.test.ts | P | — |
| Scheda gestita | riuso senza ricarica sullo stesso canale, anche dopo rollback | tests/tab-management-tabs.test.ts | A | Twitch reale da verificare |
| Scheda gestita | verifica incerta, tab utente o navigazione in corso | tests/tab-management-tabs.test.ts, tests/managed-watch-preflight-retry.test.ts | A | Attende senza chiudere o creare tab video |
| Scheda gestita | aperture concorrenti e storage temporaneamente guasto | tests/tab-management-tabs.test.ts | A | Un'unica acquisizione condivisa; binding persistente riusato dopo il riavvio |
| Scheda gestita | Stop, candidato fallito e passaggio alla modalita nascosta | tests/managed-watch-pending-navigation.test.ts, tests/managed-watch-startup-integration.test.ts | A | Tab e registro conservati; nuova tab consentita solo al primo Avvia o dopo chiusura confermata |
| Scheda gestita | un clic iniziale, worker riciclato e campagna successiva | e2e/queue-campaign-handoff.spec.ts | A | Chrome MV3: stesso ID, nessuna rimozione o ricarica sullo stesso canale, video attivo e currentTime crescente; Twitch simulato |
| Handoff | successo | tests/watch-transport-handoff.test.ts, tests/watch-transport-races.test.ts | A | — |
| Handoff | candidato fallito | tests/watch-transport-handoff.test.ts, tests/watch-transport-races.test.ts | A | — |
| Handoff | operazione superata | tests/watch-transport-handoff.test.ts, tests/watch-transport-races.test.ts | A | — |
| Finestre | ultima scheda | tests/tab-management-state.test.ts, tests/managed-watch-durable-ownership.test.ts | P | — |
| Finestre | più finestre | tests/tab-management-state.test.ts, tests/managed-watch-durable-ownership.test.ts | P | — |
| Finestre | scheda dell'utente | tests/tab-management-state.test.ts, tests/managed-watch-durable-ownership.test.ts | P | — |
| Visione manuale | idonea | tests/farming-automation-manual-watch.test.ts, tests/manual-watch-policy.test.ts | P | — |
| Visione manuale | non idonea | tests/farming-automation-manual-watch.test.ts, tests/manual-watch-policy.test.ts | P | — |
| Visione manuale | in background | tests/farming-automation-manual-watch.test.ts, tests/manual-watch-policy.test.ts | P | — |
| Visione manuale | terminata | tests/farming-automation-manual-watch.test.ts, tests/manual-watch-policy.test.ts | P | — |
| Rete | offline | tests/streamer-global-recovery.test.ts, tests/api-operations.test.ts | P | — |
| Rete | ritorno online | tests/streamer-global-recovery.test.ts, tests/api-operations.test.ts | P | — |
| Rete | timeout | tests/streamer-global-recovery.test.ts, tests/api-operations.test.ts | P | — |
| Rete | HTTP 5xx | tests/streamer-global-recovery.test.ts, tests/api-operations.test.ts | P | — |
| Rate limit | 429 senza header | tests/api-operations.test.ts, tests/client-parsing.test.ts | P | — |
| Rate limit | 429 con header valido | tests/api-operations.test.ts, tests/timing-retry-after-normalization.test.ts | P | Parsing e persistenza simulati; Twitch reale da verificare |
| Rate limit | 429 con header malformato | tests/api-operations.test.ts, tests/client-parsing.test.ts | P | — |
| Sessione | cache assente | tests/session-management.test.ts, tests/session-account-evidence.test.ts | P | — |
| Sessione | credenziali scadute | tests/session-management.test.ts, tests/session-account-evidence.test.ts | P | — |
| Sessione | cambio account | tests/session-management.test.ts, tests/session-account-evidence.test.ts | P | — |
| Integrity | scaduta | tests/integrity-token.test.ts, tests/integrity-campaign-recovery.test.ts | P | — |
| Integrity | rifiutata | tests/integrity-token.test.ts, tests/integrity-campaign-recovery.test.ts | P | — |
| Integrity | verifica browser fallita | tests/integrity-token.test.ts, tests/integrity-campaign-recovery.test.ts | P | — |
| Progresso | crescente | tests/drops-projection-semantics.test.ts, tests/stalled-campaign-block.test.ts | P | — |
| Progresso | fermo | tests/drops-projection-semantics.test.ts, tests/stalled-campaign-block.test.ts | P | — |
| Progresso | snapshot vecchio | tests/drops-projection-semantics.test.ts, tests/stalled-campaign-block.test.ts | P | — |
| Progresso | snapshot parziale | tests/drops-projection-semantics.test.ts, tests/stalled-campaign-block.test.ts | P | — |
| Ricompense | watch-time | tests/reward-semantics.test.ts, tests/reward-scheduling.test.ts | A | — |
| Ricompense | future | tests/reward-semantics.test.ts, tests/reward-scheduling.test.ts | A | — |
| Ricompense | subscription | tests/reward-semantics.test.ts, tests/reward-scheduling.test.ts | A | — |
| Ricompense | evento | tests/reward-semantics.test.ts, tests/reward-scheduling.test.ts | A | — |
| Ricompense | Twitch-native | tests/reward-semantics.test.ts, tests/reward-scheduling.test.ts | A | — |
| Claim | successo | tests/auto-claim-drops.test.ts, tests/auto-claim.test.ts | P | — |
| Claim | fallimento | tests/auto-claim-drops.test.ts, tests/auto-claim.test.ts | P | — |
| Claim | risposta tardiva | tests/auto-claim-drops.test.ts, tests/auto-claim.test.ts | P | — |
| Claim | claim manuale | tests/auto-claim-drops.test.ts, tests/auto-claim.test.ts | P | — |
| Fine campagna | completata | tests/startup-completed-campaign.test.ts, tests/queue-management.test.ts | P | — |
| Fine campagna | scaduta | tests/startup-completed-campaign.test.ts, tests/queue-management.test.ts | P | — |
| Fine campagna | sparita autorevolmente | tests/startup-completed-campaign.test.ts, tests/queue-management.test.ts | P | — |
| Dati mancanti | cache vuota | tests/activation-sync-session-recovery.test.ts, tests/drops-projection-semantics.test.ts | P | — |
| Dati mancanti | refresh fallito | tests/activation-sync-session-recovery.test.ts, tests/drops-projection-semantics.test.ts | P | — |
| Dati mancanti | snapshot parziale | tests/activation-sync-session-recovery.test.ts, tests/drops-projection-semantics.test.ts | P | — |
| Retry | prima della scadenza | tests/recovery-loop-regressions.test.ts, tests/crash-recovery.test.ts | P | — |
| Retry | esattamente alla scadenza | tests/recovery-loop-regressions.test.ts, tests/crash-recovery.test.ts | P | — |
| Retry | dopo la scadenza | tests/recovery-loop-regressions.test.ts, tests/crash-recovery.test.ts | P | — |
| Scheduler | allarme perso | tests/recovery-loop-regressions.test.ts, tests/activation-retry-scheduler-recovery.test.ts | P | — |
| Scheduler | allarme ritardato | tests/recovery-loop-regressions.test.ts, tests/activation-retry-scheduler-recovery.test.ts | P | — |
| Scheduler | allarme duplicato | tests/recovery-loop-regressions.test.ts, tests/activation-retry-scheduler-recovery.test.ts | P | — |
| Scheduler | creazione fallita | tests/farming-recovery-alarm.test.ts, tests/activation-retry-scheduler-recovery.test.ts | A | — |
| Concorrenza | sync lenta | tests/recovery-loop-regressions.test.ts, tests/manual-farming-retry.test.ts, tests/farming-session-revision.test.ts | P | — |
| Concorrenza | alarm e popup | tests/recovery-loop-regressions.test.ts, tests/manual-farming-retry.test.ts, tests/farming-session-revision.test.ts | P | — |
| Concorrenza | retry e Stop | tests/recovery-loop-regressions.test.ts, tests/manual-farming-retry.test.ts, tests/farming-session-revision.test.ts | P | — |
| Concorrenza | risultati fuori ordine | tests/recovery-loop-regressions.test.ts, tests/manual-farming-retry.test.ts, tests/farming-session-revision.test.ts | P | — |
| Worker | terminazione prima del tentativo | tests/crash-recovery.test.ts, tests/streamer-acquisition-cancellation.test.ts | P | — |
| Worker | durante il tentativo | tests/crash-recovery.test.ts, tests/streamer-acquisition-cancellation.test.ts | P | — |
| Worker | dopo il tentativo | tests/crash-recovery.test.ts, tests/streamer-acquisition-cancellation.test.ts | P | — |
| Worker | riciclo dopo il primo aumento di progresso, auto-resume spento | tests/worker-recycle-progress.test.ts, e2e/extension-controls.spec.ts | A | CDP termina il vero worker Chrome MV3 all'1% e verifica la ripresa; conferma Twitch reale sul profilo interessato ancora necessaria |
| Browser | restart di sessione attiva con vecchio valore acceso o spento | tests/crash-recovery.test.ts, tests/manual-queue-startup-resume.test.ts, e2e/extension-controls.spec.ts | A | La sessione riparte; Twitch reale da verificare |
| Browser | restart rapido di sessione attiva | tests/crash-recovery.test.ts | A | Il marcatore di nuova sessione prevale sul heartbeat recente; Chrome reale da verificare |
| Browser | Pausa o Stop manuale dopo restart | tests/manual-queue-startup-resume.test.ts, e2e/extension-controls.spec.ts | A | Il badge `⏸` segnala la pausa; Twitch reale da verificare |
| Preferiti | nuova campagna dopo ripresa del browser | tests/farming-automation-preemption.test.ts | A | Preemption simulata; Twitch reale da verificare |
| Sleep/wake | prima del retry | tests/monitoring-sleep-watchdog.test.ts, tests/activation-sync-wake-deadline.test.ts | P | — |
| Sleep/wake | durante richiesta | tests/monitoring-sleep-watchdog.test.ts, tests/activation-sync-wake-deadline.test.ts | P | — |
| Sleep/wake | sospensione lunga | tests/monitoring-sleep-watchdog.test.ts, tests/activation-sync-wake-deadline.test.ts | P | — |
| Orologio | salto avanti | tests/crash-recovery.test.ts, tests/recovery-loop-regressions.test.ts | P | — |
| Orologio | salto indietro | tests/crash-recovery.test.ts, tests/recovery-loop-regressions.test.ts | P | — |
| Orologio | timestamp impossibili | tests/timing-retry-after-normalization.test.ts, tests/recovery-loop-regressions.test.ts | A | — |
| Aggiornamento | 38→41→nuova build | tests/storage-migrations.test.ts, tests/storage-migrations-legacy.test.ts | P | — |
| Aggiornamento | 38→nuova build | tests/storage-migrations.test.ts, tests/storage-migrations-legacy.test.ts | P | — |
| Aggiornamento | 43→nuova build | tests/storage-migrations.test.ts, tests/storage-migrations-legacy.test.ts | P | — |
| Stato all'update | attivo | tests/manual-queue-update-resume.test.ts, e2e/extension-controls.spec.ts | P | Il profilo Chrome beta.46→beta.47 conserva l'intento attivo senza Pausa; l'update in diretta con Twitch resta da verificare |
| Stato all'update | paused | tests/manual-queue-update-resume.test.ts, e2e/extension-controls.spec.ts | P | Il profilo Chrome conserva la Pausa già salvata; l'update in diretta con Twitch resta da verificare |
| Stato all'update | stopped | tests/storage-migrations.test.ts, tests/recovery-loop-regressions.test.ts | P | — |
| Stato all'update | retrying | tests/storage-migrations.test.ts, tests/recovery-loop-regressions.test.ts | P | — |
| Stato all'update | retry-failed | tests/storage-migrations.test.ts, tests/recovery-loop-regressions.test.ts | P | — |
| Migrazione interrotta | prima di ogni scrittura | tests/storage-migrations.test.ts, tests/extension-storage-reset-lifecycle.test.ts | P | — |
| Migrazione interrotta | dopo ogni scrittura | tests/storage-migrations.test.ts, tests/extension-storage-reset-lifecycle.test.ts | P | — |
| Migrazione interrotta | eventi duplicati | tests/storage-migrations.test.ts, tests/extension-storage-reset-lifecycle.test.ts | P | — |
| Storage | campi mancanti | tests/recovery-loop-regressions.test.ts, tests/state-persistence-storage.test.ts | P | — |
| Storage | tipi errati | tests/recovery-loop-regressions.test.ts, tests/state-persistence-storage.test.ts | P | — |
| Storage | array corrotti | tests/recovery-loop-regressions.test.ts, tests/storage-corrupt-drops.test.ts | A | — |
| Storage | errore di scrittura | tests/storage-migrations.test.ts, tests/state-persistence-session.test.ts | P | — |
| Recupero persistente | un gioco guasto | tests/parked-queue-recovery.test.ts, tests/recovery-loop-regressions.test.ts | P | — |
| Recupero persistente | tutti guasti | tests/parked-queue-recovery.test.ts, tests/recovery-loop-regressions.test.ts | P | — |
| Recupero persistente | disponibilità ripristinata | tests/parked-queue-recovery.test.ts, tests/recovery-loop-regressions.test.ts | P | — |
| Notifiche | permesso concesso | tests/notifications-lifecycle.test.ts, tests/automation-event-notifier-storage-failure.test.ts | P | — |
| Notifiche | permesso negato | tests/notifications-lifecycle.test.ts, tests/automation-event-notifier-storage-failure.test.ts | P | — |
| Notifiche | Telegram guasto | tests/notifications-lifecycle.test.ts, tests/automation-event-notifier-storage-failure.test.ts | P | — |
| Notifiche | worker riavviato | tests/notifications-lifecycle.test.ts, tests/automation-event-notifier-storage-failure.test.ts | P | — |
| Interfaccia | popup chiuso e riaperto | tests/popup-source.test.ts, tests/monitor-dashboard.test.ts, e2e/extension-controls.spec.ts | P | — |
| Interfaccia | monitor | tests/popup-source.test.ts, tests/monitor-dashboard.test.ts, e2e/extension-controls.spec.ts | P | — |
| Interfaccia | tastiera | tests/popup-source.test.ts, tests/monitor-dashboard.test.ts, e2e/extension-controls.spec.ts | P | — |
| Interfaccia | screen reader | tests/popup-source.test.ts, tests/monitor-dashboard.test.ts, e2e/extension-controls.spec.ts | P | — |

Il test `tests/recovery-intent-sequences.test.ts` genera 600 sequenze deterministiche (seed `0x4d564333`) con 12 passi ciascuna, combinando Start, Pause, Stop, recovery, restart e update. Gli invarianti controllano autorizzazione, selezione, ordine di coda e rimozione dei blocchi temporanei. Questa esplorazione non sostituisce una prova E2E dei servizi Twitch.

Verifica manuale richiesta sul Chrome interessato: esportare il riepilogo con **Copy diagnostics**, aggiornare alla build candidata mantenendo il profilo, premere **Resume** se la beta precedente aveva già lasciato la coda in pausa, aprire Smite 2 e Overwatch, osservare l'aumento iniziale della percentuale e almeno due allarmi successivi senza Pause spontanea; verificare poi progressione della coda. Ripetere con worker terminato, sleep/wake, hidden→managed e sessione manuale. Registrare qui data, versione installata, risultato e codice diagnostico senza token o credenziali.

Continuita della tab, 2 ottobre 2026: la verifica reale deve caricare la build candidata `4.0.0-beta.51` (manifest tecnico `3.99.0.51`), attivare il video una sola volta e annotare tab, canale e minuti del drop. Riciclare il worker e verificare che il documento non venga ricaricato; passare poi a uno streamer idoneo o alla campagna successiva e controllare video attivo e aumento dei minuti senza ulteriori clic. Ripetere con Pause/Resume, Stop/Avvia e sleep/wake. Solo la chiusura effettiva della tab consente la sua sostituzione; le tab di servizio per accesso e inventario restano consentite. La sessione Brave osservata usa beta.49 e continua il farming, ma la nuova build non e stata caricata: questa osservazione non convalida la correzione su Twitch reale.

Gate della beta.51 passato con Bun 1.4.2: controllo del codice TypeScript modificato, TypeScript sorgenti e test, lint senza warning, suite completa, E2E Chrome MV3, audit delle dipendenze, build e archivi Chrome/Edge con manifest `3.99.0.51`. L'E2E di handoff verifica un unico clic iniziale, lo stesso ID della tab, nessuna rimozione, nessuna ricarica durante il recupero e riproduzione crescente prima e dopo il cambio campagna. La cartella locale `.claude` e esclusa dal lint; la copertura dei sorgenti resta invariata.
