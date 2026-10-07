# Matrice di recupero e aggiornamento

## Verifica beta.63 — 7 ottobre 2026

Navigazione interna verificata su Twitch reale in Brave: Play dalla coda Albion → SMITE 2 ha conservato tab `1782644565`, documento, elemento video e attivazione iniziale. Il player è rimasto in background senza clic aggiuntivi. Il progresso autorevole è passato da 85% / 308 minuti a 86% / 312 minuti e 90% / 324 minuti; anche il successivo canale `adaptingx` conserva documento e video, con popup e tab allineati.

Verifiche finali con Bun 1.4.2: TypeScript sorgenti/test, lint, 2.726 test unitari in 319 file e tutti i 42 E2E Chrome MV3 superati. I fixture di playback fallito mostrano il canale corretto e un errore definitivo del video; non simulano più un player ancora in montaggio. La suite Chrome completa è stata eseguita con due worker. Audit senza vulnerabilità; build e ZIP Chrome/Edge con manifest `3.99.0.63`, controllati dalle funzioni del release checker. Dopo la correzione dei fixture, le verifiche del gate sono state completate per singola fase.

Pulizia Ponytail e review concluse senza refactor aggiuntivi. Sleep/wake reale e consegna Telegram reale restano non verificati; riavvio, riciclo worker, annullamento e notifiche sono coperti dai test. Le osservazioni delle versioni precedenti riportate sotto rimangono storiche.

## Contratto farming — 7 ottobre 2026

Questa sezione sostituisce le vecchie aspettative su gesto iniziale indefinito, seconda tab, fallback tabless→tab, rollback e stop per login. Le sezioni dal 6 ottobre in giù registrano implementazioni e osservazioni storiche: non descrivono il contratto attuale.

