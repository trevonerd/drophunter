# Matrice di recupero e aggiornamento

Build candidata: `4.0.0-beta.47` (manifest tecnico `3.99.0.47`). Il 29 settembre 2026 `bun run release:check` è passato: TypeScript test/sorgente, Biome, suite unitaria, Chrome MV3 E2E con profilo persistente e terminazione effettiva del worker, audit dipendenze, build e archivi Chrome/Edge, verifica dei manifest. La build è destinata solo alla prerelease GitHub, non agli store.

La beta.47 riprende al riavvio una sessione che era attiva, ignora il vecchio `autoResumeOnStartup: false` senza modificare le altre preferenze e conserva Pausa e Stop manuali. Il badge mostra `⏸` in ambra in pausa e ripristina l'avanzamento alla ripresa; l'automazione dei preferiti valuta le campagne dopo il riavvio.

Archivi beta.47: `.output/drophunter-4.0.0-beta.47-chrome.zip` e `.output/drophunter-4.0.0-beta.47-edge.zip`, SHA-256 `21d1aef2cdd4396302e37015e7b92f6dc6d54afe7d3f7ac0531a9c77ba8cea53` per entrambi.

Nella beta.46 le campagne con drop programmati restavano nella coda; dopo tre giri senza streamer idonei la coda veniva conservata e l'avviso inviato tramite il notificatore con ricevute per browser e Telegram. I test coprivano la coda mista, la persistenza del prossimo giro, il riavvio del worker e la ripresa quando tornava disponibile uno streamer.

Archivi beta.46: `.output/drophunter-4.0.0-beta.46-chrome.zip` e `.output/drophunter-4.0.0-beta.46-edge.zip`, SHA-256 `65fd6c9323ed2a559654302b8f9044dedfb3bcd7e05b8dce36c85c6a59f68f24` per entrambi.

Storico beta.45: il 28 settembre 2026 `bun run release:check` è passato per la build `4.0.0-beta.45` (manifest `3.99.0.45`).

Archivio Chrome: `.output/drophunter-4.0.0-beta.45-chrome.zip`, SHA-256 `4f384aa6c5e037f9b8cfe84398e2b7195fac41d8dd614914bfa224f0d6f3aea7`. L'archivio Edge è stato generato e validato dallo stesso gate. `vexp verify_done` segnala import come mancanti anche per export diretti ancora presenti; TypeScript, i test e la build li risolvono tutti, senza errori di parsing.

La beta.44 non verificava il riciclo di un worker mentre il farming era attivo. Con `autoResumeOnStartup` spento, interpretava il heartbeat vecchio di oltre 30 secondi come riavvio del browser e chiamava `pauseAfterRestart`. La beta.45 usa un marcatore in `chrome.storage.session` per distinguere i due eventi; il nuovo E2E termina il worker dopo un progresso all'1% e verifica che la sessione resti attiva.

**A** = asserzioni automatizzate dirette con servizi simulati, passate nella build indicata. **P** = copertura parziale/indiretta: la suite passa ma non dimostra ogni sottovariante nel browser reale. Il Chrome segnalato dall'utente e una sessione Twitch reale non sono disponibili su questo Mac; nessuna riga P va considerata approvazione manuale. La verifica degli scenari remoti resta necessaria prima della pubblicazione.

