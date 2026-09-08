# Piano: impedire il rientro delle campagne completate

Data: 2026-09-07. Stato: implementazione autorizzata con «procedi»; risultati e verifiche nel [rapporto di implementazione](2026-09-07-campaign-lifecycle-report.md). Le sezioni seguenti conservano la valutazione e la baseline della fase di pianificazione.

## Obiettivo e perimetro

Riprodurre e correggere la sequenza segnalata: campagne già completate → notifiche di aggiunta ai preferiti → avvio automatico → skip immediato. Una campagna con completamento dimostrato non deve rientrare nella coda eseguibile, nella selezione o negli effetti utente tramite refresh, preferiti o ripristino. Una nuova campagna dello stesso gioco con un diverso `campaignId` resta indipendente.

Questa attività prepara il piano richiesto dall'utente. Le istruzioni di implementazione nel prompt allegato descrivono la fase successiva. Non sono stati modificati sorgenti o test e non è stata dichiarata una causa senza riproduzione.

## Valutazione del prompt originale

Il requisito principale è corretto. Il prompt non va eseguito alla lettera nei seguenti punti:

1. **Il flusso ipotetico non è una diagnosi.** Esistono già filtri di farmabilità e notifiche successive alla persistenza. La causa può precedere questi controlli oppure riguardare snapshot discordanti, riconciliazione o concorrenza.
2. **`campaign.completed` e `activeCampaign` sono pseudocodice.** I contratti osservati usano `rewardSummary.completion`, `allDropsCompleted`, `selectedGame`, stato della sessione e ricevute di transizione. Non aggiungere alias o booleani paralleli.
3. **Separare completamento e possibilità di farming.** `all-acquired` e `farming-complete` sono diversi: il secondo può includere premi subscription o Twitch-native non verificabili. Zero streamer, errori API, snapshot parziali e assenza di progresso non sono prove di completamento.
4. **Il 100% di un premio non prova il completamento dell'intera campagna.** Verificare tutti i premi pertinenti, completezza dello snapshot e claim ancora possibili; preservare il flusso di acquisizione dei premi maturati.
5. **Non richiedere disponibilità immediata per conservare ogni voce manuale.** Il dominio prevede campagne parcheggiate e retry. Una campagna temporaneamente offline può restare in attesa, ma non essere attivata senza i requisiti necessari.
6. **Identità di campagna e identità del viewer sono distinte.** Usare il Twitch campaign ID per la campagna; se serve memoria durevole del completamento, limitarla all'account corretto. Channel e benefit ID servono alle verifiche dei premi, non a sostituire il campaign ID.
7. **Precisare la terminalità.** Prove positive di acquisizione non devono regredire per dati peggiori. Una scadenza calcolata da dati vecchi o una classificazione `farming-complete` non devono diventare tombstone irreversibili senza una policy esplicita. Un eventuale nuovo insieme di premi sotto lo stesso ID è un caso da documentare, non da risolvere inventando il comportamento Twitch.
8. **Evitare la macchina a stati unica proposta.** `queued`/`active` descrivono la sessione, mentre completamento, periodo, disponibilità e acquisizione sono dimensioni diverse. Una decisione condivisa di eleggibilità può bastare.
9. **Notifiche idempotenti, senza promettere exactly-once esterno.** Testare deduplicazione locale e crash ai confini del commit. Un invio Telegram riuscito seguito da un crash prima dell'ack locale richiede una policy esplicita, non una garanzia impossibile dal solo client.
10. **“Nessuna regressione” è un criterio di verifica, non una certezza assoluta.** Preservare le funzioni esistenti con test specifici e riferire ciò che non è stato verificato dal vivo.

## Evidenze già verificate

Riferimenti relativi alla root del repository; linee riferite al worktree osservato.