| Scenario | Risultato previsto | Prove automatiche |
| --- | --- | --- |
| Progresso reale crescente | Mantiene il canale, risolve l'episodio | farming-cycle-contract, drops-projection-semantics |
| Video/heartbeat sano senza progressi | Refresh prima dello stall, finestra proporzionale 5–20 minuti | farming-cycle-contract, native-reward-stall-recovery, strict-stall-refresh |
| Player ancora in caricamento dopo 30 secondi | Conserva canale e tab; progresso della campagna rinnova la finestra 5–20 minuti, errori di ownership restano ignoti | managed-watch-cold-loading, automatic-pending-playback |
| Scadenza verificata del caricamento | Sospende il candidato, cancella Switching, prova il prossimo streamer e conserva i fallimenti reali | managed-watch-cold-loading, automatic-pending-playback |
| Play in coda e cambio canale Twitch | Navigazione interna nella stessa tab/documento; la sola URL non conferma il nuovo player, servono intestazione/categoria e avanzamento | managed-watch-internal-navigation, content-internal-navigation, queue-campaign-handoff E2E |
| Sincronizzazione Drops conclusa durante la pubblicazione del watch | Stato sync e timestamp aggiornati non annullano il candidato pronto; conserva i dati sync correnti e il refresh riuscito più recente | farming-campaign-handoff, queue-campaign-handoff E2E |
| Navigazione manuale nella tab posseduta | Recupera il token nella stessa origine per riutilizzare la tab; cleanup mantiene guardie esatte | managed-watch-internal-navigation, managed-watch-stale-cleanup |
| Video riutilizzato con tempo azzerato | Il precedente avanzamento non conferma il nuovo sorgente | managed-playback-suspension |
| Chrome rifiuta sincronicamente alwaysOnTop | Il monitor usa il fallback focused-only senza fallire l'apertura | tab-management-window, monitor-dashboard |
| Fallimenti misti | Prenotazione persistita prima della preparazione, massimo quattro nomi distinti | farming-cycle-contract, playback-start-retry-budget, streamer-transport-failure |
| Player offline, anche con contatore spettatori residuo | Due letture consecutive; prevale su playback inattivo e deadline dello stallo | watch-transport, content-script-modules, offline-farming-recovery |
| Cinque cambi offline consecutivi con tre errori reali precedenti | Rimuove solo la prenotazione offline prima della ricerca; conserva errori, campagna e tab | offline-farming-recovery |
| Ultimo streamer offline, nessuna alternativa verificata | Parcheggia Rainbow Six e continua la coda; errore directory resta disponibilità ignota | offline-farming-recovery, farming-cycle-contract, e2e/queue-campaign-handoff.spec.ts |
| Uno–tre streamer falliti o meno di quattro alternative | Recupero e retry continuano; nessun avviso campagna bloccata né alert Telegram/browser | campaign-failure-alert-threshold, farming-automation-notifications, queue-availability-resume |
| Quarto streamer distinto fallito | Un solo episodio di errore, avviso persistente e invii deduplicati per destinazione | campaign-failure-alert-threshold, farming-cycle-contract |
| Warhammer tutto 100% claimable, account non collegato | Esce dalla coda farming; target non acquisito resta per verifica claim/link; Brawlhalla prosegue | claim-pending-queue-continuation |
| Solo ricompense da riscattare, anche dopo restart | Tempo completato / collegare account; nessuna acquisizione streamer, retry inventario programmato | claim-pending-queue-continuation |
| Candidato passa da 90% a 100% durante refresh | Pubblica prove complete, conserva player incumbent, nessuna preparazione del candidato | claim-pending-queue-continuation |
| Navigazione gestita lenta, fallita o superata | Popup e monitor mostrano Switching to; nessun premio precedente in esecuzione; commit atomico o recupero sospeso | queued-managed-campaign-handoff, watch-transport-cancellation, watch-transport-replacement, e2e/queue-campaign-handoff.spec.ts |
| Refresh Drops automatico, condiviso, annullato o scaduto | Chiude solo la pagina creata dopo l'ultimo consumatore; conserva pagine esplicite/esistenti, navigazione utente, login e finestre con una tab | drops-page-cleanup, drops-page-refresh |
| Stato pending ripristinato dopo worker restart | Nessuna navigazione immaginata; target transitorio nullo, tentativi reali conservati | app-state-sync, state-persistence-session |
| Meno di quattro canali | Non ripete i nomi, passa alla campagna successiva | farming-cycle-contract, queue-acquisition-round |
| Ultimo target irrisolto fallito | Warning persistito, trasporto sospeso, retry reale fra dieci minuti | farming-cycle-contract, queue-acquisition-round |
| Retry anticipato / senza selezione | Riapre giro e budget, rispetta cooldown HTTP verificato | manual-farming-retry |
| Play da ogni stato | Persiste intento, risveglia monitoraggio, conserva precedente in coda | queued-campaign-start, farming-session-revision |
| Snapshot mancante/parziale, reward futuro, claim fallito | Target conservato, nessuna acquisizione inventata | farming-cycle-contract, claimable-queue-eligibility, native-reward-stall-recovery |
| Tutti acquisiti, scaduti o misti | Stop solo quando ogni obiettivo è terminale | farming-cycle-contract, session-lifecycle-summary-precedence |
| Campagna scaduta filtrata dai candidati | Conserva la scadenza valida prima del filtro | games-cache-orchestration, service-worker |
| Pause/Stop con operazioni pendenti | Niente navigazione, promozione, heartbeat o claim tardivi | managed-watch-pending-navigation, farming-session-revision, watch-transport-races |
| Cambio gestito / ownership incerta | Stesso ID provato; nessun duplicato su prova incerta | single-managed-watch-tab, managed-watch-preflight-retry |
| ID storico riutilizzato dopo restart | Cerca tutte le prove prima di decidere; riusa l'unica tab provata, l'incertezza impedisce creazione | managed-watch-preflight-recovery |
| Prova della tab temporaneamente indisponibile | Restituisce la prenotazione e conserva retry persistiti senza consumare quattro canali | watch-preparation-budget, managed-watch-preflight-retry |
| Preemption preferiti durante preparazione o fallimento | Stesso coordinatore di Play, pending pubblicato prima della navigazione; player trattenuto sospeso, nessuno stato sano obsoleto | managed-watch-startup-integration |
| Cleanup precedente dopo navigazione più recente | Ricontrolla token, URL, finestra e ultima tab prima della mutazione serializzata; non chiude né neutralizza il watch nuovo | managed-watch-stale-cleanup |
| Vecchio alert prematuro già consegnato | Primo esaurimento verificato crea una nuova identità, poi deduplica browser e Telegram | campaign-failure-alert-threshold |
| Tabless / cambio modalità | Nessun fallback di visione, sospende prima il player precedente | farming-cycle-contract, watch-transport-handoff |
| Browser restart / recycle | Browser pulisce avvisi operativi; recycle conserva finestre e budget | farming-cycle-contract, worker-recycle-progress, crash-recovery |
| Login tardivo / Stop | Recupero programmato, Stop prevale sul login tardivo | afk-auth-recovery, queue-auth-recovery-persistence |
| Warning ripetuti e notifiche guaste | Un episodio, ricevute indipendenti, farming non bloccato | farming-cycle-contract, automation-event-notifier, claim-log |
| Risposta API/integrity/claim del vecchio account | Non ricrea prove né backoff e non sblocca claim nuovi | session-account-evidence |
| Monitor, × o avviso Drops durante persistenza | Non annulla il watch valido, conserva presentazione aggiornata | farming-campaign-transition |
| Play interrompe un canale sano al quarto tentativo | Riprende il tentativo sospeso, nessun quinto nome | farming-cycle-contract |
| Claim pendente durante Pause/Play | Scarta esito vecchio, il batch successivo rimane eseguibile | session-account-evidence |
| Messaggi nel popup | Espansione, × e chiusura persistite dopo popup e riciclo worker | e2e/farming-messages.spec.ts |
| Servizio heartbeat tabless indisponibile | Recupero globale, nessun warning attribuito ai canali; sospende il tempo di osservazione | farming-cycle-contract, streamer-transport-failure |
| Risposta tabless ripristinata, anche degradata | Riprende il tempo dal punto sospeso senza stall immediato | farming-cycle-contract |
| Pubblicazione annullata per stato concorrente | Non parcheggia né consuma il canale; risveglia lo stesso allarme dopo il tick proprietario, salvo blocchi o cooldown | farming-campaign-handoff |
| Timeout playback con risposta tardiva | Il tentativo rimane consumato; nessuna promozione tardiva | farming-campaign-handoff |
| Restore con probe fallito o Stop durante probe | Conserva subito ownership dormiente e sospende la tab provata | watch-transport-handoff |
| Restore con Pausa/Stop persistiti | Sospende il player ripristinato dal browser, senza playback nuovo | watch-transport-handoff |
| Pause/Stop dopo un candidato fallito riavviato dall’utente | Recupera la prova corrente della tab e sospende il player, anche senza watch pubblicato | managed-watch-candidate-preservation, e2e/queue-campaign-handoff.spec.ts |
| Stop superato durante ricostruzione o coda delle mutazioni | Non sovrascrive il registro né sospende la navigazione nuova | managed-watch-pending-navigation |
| Stop durante osservazione del controllo Twitch o play pendente | Sospende anche l’intento del player, disattiva keepalive e impedisce retry nativi tardivi | managed-playback-suspension |
| Stop/Play durante policy, self-heal o apertura legacy asincroni | Ricontrolla la revisione prima di preparare, navigare o pubblicare; nessun PREPARE tardivo | playback-orchestrator, playback-self-heal-cancellation, tab-management-tabs |
| Stop durante persistenza o marker della prima tab | Completa soltanto la prova della propria tab, la sospende e restituisce un candidato annullato | managed-watch-initial-cancellation |