| Area | Variante | Evidenza automatizzata | Esito | Limite |
|---|---|---|---|---|
| Prima installazione | autenticato | tests/popup-entry.test.ts, tests/popup-reward-auth-sync.test.tsx | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Prima installazione | disconnesso | tests/popup-entry.test.ts, tests/popup-reward-auth-sync.test.tsx | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Prima installazione | onboarding incompleto | tests/popup-entry.test.ts, tests/popup-reward-auth-sync.test.tsx | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Start | campagna singola | tests/queue-start.test.ts, tests/queued-campaign-start.test.ts | A | Passa con mock; Twitch reale da verificare |
| Start | coda | tests/queue-start.test.ts, tests/queued-campaign-start.test.ts | A | Passa con mock; Twitch reale da verificare |
| Start | selezione diversa dalla testa | tests/queue-start.test.ts, tests/queued-campaign-start.test.ts | A | Passa con mock; Twitch reale da verificare |
| Comandi ripetuti | doppio Start | tests/farming-session-revision.test.ts, tests/manual-farming-retry.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Comandi ripetuti | doppio Resume | tests/farming-session-revision.test.ts, tests/manual-farming-retry.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Comandi ripetuti | Riprova durante un tentativo | tests/farming-session-revision.test.ts, tests/manual-farming-retry.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Pause | durante playback | tests/farming-stop-pending-acquisition.test.ts, tests/farming-session-revision.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Pause | durante ricerca | tests/farming-stop-pending-acquisition.test.ts, tests/farming-session-revision.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Pause | durante fallback | tests/farming-stop-pending-acquisition.test.ts, tests/farming-session-revision.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Pause | durante retry | tests/farming-stop-pending-acquisition.test.ts, tests/farming-session-revision.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Resume | dopo pausa | tests/manual-queue-startup-resume.test.ts, tests/v4-queue-continuation.test.ts | A | Passa con mock; Twitch reale da verificare |
| Resume | dopo restart | tests/manual-queue-startup-resume.test.ts, tests/v4-queue-continuation.test.ts | A | Passa con mock; Twitch reale da verificare |
| Resume | dopo aggiornamento | tests/manual-queue-startup-resume.test.ts, tests/v4-queue-continuation.test.ts | A | Passa con mock; Twitch reale da verificare |
| Stop | durante ogni operazione asincrona | tests/session-start-cancellation.test.ts, tests/streamer-acquisition-cancellation.test.ts, tests/manual-farming-retry.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Coda non autorizzata | aggiunta senza Start | tests/manual-queue-startup-resume.test.ts, tests/recovery-intent-sequences.test.ts | A | Passa con mock; Twitch reale da verificare |
| Coda non autorizzata | ripristino dal browser | tests/manual-queue-startup-resume.test.ts, tests/recovery-intent-sequences.test.ts | A | Passa con mock; Twitch reale da verificare |
| Modifica coda | aggiunta durante recovery | tests/queue-management.test.ts, tests/farming-session-revision.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Modifica coda | rimozione durante recovery | tests/queue-management.test.ts, tests/farming-session-revision.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Modifica coda | riordino durante recovery | tests/queue-management.test.ts, tests/farming-session-revision.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Modifica coda | svuotamento durante recovery | tests/queue-management.test.ts, tests/farming-session-revision.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Campagne duplicate | stesso gioco con campagne differenti | tests/campaign-selection.test.ts, tests/drops-projection-semantics.test.ts | A | Passa con mock; Twitch reale da verificare |
| Campagne duplicate | benefit duplicati | tests/campaign-selection.test.ts, tests/drops-projection-semantics.test.ts | A | Passa con mock; Twitch reale da verificare |
| Preferiti | auto-start acceso | tests/favorite-games.test.ts, tests/farming-automation-preemption.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Preferiti | auto-start spento | tests/favorite-games.test.ts, tests/farming-automation-preemption.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Preferiti | nuovo preferito | tests/favorite-games.test.ts, tests/farming-automation-preemption.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Preferiti | preemption | tests/favorite-games.test.ts, tests/farming-automation-preemption.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Filtri | nascosti | tests/streamer-selection.test.ts, tests/favorite-games.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Filtri | lingua | tests/streamer-selection.test.ts, tests/favorite-games.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Filtri | categoria | tests/streamer-selection.test.ts, tests/favorite-games.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Filtri | canali ammessi | tests/streamer-selection.test.ts, tests/favorite-games.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Directory vuota | nessuno live | tests/parked-queue-recovery.test.ts, tests/streamer-acquisition-recovery-budget.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Directory vuota | nessuno ammesso | tests/parked-queue-recovery.test.ts, tests/streamer-acquisition-recovery-budget.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Directory vuota | disponibilità successiva | tests/parked-queue-recovery.test.ts, tests/streamer-acquisition-recovery-budget.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Directory guasta | timeout | tests/streamer-acquisition-timeout-classification.test.ts, tests/client-parsing.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Directory guasta | payload incompleto | tests/streamer-acquisition-timeout-classification.test.ts, tests/client-parsing.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Directory guasta | errore GraphQL | tests/streamer-acquisition-timeout-classification.test.ts, tests/client-parsing.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Playback | HTTP riuscito e apertura falsa | tests/recovery-loop-regressions.test.ts, tests/streamer-acquisition-timeout-classification.test.ts | A | Passa con mock; Twitch reale da verificare |
| Playback | eccezione | tests/recovery-loop-regressions.test.ts, tests/streamer-acquisition-timeout-classification.test.ts | A | Passa con mock; Twitch reale da verificare |
| Playback | timeout | tests/recovery-loop-regressions.test.ts, tests/streamer-acquisition-timeout-classification.test.ts | A | Passa con mock; Twitch reale da verificare |
| Candidati | primo fallisce e secondo funziona | tests/recovery-loop-regressions.test.ts | A | Passa con mock; Twitch reale da verificare |
| Candidati | tutti falliscono | tests/recovery-loop-regressions.test.ts | A | Passa con mock; Twitch reale da verificare |
| Modalità nascosta | funziona | tests/farming-session-watch-transport.test.ts, tests/watch-transport.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Modalità nascosta | fallisce | tests/farming-session-watch-transport.test.ts, tests/watch-transport.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Modalità nascosta | perde heartbeat | tests/farming-session-watch-transport.test.ts, tests/watch-transport.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Scheda gestita | chiusa | tests/managed-watch-startup-integration.test.ts, tests/watch-transport-restoration.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Scheda gestita | navigata | tests/managed-watch-startup-integration.test.ts, tests/watch-transport-restoration.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Scheda gestita | sospesa | tests/managed-watch-startup-integration.test.ts, tests/watch-transport-restoration.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Scheda gestita | non raggiungibile | tests/managed-watch-startup-integration.test.ts, tests/watch-transport-restoration.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Handoff | successo | tests/watch-transport-handoff.test.ts, tests/watch-transport-races.test.ts | A | Passa con mock; Twitch reale da verificare |
| Handoff | candidato fallito | tests/watch-transport-handoff.test.ts, tests/watch-transport-races.test.ts | A | Passa con mock; Twitch reale da verificare |
| Handoff | operazione superata | tests/watch-transport-handoff.test.ts, tests/watch-transport-races.test.ts | A | Passa con mock; Twitch reale da verificare |
| Finestre | ultima scheda | tests/tab-management-state.test.ts, tests/managed-watch-durable-ownership.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Finestre | più finestre | tests/tab-management-state.test.ts, tests/managed-watch-durable-ownership.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Finestre | scheda dell'utente | tests/tab-management-state.test.ts, tests/managed-watch-durable-ownership.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Visione manuale | idonea | tests/farming-automation-manual-watch.test.ts, tests/manual-watch-policy.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Visione manuale | non idonea | tests/farming-automation-manual-watch.test.ts, tests/manual-watch-policy.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Visione manuale | in background | tests/farming-automation-manual-watch.test.ts, tests/manual-watch-policy.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Visione manuale | terminata | tests/farming-automation-manual-watch.test.ts, tests/manual-watch-policy.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Rete | offline | tests/streamer-global-recovery.test.ts, tests/api-operations.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Rete | ritorno online | tests/streamer-global-recovery.test.ts, tests/api-operations.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Rete | timeout | tests/streamer-global-recovery.test.ts, tests/api-operations.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Rete | HTTP 5xx | tests/streamer-global-recovery.test.ts, tests/api-operations.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Rate limit | 429 senza header | tests/api-operations.test.ts, tests/client-parsing.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Rate limit | 429 con header valido | tests/api-operations.test.ts, tests/timing-retry-after-normalization.test.ts | P | Parsing e persistenza simulati; Twitch reale da verificare |
| Rate limit | 429 con header malformato | tests/api-operations.test.ts, tests/client-parsing.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Sessione | cache assente | tests/session-management.test.ts, tests/session-account-evidence.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Sessione | credenziali scadute | tests/session-management.test.ts, tests/session-account-evidence.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Sessione | cambio account | tests/session-management.test.ts, tests/session-account-evidence.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Integrity | scaduta | tests/integrity-token.test.ts, tests/integrity-campaign-recovery.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Integrity | rifiutata | tests/integrity-token.test.ts, tests/integrity-campaign-recovery.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Integrity | verifica browser fallita | tests/integrity-token.test.ts, tests/integrity-campaign-recovery.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Progresso | crescente | tests/drops-projection-semantics.test.ts, tests/stalled-campaign-block.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Progresso | fermo | tests/drops-projection-semantics.test.ts, tests/stalled-campaign-block.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Progresso | snapshot vecchio | tests/drops-projection-semantics.test.ts, tests/stalled-campaign-block.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Progresso | snapshot parziale | tests/drops-projection-semantics.test.ts, tests/stalled-campaign-block.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Ricompense | watch-time | tests/reward-semantics.test.ts, tests/reward-scheduling.test.ts | A | Passa con mock; Twitch reale da verificare |
| Ricompense | future | tests/reward-semantics.test.ts, tests/reward-scheduling.test.ts | A | Passa con mock; Twitch reale da verificare |
| Ricompense | subscription | tests/reward-semantics.test.ts, tests/reward-scheduling.test.ts | A | Passa con mock; Twitch reale da verificare |
| Ricompense | evento | tests/reward-semantics.test.ts, tests/reward-scheduling.test.ts | A | Passa con mock; Twitch reale da verificare |
| Ricompense | Twitch-native | tests/reward-semantics.test.ts, tests/reward-scheduling.test.ts | A | Passa con mock; Twitch reale da verificare |
| Claim | successo | tests/auto-claim-drops.test.ts, tests/auto-claim.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Claim | fallimento | tests/auto-claim-drops.test.ts, tests/auto-claim.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Claim | risposta tardiva | tests/auto-claim-drops.test.ts, tests/auto-claim.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Claim | claim manuale | tests/auto-claim-drops.test.ts, tests/auto-claim.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Fine campagna | completata | tests/startup-completed-campaign.test.ts, tests/queue-management.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Fine campagna | scaduta | tests/startup-completed-campaign.test.ts, tests/queue-management.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Fine campagna | sparita autorevolmente | tests/startup-completed-campaign.test.ts, tests/queue-management.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Dati mancanti | cache vuota | tests/activation-sync-session-recovery.test.ts, tests/drops-projection-semantics.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Dati mancanti | refresh fallito | tests/activation-sync-session-recovery.test.ts, tests/drops-projection-semantics.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Dati mancanti | snapshot parziale | tests/activation-sync-session-recovery.test.ts, tests/drops-projection-semantics.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Retry | prima della scadenza | tests/recovery-loop-regressions.test.ts, tests/crash-recovery.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Retry | esattamente alla scadenza | tests/recovery-loop-regressions.test.ts, tests/crash-recovery.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Retry | dopo la scadenza | tests/recovery-loop-regressions.test.ts, tests/crash-recovery.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Scheduler | allarme perso | tests/recovery-loop-regressions.test.ts, tests/activation-retry-scheduler-recovery.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Scheduler | allarme ritardato | tests/recovery-loop-regressions.test.ts, tests/activation-retry-scheduler-recovery.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Scheduler | allarme duplicato | tests/recovery-loop-regressions.test.ts, tests/activation-retry-scheduler-recovery.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Scheduler | creazione fallita | tests/farming-recovery-alarm.test.ts, tests/activation-retry-scheduler-recovery.test.ts | A | Passa con mock; Twitch reale da verificare |
| Concorrenza | sync lenta | tests/recovery-loop-regressions.test.ts, tests/manual-farming-retry.test.ts, tests/farming-session-revision.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Concorrenza | alarm e popup | tests/recovery-loop-regressions.test.ts, tests/manual-farming-retry.test.ts, tests/farming-session-revision.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Concorrenza | retry e Stop | tests/recovery-loop-regressions.test.ts, tests/manual-farming-retry.test.ts, tests/farming-session-revision.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Concorrenza | risultati fuori ordine | tests/recovery-loop-regressions.test.ts, tests/manual-farming-retry.test.ts, tests/farming-session-revision.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Worker | terminazione prima del tentativo | tests/crash-recovery.test.ts, tests/streamer-acquisition-cancellation.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Worker | durante il tentativo | tests/crash-recovery.test.ts, tests/streamer-acquisition-cancellation.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Worker | dopo il tentativo | tests/crash-recovery.test.ts, tests/streamer-acquisition-cancellation.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Worker | riciclo dopo il primo aumento di progresso, auto-resume spento | tests/worker-recycle-progress.test.ts, e2e/extension-controls.spec.ts | A | CDP termina il vero worker Chrome MV3 all'1% e verifica la ripresa; conferma Twitch reale sul profilo interessato ancora necessaria |
| Browser | restart di sessione attiva con vecchio valore acceso o spento | tests/crash-recovery.test.ts, tests/manual-queue-startup-resume.test.ts, e2e/extension-controls.spec.ts | A | La sessione riparte; Twitch reale da verificare |
| Browser | restart rapido di sessione attiva | tests/crash-recovery.test.ts | A | Il marcatore di nuova sessione prevale sul heartbeat recente; Chrome reale da verificare |
| Browser | Pausa o Stop manuale dopo restart | tests/manual-queue-startup-resume.test.ts, e2e/extension-controls.spec.ts | A | Il badge `⏸` segnala la pausa; Twitch reale da verificare |
| Preferiti | nuova campagna dopo ripresa del browser | tests/farming-automation-preemption.test.ts | A | Preemption simulata; Twitch reale da verificare |
| Sleep/wake | prima del retry | tests/monitoring-sleep-watchdog.test.ts, tests/activation-sync-wake-deadline.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Sleep/wake | durante richiesta | tests/monitoring-sleep-watchdog.test.ts, tests/activation-sync-wake-deadline.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Sleep/wake | sospensione lunga | tests/monitoring-sleep-watchdog.test.ts, tests/activation-sync-wake-deadline.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Orologio | salto avanti | tests/crash-recovery.test.ts, tests/recovery-loop-regressions.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Orologio | salto indietro | tests/crash-recovery.test.ts, tests/recovery-loop-regressions.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Orologio | timestamp impossibili | tests/timing-retry-after-normalization.test.ts, tests/recovery-loop-regressions.test.ts | A | Passa con mock; Twitch reale da verificare |
| Aggiornamento | 38→41→nuova build | tests/storage-migrations.test.ts, tests/storage-migrations-legacy.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Aggiornamento | 38→nuova build | tests/storage-migrations.test.ts, tests/storage-migrations-legacy.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Aggiornamento | 43→nuova build | tests/storage-migrations.test.ts, tests/storage-migrations-legacy.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Stato all'update | attivo | tests/storage-migrations.test.ts, tests/recovery-loop-regressions.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Stato all'update | paused | tests/storage-migrations.test.ts, tests/recovery-loop-regressions.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Stato all'update | stopped | tests/storage-migrations.test.ts, tests/recovery-loop-regressions.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Stato all'update | retrying | tests/storage-migrations.test.ts, tests/recovery-loop-regressions.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Stato all'update | retry-failed | tests/storage-migrations.test.ts, tests/recovery-loop-regressions.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Migrazione interrotta | prima di ogni scrittura | tests/storage-migrations.test.ts, tests/extension-storage-reset-lifecycle.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Migrazione interrotta | dopo ogni scrittura | tests/storage-migrations.test.ts, tests/extension-storage-reset-lifecycle.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Migrazione interrotta | eventi duplicati | tests/storage-migrations.test.ts, tests/extension-storage-reset-lifecycle.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Storage | campi mancanti | tests/recovery-loop-regressions.test.ts, tests/state-persistence-storage.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Storage | tipi errati | tests/recovery-loop-regressions.test.ts, tests/state-persistence-storage.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Storage | array corrotti | tests/recovery-loop-regressions.test.ts, tests/storage-corrupt-drops.test.ts | A | Passa con mock; Twitch reale da verificare |
| Storage | errore di scrittura | tests/storage-migrations.test.ts, tests/state-persistence-session.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Recupero persistente | un gioco guasto | tests/parked-queue-recovery.test.ts, tests/recovery-loop-regressions.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Recupero persistente | tutti guasti | tests/parked-queue-recovery.test.ts, tests/recovery-loop-regressions.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Recupero persistente | disponibilità ripristinata | tests/parked-queue-recovery.test.ts, tests/recovery-loop-regressions.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Notifiche | permesso concesso | tests/notifications-lifecycle.test.ts, tests/automation-event-notifier-storage-failure.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Notifiche | permesso negato | tests/notifications-lifecycle.test.ts, tests/automation-event-notifier-storage-failure.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Notifiche | Telegram guasto | tests/notifications-lifecycle.test.ts, tests/automation-event-notifier-storage-failure.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Notifiche | worker riavviato | tests/notifications-lifecycle.test.ts, tests/automation-event-notifier-storage-failure.test.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Interfaccia | popup chiuso e riaperto | tests/popup-source.test.ts, tests/monitor-dashboard.test.ts, e2e/extension-controls.spec.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Interfaccia | monitor | tests/popup-source.test.ts, tests/monitor-dashboard.test.ts, e2e/extension-controls.spec.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Interfaccia | tastiera | tests/popup-source.test.ts, tests/monitor-dashboard.test.ts, e2e/extension-controls.spec.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |
| Interfaccia | screen reader | tests/popup-source.test.ts, tests/monitor-dashboard.test.ts, e2e/extension-controls.spec.ts | P | Parziale; esercitare il flow Chrome/Twitch indicato |

Il test `tests/recovery-intent-sequences.test.ts` genera 600 sequenze deterministiche (seed `0x4d564333`) con 12 passi ciascuna, combinando Start, Pause, Stop, recovery, restart e update. Gli invarianti controllano autorizzazione, selezione, ordine di coda e rimozione dei blocchi temporanei. Questa esplorazione non sostituisce una prova E2E dei servizi Twitch.

Verifica manuale richiesta sul Chrome interessato: esportare il riepilogo con **Copy diagnostics**, aggiornare alla build candidata mantenendo il profilo, premere **Resume** se la beta precedente aveva già lasciato la coda in pausa, aprire Smite 2 e Overwatch, osservare l'aumento iniziale della percentuale e almeno due allarmi successivi senza Pause spontanea; verificare poi progressione della coda. Ripetere con worker terminato, sleep/wake, hidden→managed e sessione manuale. Registrare qui data, versione installata, risultato e codice diagnostico senza token o credenziali.