| Punto | Codice osservato | Conseguenza per il piano |
| --- | --- | --- |
| Identità | `src/shared/game-selection.ts:76`, `gameKey`: `campaign:<campaignId>`, poi fallback ID/nome | Riutilizzare la chiave canonica. Non registrare completamento definitivo tramite fallback ambiguo. |
| Preferiti | `src/background/favorite-games.ts:52`, `planFavoriteCampaignQueue`: nuove aggiunte richiedono `rewardSummary.completion === 'farmable'` e non scadute | Non aggiungere soltanto un secondo controllo equivalente. Verificare la qualità del summary in ingresso. |
| Coda esistente | Lo stesso planner conserva voci manuali e può reinserire la campagna attiva | Verificare il confine che riconcilia queste voci prima del planner e prima dell'avvio. Non rimuovere la protezione della sessione attiva indiscriminatamente. |
| Notifiche | `src/background/farming-automation-effects.ts:57`, `persistFarmingAutomationPlan`: notifica `added` dopo `savePolicyPatch` con risultato `written` | Il requisito di persistenza esiste già; verificare che `added` rappresenti lo stato realmente accettato e ancora valido. |
| Normalizzazione | `src/background/farming-automation-normalization.ts:136`: `withoutPriorCompletion` cancella summary e flag; `:143` ricostruisce dai drop | Punto da esercitare con prove forti pregresse e dati nuovi degradati. La cancellazione da sola non dimostra il bug: può prevenire classificazioni obsolete. |
| Completezza | `src/background/drops-projection-semantics.ts:185`: annotazione solo con provenienza autorevole e insieme identificato completo | Conservare questa difesa; controllare che la provenienza sia giustificata lungo l'adapter. |
| Semantica | `src/shared/reward-semantics.ts:59`: distingue `farmable`, `all-acquired`, `farming-complete` | Riutilizzare le regole dei premi; non ridurre tutto a una percentuale o un booleano. |
| Async | `src/background/farming-automation-evaluator.ts:42`: facts caricati, fingerprint prima/dopo discovery e osservazione, poi transizione | Esistono già protezioni. Testare i cambiamenti rilevanti nei diversi await e prima della persistenza, senza introdurre un secondo coordinatore. |
| Fingerprint | `src/background/farming-automation-gates.ts:141`: include chiavi, fine e summary delle campagne, oltre allo stato sessione/policy | Verificare se le prove di completamento cambiano sempre uno dei campi osservati. Non affermare che ogni race sia già coperta. |
| Riconciliazione | `src/background/queue-operations.ts:117`, `normalizeQueueSelection`: identità, deduplica, assenza confermata e grace dopo crash | Non effettua in questa funzione un filtro generale di completamento/scadenza. Tracciare i chiamanti e la pulizia dedicata prima di decidere dove correggere. |

`CONTEXT.md` conferma le distinzioni tra coda manuale autorizzata, campagna parcheggiata, refresh autorevole e farming-complete.

Limiti: il worktree contiene molte modifiche preesistenti anche nelle aree coinvolte; preservarle. Il servizio vexp interrogato ha restituito un altro repository, quindi i suoi risultati sono stati scartati. L'orientamento è stato ottenuto con CCE DropHunter e i sorgenti dei simboli tramite knowledge graph. Nessun payload Twitch del caso segnalato è stato acquisito: la causa dell'episodio resta da riprodurre.

## Approccio scelto

**Raccomandato: rafforzare i confini esistenti con prove e regressioni.** Riprodurre la perdita o il mancato consumo delle prove di completamento; correggere il punto più a monte che le invalida e riutilizzare la decisione nei confini di coda e attivazione. È la soluzione con minore impatto sui comportamenti attuali.

**Alternativa condizionata: registro durevole delle prove di completamento.** Aggiungerlo soltanto se la regressione dimostra che snapshot/cache/persistenza attuali non possono conservare l'informazione necessaria. Richiede versione, account scope, migrazione, reset e policy di conservazione. Non basta un Set globale di giochi o ID.

**Non raccomandato: riscrivere l'intero ciclo di vita come FSM.** Mescola disponibilità temporanea e stato sessione, aumenta i percorsi modificati e non risolve di per sé una classificazione errata.

## Piano di esecuzione

### 1. Riproduzione e mappa dei confini

Partire dai test pubblici `FarmingAutomation.request`, con adapter Twitch, persistenza e notifiche controllati. Preparare una campagna favorita completata, una campagna valida e un discovery successivo della stessa identità con progresso assente/regredito. Eseguire anche la variante con coda persistita e worker ricreato.

Asserire la sequenza completa: nessuna aggiunta invalida, nessuna transizione o preparazione del watch per la campagna completata, nessuna notifica browser/Telegram di aggiunta o avvio, nessuno skip causato da un avvio invalido; la campagna valida deve continuare a funzionare. Annotare comando e fallimento prima del fix. Se il primo scenario è verde, variare una sola condizione alla volta; non attribuire comunque la causa alla normalizzazione.

Completare una tabella `ingresso → dati/provenienza → validazione → mutazione → persistenza → broadcast → notifica` per i 15 punti del prompt. Seguire discovery/API, normalizzazione, identità, load/save, progresso, preferiti, eleggibilità, disponibilità, inserimento, ordinamento, auto-start, restore, skip, completion e notifiche. Cercare definizioni e chiamanti tramite CCE/graph; audit ampio, diff limitato alle violazioni dimostrate.