I nomi indicano file in `tests/`. `e2e/queue-campaign-handoff.spec.ts` usa listener MV3 e video reali locali per cambio nella stessa tab, gesto iniziale, Pause/Stop, recycle, browser restart, giri bloccati e chiusura. Progresso e claim vengono forniti dalla fixture: sono risposte Twitch simulate.

Verifica parziale del 7 ottobre su Twitch di produzione, in Brave con estensione locale beta.61: Albion / Dragonfire ha accumulato progresso 21→22→26%; Overwatch / Reign of Talon S5 Launch 81→83→86→96→97%. Play, rotazioni e reload hanno conservato una sola tab di visione (ID 1782644014). Al termine il Play esplicito ha riportato la sessione su Reign of Talon; il monitor di prova è stato chiuso e il farming lasciato attivo.

La verifica di Stop ha fatto emergere ulteriori lacune nel restore e nelle operazioni pendenti, coperte da regressioni fallenti prima della correzione. La suite Chrome finale verifica video realmente in riproduzione→pausa, intento del controllo del sito e assenza di retry tardivi. Sul profilo Twitch finale è stato osservato `video.paused: true`, ma non un confronto completo prima/dopo con video sicuramente in riproduzione: Stop/Resume reale resta una verifica parziale. Il testo del pulsante Twitch può rimanere «Pausa» anche dopo una pausa DOM e non viene usato da solo come prova.

La prova tabless sul profilo reale non certifica progresso: richieste Twitch di inventario e configurazione pubblica rispondevano, ma l'endpoint heartbeat Spade restituiva `ERR_CONNECTION_REFUSED`. Non sono state modificate protezioni del browser, rete o credenziali. Questa indisponibilità globale non deve consumare quattro streamer né generare warning distinti; la politica corretta è coperta dai test. Bootstrap/login da installazione fresca, riapertura completa del browser con la build finale, sleep/wake reale, acquisizione completa di tutti i reward e consegne reali browser/Telegram restano non verificati sulla build attuale. Riavvio e riciclo sono verificati automaticamente con Twitch simulato.

Gate finale sulla versione corretta: `bun run test:types`, `bun run test:ts`, `bun run lint`, 2.647 test unitari in 300 file, 40 E2E Chrome MV3 e `bun run build:all` Chrome/Edge superati. Le review Spec e Standards non riportano rilievi concreti aperti. `vexp verify_done` non segnala errori di parsing o deriva documentale; tutti i 70 avvisi di import dell’indice sono stati ricondotti agli import reali e verificati anche da un probe TypeScript dedicato. Il lavoro conserva il diff preesistente; nessun commit, pubblicazione o release automatica.


## Regressioni Start, Play e riavvio — 6 ottobre 2026

La verifica diretta in Brave sulla beta.61 ha mostrato Start Queue con cambi di streamer prima dell'avvio stabile e Pausa/Stop disabilitati durante l'attesa. Albion ha poi accumulato progresso reale (0→1→3%); Play di SMITE non ha sostituito Albion. Questo conferma che la riuscita occasionale del farming non convalida gli altri flussi.

