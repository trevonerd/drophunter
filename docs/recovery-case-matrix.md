# Matrice di recupero e aggiornamento

Build verificata: `4.0.0-beta.48`, manifest tecnico `3.99.0.48`. Il 1 ottobre 2026 il gate completo è passato senza warning: TypeScript, lint, 2.301 test unitari, 9 E2E Chrome MV3, audit, build e archivi Chrome/Edge. Anche audit e rendering CTA/promo del progetto video sono passati. Questa beta è destinata alla prerelease GitHub e ai test locali, non agli store.

La beta.48 evita claim e avvisi duplicati, distingue le campagne nei messaggi e mantiene indipendenti browser e Telegram. Gli errori di lettura/scrittura del registro non cancellano le acquisizioni esistenti né sopprimono il fallback di completamento. Conserva la ripresa delle sessioni attive introdotta nella beta.47 e il rispetto di Pausa e Stop.

Archivi: `.output/drophunter-4.0.0-beta.48-chrome.zip` e `.output/drophunter-4.0.0-beta.48-edge.zip`. SHA-256 di entrambi: `e02b4ed2737b5384f132920642ac65e398328950b68a4939ff89845372a676e6`.

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