**Uscita:** almeno un test rosso che attraversa il percorso pubblico pertinente, oppure un resoconto esplicito dei tentativi e dell'evidenza mancante. Nessun fix basato soltanto sui nomi delle funzioni.

### 2. Definire la decisione di eleggibilità e le prove

Usare i contratti esistenti; estendere una funzione pura condivisa solo dove elimina divergenze reali. Separare almeno: completamento provato, dati insufficienti, non iniziata, scaduta, nessun premio automatizzabile e indisponibilità temporanea degli streamer. La decisione deve ricevere tempo e prove esplicitamente, senza rete o storage al suo interno.

La completezza riguarda l'insieme identificato dei premi della campagna: non dedurla da un sottoinsieme di drop claimed o da benefit condivisi. Snapshot parziali, riordinamento, localizzazione e oggetti ricreati non devono cancellare prove più forti. Identità mancante/ambigua non deve autorizzare un avvio automatico per fallback sul nome del gioco.

Se è necessario il registro durevole, registrare solo prove ammissibili con identità account/campagna, origine e dati minimi che le sostengono. Caricarlo prima dell'accettazione; testare account switch, migrazione di vecchi record, reset intenzionale e dati corrotti. Non promuovere retroattivamente ogni vecchio `allDropsCompleted` a prova certa senza verificarne la provenienza.

**Uscita:** tabella delle decisioni con input/output verificabili; nessuna nuova enum di lifecycle obbligatoria.

### 3. Correggere riconciliazione e policy

Applicare la decisione alle nuove candidature prima dei preferiti e del ranking; riconciliare anche coda già esistente e selezione recuperata con le prove più recenti. Il commit di coda deve usare la medesima identità e produrre aggiunte/rimozioni effettive, con metadata coerenti.

Verificare planner preferiti, inserimenti manuali, selezione esplicita, refresh, avanzamento e restore. Conservare ordine manuale, autorizzazione tramite Start, precedenza dei preferiti, categorie nascoste, parcheggio, grace per snapshot mancanti e retry. La grace non deve rendere attivabile una campagna il cui completamento è positivamente dimostrato.

Gestire la campagna attiva che completa attraverso il lifecycle esistente: acquisizione dei premi maturati, rilascio del trasporto posseduto e avanzamento unico alla prossima campagna valida. Nessun loop start/skip e nessuna cancellazione delle preferenze del gioco.

**Uscita:** nuove aggiunte e vecchie voci rispettano le stesse prove terminali; la perdita temporanea di rete/streamer conserva il recupero previsto.

### 4. Proteggere i confini asincroni

Usare deferred promises e clock controllato, senza sleep reali. Intercalare completion/scadenza, refresh, Stop/Start, cambio account o preferiti durante discovery, caricamento, osservazione manuale, preparazione watch e commit. Rileggere il tempo quando conta: una campagna valida all'inizio può scadere durante un await.

Verificare initialization barrier del service worker e moduli startup/persistenza; estendere revision/fingerprint o validazione al commit solo se il test dimostra una lacuna. Le risposte obsolete non devono resuscitare una campagna, sovrascrivere una coda aggiornata o lasciare un trasporto preparato senza proprietario. Preservare la sessione valida corrente quando il nuovo tentativo viene annullato.

**Uscita:** test deterministici per completion durante discovery e tra selezione e commit, startup incompleto e refresh concorrenti.

### 5. Notifiche e diagnostica

Mantenere l'ordine di persistenza/broadcast/effetti già previsto. Derivare “aggiunta” dal delta accettato e “avviata” dalla transizione realmente committata; conservare le ricevute e l'identità degli eventi. Provare retry, errore storage e riavvio: nessuna notifica per tentativi rifiutati, nessun duplicato nei replay gestiti.

Aggiungere motivi strutturati solo nel meccanismo debug esistente: campaign ID, provenienza, decisione e motivo; includere soltanto i dati indispensabili, senza credenziali o emissione normale per ogni tick. Se manca un debug gate adeguato, progettarne il minimo necessario prima di aggiungere log permanenti.

**Uscita:** test distinti per stato accettato ed effetti browser/Telegram; politica esplicita per crash durante invio esterno.

### 6. Verifica e revisione conclusiva

Eseguire prima la regressione originale e i test delle aree cambiate, poi TypeScript, lint e suite completa. Ispezionare il diff rispetto al worktree iniziale, distinguendo modifiche proprie da quelle preesistenti. Tracciare nuovamente startup → discovery → policy → queue → transition → effects e il percorso completion → advance.

Per una consegna come build/release eseguire anche build di entrambi i browser e audit dipendenze come previsto dal repository. La QA Twitch dal vivo deve seguire `docs/soak-test-checklist.md`; riportare separatamente scenari realmente eseguiti e limiti dovuti alle campagne disponibili.