Sono state riprodotte tre lacune prima delle correzioni:

- Il test di startup saltava `prepareBrowserSessionResume`: includendo questa fase, il vecchio ID della tab assente cancellava lo streamer prima della ricostruzione dell'ownership. Il test ora attraversa preparazione e ripristino reali, compresi tab assente, Pausa e Stop.
- Una pagina Twitch con documento completo ma video ancora assente, o schermata iniziale appena rimossa, veniva scartata al primo tentativo. `queued-managed-playback-readiness.test.ts` usa preparazione content reale e ownership nativa: prima della correzione tutti e quattro i casi fallivano, aprendo un secondo streamer o rifiutando Play.
- L'E2E con navigazione candidata sospesa mostrava Stop disabilitato. Pausa e Stop ora restano disponibili mentre Start/Play attende; le prove browser verificano anche l'interruzione e che il candidato tardivo non riparta.

Start Queue e Play della coda registrano soltanto l'intento e risvegliano l'allarme del farming: il gestore del clic non esegue chiamate Twitch, ricerca streamer o preparazione playback. Il modulo separato `farming-automation-queued-start.ts` è stato rimosso. Il normale monitoraggio acquisisce lo streamer e gestisce progresso, completamento e recupero. Play attiva la campagna richiesta e mette la precedente in coda; un cambio fallito ripristina la precedente soltanto se il suo watch conservato supera una nuova verifica. Un primo avvio senza streamer conserva l'autorizzazione alla riprova. Pausa/Stop invalidano anche le operazioni già in corso.

Il reload dell'estensione durante ricerca/recupero ha riprodotto un secondo problema di startup: il reset di aggiornamento conservava l'intento ma impostava `isRunning: false`, subordinando la ripresa alla riuscita dell'inventario. Il reset conserva ora l'intento attivo e riattiva il monitoraggio dopo la persistenza; Pausa e Stop restano vincolanti. Le regressioni attraversano worker recycle, riapertura browser, migrazione di versione e aggiornamento live, sia durante il primo avvio sia durante recupero playback.

Due ulteriori regressioni sono state isolate con prove fallenti: cleanup campagne e completamento iniziavano contemporaneamente la stessa transizione, invalidandosi a vicenda; inoltre i fallimenti del transport gestito saltavano la normale verifica di progresso recente, grace iniziale e cooldown. La progressione automatica ora condivide l'operazione già in corso per la stessa sessione; il transport gestito torna al validatore esistente, preservando i calcoli temporali.

La prova del watch precedente è asincrona: un nuovo Play durante quella lettura deve invalidarne il risultato. La regressione con due Start reali riproduceva B→C→A alla conclusione della vecchia prova; acquisizione e rollback controllano ora anche la revisione della sessione e la selezione dopo l'attesa, lasciando valida soltanto C.

L'avvio tenta un solo streamer per scadenza, con 30 secondi fra i tentativi e un massimo di quattro canali distinti (iniziale più tre alternative). I nomi falliti persistono nei metadati della campagna e si azzerano all'inizio del successivo giro, non ad ogni controllo. La verifica reale di Play su Albion ha inoltre riprodotto il contatore oltre limite quando il watch precedente risultava degradato: la perdita del segnale Drops nel DOM rendeva `isHealthy` falso anche con video in riproduzione e categoria corretta. Il rollback deve conservare questa prova di playback valido; un incumbent realmente inutilizzabile deve invece lasciare proseguire la coda dopo il limite, senza attesa infinita.

L'attesa di un gesto sul player viene notificata dal flusso principale tramite il notifier comune, con ricevute persistenti separate per browser e Telegram. Le prove verificano invio, mancata duplicazione dopo tick/restart e riprova del solo canale fallito. Una richiesta manuale può mantenere il nuovo player in attesa di Play; una transizione automatica non sostituisce un incumbent valido con un candidato che richiede intervento.

Il browser ha riprodotto anche un doppio avviso quando il progresso dell'inventario cambiava prima del successivo campione del player: l'identità della notifica ora usa il watch (campagna, streamer e tab), non il contatore di progresso. L'E2E intercetta l'API notifiche risolta da WXT, che può essere distinta da `chrome.notifications`, e verifica una sola consegna prima e dopo il clic sul player.

Una successiva riapertura reale ha mostrato che la stessa prova di playback valido senza etichetta Drops serve anche al ripristino del coordinatore e alla protezione del watch esistente: questi percorsi ora condividono il predicato con il rollback. L'E2E di riavvio rimuove l'etichetta prima e dopo la chiusura del profilo e verifica video e progresso senza Start.

La preparazione a freddo su Twitch reale ha inoltre restituito `playbackPending` oltre il precedente limite di 10 secondi e chiuso il canale del content script durante una navigazione in back/forward cache. La preparazione mantiene lo stesso candidato, ritenta il ricevitore dopo la navigazione e usa un limite totale di 30 secondi; cancellazione e numero massimo di campioni restano verificati anche con orologio congelato. Il test copre playback disponibile dopo 12 secondi e l'esatto errore Chrome osservato.