## Matrice minima di regressione

| Scenario | Esito richiesto |
| --- | --- |
| Completata favorita/non favorita presente nel discovery | Non aggiunta, non avviata; nessun effetto di aggiunta/priorità |
| Favorita valida + favorita completata | Solo la valida ammessa; priorità esistente preservata |
| Stesso gioco, nuovo campaign ID | La campagna nuova funziona |
| Stesso ID, nome/lingua/ordine risposta diverso | Nessuna nuova identità o nuova notifica |
| Benefit duplicati/condivisi, premi assenti o parziali | Nessun falso completamento e nessuna regressione di prove forti |
| Completamento mentre in coda/attiva | Riconciliazione e avanzamento una volta; claim preservato |
| Coda o selezione completata persistita al restart | Nessuna riattivazione; stato e UI riconciliati |
| Stato caricato dopo trigger discovery | Nessuna accettazione anticipata o notifica invalida |
| Scaduta/futura, anche durante await | Nessuna attivazione fuori periodo |
| 100% con claim pendente; reward subscription/Twitch-native | Rispetto della semantica dei premi, nessuna falsa acquisizione |
| Streamer offline, errore API, snapshot parziale | Nessun tombstone permanente; recupero/parcheggio preservati |
| Refresh ripetuti e simultanei, duplicati nello stesso batch | Una voce per identità; nessun replay duplicato degli effetti |
| Completion tra discovery, selezione e commit | Tentativo obsoleto respinto e risorse preparate ripulite |
| Storage fallisce, retry o crash dopo commit | Stato coerente e comportamento notifiche verificato |
| Queue manuale non autorizzata/autorizzata, preferiti e hide | Nessun auto-start manuale indesiderato; continuazione autorizzata preservata |
| Cambio account e reset, se si introduce memoria durevole | Nessuna contaminazione tra account o migrazione distruttiva |

## Test e comandi

Baseline eseguita il 2026-09-07:

```sh
rtk proxy bun test tests/farming-automation-candidates.test.ts tests/farming-automation-queue.test.ts tests/farming-automation-effects.test.ts tests/farming-automation-persistence.test.ts tests/farming-session-transition-race.test.ts
```

Risultato: **32 pass, 0 fail, 68 assertion, 5 file**. Questi test provano la baseline, non riproducono ancora l'episodio segnalato. Le righe di errore degli effetti sono prodotte da scenari di fallimento atteso; il processo termina con codice 0.

Collocare le regressioni nelle suite esistenti pertinenti, usando le fixture pubbliche: candidati/coda/effetti/persistenza/race; estendere inoltre le suite di proiezione, identità, startup e queue-management quando il tracciamento individua il punto concreto. Per un caso end-to-end trasversale è appropriato un nuovo `tests/campaign-completion-lifecycle.test.ts`, senza duplicare i test unitari già presenti.

Gate successivo all'implementazione:

```sh
rtk proxy bun run test:ts
rtk proxy bun run lint
rtk proxy bun test tests/
rtk proxy bun run build:all
rtk proxy bun audit
```

TypeScript/lint/suite completa/build/audit non sono stati eseguiti durante questa pianificazione. Nessuna modifica di runtime da validare in questa fase.

## Prompt operativo corretto per la fase di implementazione

> Esegui questo piano sul worktree corrente di DropHunter, preservando le modifiche preesistenti. Parti da una regressione del percorso pubblico che riproduca il rientro di una campagna con completamento dimostrato, includendo coda, avvio e notifiche. Non trattare come cause accertate le ipotesi del prompt originale. Riutilizza identità campaign-aware, semantica dei premi, persistenza e transizioni esistenti. Impedisci che prove più deboli, preferiti o risposte obsolete annullino un completamento valido; una nuova campagna con un diverso ID deve restare indipendente. Distingui completamento, claim pendente, farming-complete, snapshot sconosciuto e indisponibilità temporanea. Verifica anche coda persistita, restore, inserimento manuale, avanzamento e ogni confine asincrono fino al commit. Introduci memoria durevole o nuovi contratti solo se il test ne dimostra la necessità, con account scope e migrazione verificati. Le notifiche devono descrivere transizioni accettate. Mantieni parcheggio, retry, manual queue authorization, preferiti, hide, trasporti e claim. Esegui la matrice e i gate pertinenti; riporta causa provata, flusso prima/dopo, modifiche proprie, test rossi/verdi, comandi e risultati, QA effettuata e ambiguità residue. Non dichiarare corretto il problema se la sequenza originale non è stata riprodotta e poi eliminata.