Infine, una richiesta reale di gesto sul player Nika arrivava con categoria DOM ancora vuota: trattare il dato assente come categoria diversa scartava il player prima della notifica. Un nuovo E2E mantiene la categoria assente fino al clic Play e, prima della correzione, fallisce perché nessuno streamer viene mantenuto. La categoria esplicitamente diversa resta un motivo di rifiuto; l'assenza temporanea non costituisce quella prova. Dopo la correzione il test verifica mantenimento della scheda, una notifica e ripresa nella stessa tab. Il playback appena avviato riceve la normale grace anche senza etichetta Drops; la categoria ignota da sola non prova mai playback sano.

Verifica diretta della build corretta beta.61 in Brave: Play di SMITE sostituisce Albion; il player Nika risulta nella categoria SMITE 2, non in pausa, con `readyState: 4`. Il progresso del primo bundle aumenta da 31→32→35% durante la verifica, poi da 40→41% dopo il caricamento della build corretta. Pausa e Resume sono stati esercitati dal popup. Dopo chiusura completa di Brave (processo non in esecuzione) e riapertura, SMITE riparte senza premere Avvia e il bundle aumenta 41→42→43%. Dopo la correzione del reset di aggiornamento, un ulteriore reload mantiene SMITE attiva e il progresso aumenta 57→58→60%, ancora senza Avvia. La prova finale di Play su Albion fallisce l'acquisizione e ritorna automaticamente a SMITE al 61%, senza altri clic Play/Start: lo stesso scenario prima restava in recupero oltre quattro tentativi. Non sono stati inseriti progressi né alterate credenziali sul profilo reale.

Un ulteriore Play manuale di SMITE riproduce il nuovo caso reale: il popup mostra «Start the video» e mantiene Nika; portando in primo piano la scheda Twitch, il player risulta già in riproduzione e nella categoria SMITE 2. Tornati al popup, il normale monitoraggio passa a Running e il bundle avanza 65→66%, senza un nuovo Start. L'avvio automatico dei preferiti del profilo è rimasto attivo; il Play esplicito mantiene la priorità manuale.

Dopo un'altra chiusura completa di Brave, confermata dal processo non in esecuzione, la riapertura ripristina SMITE senza Start. Il caricamento a freddo passa per un tentativo di recupero e mantiene poi Nika con «Start the video» quando il browser richiede intervento; popup e monitor concordano. Il progresso reale raggiunge 68%. Questa prova non certifica autoplay incondizionato al riavvio: la richiesta del browser deve poter restare visibile fino all'intervento. Le notifiche sono verificate sul confine API browser/Telegram; il banner del sistema operativo non è stato verificato visivamente.

Sulla build definitiva, dopo apertura della scheda richiesta, il monitoraggio riconosce la riproduzione e torna a Running. Rimettendo Twitch in background, Nika resta lo streamer di SMITE e il bundle avanza 68→70% senza nuovi Start o Play della coda. Tutti gli hook temporanei di diagnostica sono stati rimossi e DevTools chiuso; il farming viene lasciato attivo.

Verifica finale: 2.586 test unitari in 298 file, 35 E2E Chrome MV3, TypeScript sorgenti/test, lint senza warning, build Chrome/Edge e audit di 229 dipendenze superati. Dopo l'ultima correzione della grace post-gesto, tutti i sei E2E interessati (avvio, gesto, notifica e riavvio) sono stati ripetuti con successo sulla build definitiva. `vexp verify_done` riporta zero errori di parsing e zero deriva documentale; i 76 avvisi di import su export/re-export validi sono stati ricontrollati con ricerca nativa e compilatori. La suite completa comprende i 155 file di test interessati dall'indice. La verifica con Twitch simulato resta distinta dal servizio reale; sleep/wake reale e completamento integrale dei drop non sono stati osservati in questa prova.

## Play della coda durante caricamento Twitch — 6 ottobre 2026

Una pagina Twitch appena aperta può inviare lo stesso token OAuth con `userId` ancora vuoto. La sincronizzazione cancellava l'identità già rilevata e invalidava il cambio campagna richiesto da Play: la tab apriva il nuovo stream e tornava al precedente. La sincronizzazione conserva ora l'identità nota soltanto quando il token è identico; token diverso o identità esplicita diversa continuano a invalidare la sessione precedente.

`tests/queued-managed-campaign-handoff.test.ts` riproduce il report incompleto durante la preparazione nella composizione reale di automazione e transport gestito, con watch precedente sano o degradato, e verifica selezione, coda, ownership e URL dopo il tick successivo. `tests/session-management.test.ts` verifica anche persistenza e cambio credenziali/account. TypeScript sorgenti/test, lint, build Chrome e tutti i 2.533 test unitari superati.

Verifica manuale sulla build locale beta.61 corretta caricata in Brave: Play di Albion Online durante farming SMITE 2 passa ad Albion e mantiene la nuova campagna attiva dopo il completamento del comando. Questa osservazione convalida il cambio Play; non estende la copertura manuale a restart o sleep/wake.

## Verifica release 4.0.0-beta.61 — 6 ottobre 2026

Gate completo `bun run release:check` superato con Bun 1.4.2: controllo dello scope TypeScript, compilatori sorgenti/test, lint senza warning, 2.528 test unitari, 28 E2E Chrome MV3, audit dipendenze, build e archivi Chrome/Edge, controlli dei manifest e degli archivi. La verifica finale vexp conferma assenza di errori di parsing e deriva documentale; i 261 test nelle 37 suite indicate sono superati e i 7 avvisi sui re-export/fixture sono stati ricontrollati con ricerca nativa e compilatori.

Entrambi gli ZIP `drophunter-4.0.0-beta.61-chrome.zip` e `drophunter-4.0.0-beta.61-edge.zip` hanno superato il controllo di integrità e contengono manifest tecnico `3.99.0.61` con `version_name` `4.0.0-beta.61`. Questa beta comprende coerenza watch/campagna, progressione della coda e ownership delle tab documentate sotto; resta destinata a GitHub e installazioni locali. Restart e sleep/wake su Twitch reale restano verifiche manuali aperte.

## Ownership delle tab di farming — 6 ottobre 2026

Il modulo di ownership concentra acquisizione, prove sessione/pagina, registro, riuso, conferma, rollback, ricostruzione startup e rilascio. Playback e promozione restano nei transport. I formati storage esistenti sono invariati. Stop conserva il video; un candidato provvisorio viene scartato senza chiudere l'ultima tab della finestra. Le prove incerte continuano a bloccare nuove creazioni e il riconoscimento manuale mantiene distinto “sconosciuto” da “nessuna tab gestita”.

| Caso | Evidenza automatizzata |
|---|---|
| Acquisizione serializzata tra chiamanti, persistenza fallita senza duplicati, primo Avvia esplicito, rollback superato | `tests/tab-management-tabs.test.ts` |
| Conferma/discard concorrenti durante caricamento e scrittura marker; ownership superata nella stessa tab | `tests/managed-watch-ownership.test.ts` |
| Canale scelto durante lettura delle prove startup: conserva il nuovo watch e ritira soltanto il suo predecessore | `tests/managed-watch-ownership.test.ts` |
| Ricostruzione prima/dopo commit; Stop/Pausa; marker ambigui o indisponibili; protezione watch e ultima tab | `tests/managed-watch-provisional-recovery.test.ts`, `tests/managed-watch-startup-integration.test.ts`, `tests/managed-watch-durable-ownership.test.ts`, `tests/managed-watch-candidate-preservation.test.ts` |
| Tab gestita dormiente esclusa dalla visione manuale durante transport nascosto | `tests/retained-managed-manual-watch.test.ts` |

Verifica: 2.528 test unitari, 28 E2E Chrome MV3, TypeScript sorgenti/test, lint e build Chrome/Edge superati; 261 test nelle 37 suite indicate da vexp superati. Review Standards e Spec senza rilievi aperti dopo la regressione sulla selezione startup. `vexp verify_done` non segnala errori di parsing o deriva documentale; i 7 avvisi di import sono riferimenti a re-export e fixture con nome simile, verificati con ricerca nativa e compilatori.

Baseline prima della modifica: 89 test mirati superati. Le verifiche usano adapter Chrome e pagine simulate, incluse le scritture interrotte. Non è stata avviata una sessione Twitch sul profilo personale; restart e sleep/wake reali restano da osservare, senza sovrascrivere le evidenze manuali precedenti.

## Progressione della coda e premi futuri — 6 ottobre 2026

La progressione è composta una volta nella sessione e possiede selezione, parcheggio, giri di riprova, attesa, persistenza e completamento. La discovery automatica passa solo prove positive di disponibilità e identità riabilitate; non avvia playback. Il cambio campagna conserva la preparazione e il commit già esistenti. Un successore con soli premi watch-time futuri verificati resta in coda: viene parcheggiato e non rimosso come completato.

| Caso | Evidenza automatizzata |
|---|---|
| Campagna corrente e successori futuri; code miste o tutte future; id gioco duplicati | `tests/farming-queue-scheduled-successor.test.ts` |
| Scadenza reale di riprova, futura idoneità, ricostruzione worker, Stop e Pausa | `tests/farming-queue-scheduled-successor.test.ts`, `tests/queue-advancement-cancellation.test.ts` |
| Autorizzazione manuale dopo preemption dei preferiti; priorità; giri esauriti e sleep di 72 ore simulato | `tests/v4-queue-continuation.test.ts`, `tests/parked-queue-recovery.test.ts`, `tests/queue-acquisition-round.test.ts`, `tests/continuous-queue-recovery.test.ts` |
| Prove positive rispetto a directory indisponibile; riconciliazione sincrona senza playback; watch corrente protetto | `tests/farming-queue-progression.test.ts`, `tests/queue-availability-resume.test.ts` |
| Handoff fallito, errore storage, Stop/Pausa durante preparazione e completamento terminale | `tests/farming-campaign-handoff.test.ts`, `tests/farming-queue-progression.test.ts`, `tests/session-lifecycle-summary-precedence.test.ts` |
| Chrome MV3: cambio campagna, due giri di recupero, riuso della tab, chiusura e Stop; intenti preservati dopo riciclo worker | `e2e/queue-campaign-handoff.spec.ts`, `e2e/extension-controls.spec.ts` |

Verifica finale: Bun 1.4.2, 2.522 test unitari, 28 E2E Chrome MV3, TypeScript sorgenti/test, lint senza warning e build Chrome/Edge superati. Review indipendenti Standards e Spec senza rilievi aperti dopo le correzioni dei casi senza selezione e del cleanup transport fallito. `vexp verify_done` non segnala errori di parsing o deriva documentale; i suoi 10 avvisi di import riguardano re-export presenti, verificati con i compilatori. I 457 test delle suite interessate dall'indice sono superati.

Prima della modifica: baseline mirata di 38 test superati; riproduzione in memoria, senza scritture sul profilo, della rimozione errata del successore futuro. Le nuove prove ricostruiscono il worker e avanzano l'orologio per restart/sleep; non costituiscono osservazioni manuali con Twitch reale. In questa esecuzione non è stata avviata una sessione sul profilo personale. Restano da osservare con una campagna reale il passaggio dal premio futuro a quello idoneo, due avanzamenti dei drop, riciclo worker e sleep/wake, conservando le verifiche manuali già documentate.

## Coerenza campagna, playback e progresso — 6 ottobre 2026

L'esito di avvio riguarda il candidato, non la salute del player precedente. Se il cambio fallisce, selezione e ownership restano riferite al watch reale; il problema viene registrato sulla campagna candidata. Completamento e stallo possono parcheggiare il successore senza dichiararlo attivo. Campagna, streamer e proiezione dei drop vengono preparati prima della persistenza e promossi insieme. Stop, Pausa e risultati superati impediscono la promozione.

Il playback gestito viene avviato muto e verificato osservando il tempo video. Prima del tentativo nativo, la preparazione può premere una sola volta il comando Play di Twitch se il video corrente è collegato al documento e in pausa e il pulsante collegato dichiara esplicitamente paused. Il caricamento dopo questo comando viene osservato con al massimo otto campioni e intervalli richiesti di 250 ms; il browser può ritardare i timer e il clic non prova l'avvio. Pulsanti playing, sconosciuti o sostituiti e video già in riproduzione non vengono premuti. I clic generici sulla superficie del player non fanno parte della preparazione. Un rifiuto esplicito di autoplay conserva la prima tab e mostra Start the video, condiviso da popup e monitor; non accumula errori di disponibilità. La stessa attesa copre l'interruzione esplicita tramite pause del player Twitch solo se manca l'attivazione iniziale, lo stesso video resta in pausa e il suo comando Play era stato verificato paused prima dei tentativi. Il tentativo nativo può alterare lo stato del comando senza avviare il video. Buffering, video sostituiti e AbortError generici non provano questo requisito. Il tick rileva la riproduzione dopo il gesto e riprende l'osservazione dei drop. Un candidato alternativo in questa attesa non sostituisce il watch corrente.

Le verifiche delle campagne parcheggiate non deducono zero streamer da una verifica indisponibile. Il progresso recente della campagna attiva conserva la prova di disponibilità del suo watch anche quando la directory non lo include. La preemption dei preferiti mantiene le proprie regole. Al riavvio, selezione, streamer, marker e proprietà della tab vengono verificati; un canale uguale ma una categoria diversa non ripristina la salute obsoleta.

| Caso | Evidenza automatizzata |
|---|---|
| Sessione e coordinatore reali: cambio manuale riuscito/fallito, completamento e stallo con candidato fallito | `tests/farming-campaign-handoff.test.ts` |
| Errore di persistenza, Stop/Pausa durante preparazione, ownership coerente | `tests/farming-campaign-handoff.test.ts`, `tests/watch-transport-preparation.test.ts` |
| Progresso e claim arrivati durante preparazione, completamento tardivo, serializzazione delle scritture provvisorie con lo stato vivo | `tests/farming-campaign-transition.test.ts`, `tests/state-persistence-storage.test.ts` |
| Candidato interrotto durante navigazione/marker: cleanup e nuovo tentativo senza bloccare il watch precedente | `tests/managed-watch-candidate-preservation.test.ts` |
| Play manuale dalla coda senza tab precedente, mantenendo il limite sulla creazione automatica | `tests/queued-initial-managed-watch.test.ts` |
| Sette campagne: SMITE progredisce, directory vuote e verifiche fallite sulle altre | `tests/farming-automation-discovery.test.ts` |
| Ripristino con campagna/canale/categoria incoerenti e proprietà dormiente dopo Stop | `tests/watch-transport-preparation.test.ts`, `tests/managed-watch-startup-integration.test.ts` |
| Avvio senza clic/focus: tempo video reale e progresso inventario simulato; gesto obbligatorio e ripresa nella stessa tab | `e2e/queue-campaign-handoff.spec.ts` |
| Play esplicito del sito prima del tentativo nativo; caricamento asincrono, richiesta di gesto confermata e nessun clic su video/pulsanti non validi | `tests/content-script-modules.test.ts`, `e2e/queue-campaign-handoff.spec.ts` |
| Attesa del gesto senza rotazione, acquisizione o falso progresso | `tests/farming-monitoring-recovery.test.ts`, `tests/user-status.test.ts` |

Le fixture di Twitch verificano la logica, ma non certificano il farming AFK sul servizio reale. La prova Brave richiede almeno due avanzamenti dei drop in background, cambio campagna, rotazione e riciclo del worker.

Verifica finale della build locale: Bun 1.4.2, TypeScript sorgenti e test, lint senza warning, 2.548 test unitari e 28 E2E Chrome MV3 superati; build Chrome/Edge e audit di 229 dipendenze superati. `vexp verify_done` non segnala errori di parsing o deriva documentale. Le 28 segnalazioni di import dell'indice riguardano export/re-export esistenti, verificati dai compilatori e dalla suite completa dei test interessati.

Prova Brave sulla build locale beta.59, non pubblicata: il cambio fallito conserva lo stato pubblico precedente e non annuncia il candidato come attivo. Il Play manuale di SMITE crea una tab inattiva su SoloOrTroll, confermato live nella categoria corretta, ma senza playback verificato; la sessione resta Stopped. Nessun focus o clic sulla tab è stato usato in questo tentativo pulito. Un caricamento separato in primo piano mostra un fotogramma e il tracker Twitch, ma non certifica due avanzamenti dei drop in background. Il testo alternativo del tag video nell'accessibilità non è un errore visibile del player. Le verifiche asincrone del playback restano lente nel profilo; una misura di timer singolo non dimostra una causa. Le ispezioni con scripting possono attivare il documento e non valgono come prova senza gesto.

AFK reale, rotazione, cambio campagna riuscito e riciclo del worker con progresso reale restano da verificare. TTV AB e Tampermonkey sono presenti nel profilo; il loro ruolo non è dimostrato e le impostazioni sono conservate in attesa dell'autorizzazione a una prova di isolamento temporanea. La sessione viene lasciata fermata e la coda conservata.

Versione locale aggiornata a `4.0.0-beta.60` (manifest tecnico `3.99.0.60`): build Chrome/Edge rigenerate, TypeScript sorgenti/test e 17 test di versione, transizione storage e controllo release superati. Nessuna pubblicazione; il limite della verifica AFK reale resta aperto.

## Campagne guadagnate in attesa di claim — 6 ottobre 2026

Un premio claimable o già al 100% non richiede altro tempo di visione. La campagna resta consultabile senza confondere il completamento del farming con l'acquisizione: se l'account non è collegato, il gruppo e il dettaglio offrono Link account al posto di Add. I premi misti mantengono Add finché esiste almeno un premio da guardare; i premi futuri restano accodabili. Il claim automatico conserva la propria eleggibilità separata.

| Caso | Evidenza |
|---|---|
| Claimable con progresso 100% o regredito; premi nativi, acquisiti e futura disponibilità | `tests/claimable-queue-eligibility.test.ts`, `tests/reward-semantics.test.ts`, `tests/reward-scheduling-period.test.ts` |
| Account collegato/non collegato, campagne miste e identità distinte dello stesso gioco | `tests/popup-game-disclosure.test.tsx`, `tests/claimable-queue-eligibility.test.ts` |
| Add lato background da catalogo/cache/selezione e Start con testa guadagnata e riepilogo obsoleto | `tests/claimable-queue-eligibility.test.ts` |
| Refresh regredito conserva claimability senza avviare preferiti o registrare falsa acquisizione | `tests/campaign-completion-lifecycle.test.ts` |
| Popup Chrome MV3: Link visibile, Add assente, Start disabilitato e richiesta runtime rifiutata | `e2e/extension-controls.spec.ts` |

Una lista vuota da un refresh parziale non prova il completamento. Le prove automatiche usano dati Twitch simulati; il collegamento reale con il provider del gioco e il successivo riscatto richiedono una campagna reale.

La `4.0.0-beta.59` ha superato il gate completo `bun run release:check`: TypeScript sorgenti/test, lint, suite unitaria, E2E Chrome MV3, audit dipendenze, build/archivi Chrome ed Edge e controllo dei manifest `3.99.0.59`. Verificato visivamente il popup renderizzato dal nuovo E2E. Questa beta resta destinata a GitHub e installazioni locali, non agli store.

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
