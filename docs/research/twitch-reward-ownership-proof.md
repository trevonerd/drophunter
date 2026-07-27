# Verificare badge ed emote Twitch ottenuti tramite Drops

Data della ricerca: 15 luglio 2026.

## Risposta breve

Con i dati che DropHunter legge già dalla sessione Twitch, `currentUser.inventory.gameEventDrops` può fornire una prova positiva che Twitch ha **assegnato** un benefit all'utente corrente. La prova è forte quando l'ID del benefit coincide e `lastAwardedAt` cade nella finestra della ricompensa; senza timestamp, con ID riutilizzati o con campagne sovrapposte, il dato diventa un indizio e non identifica con certezza la campagna che ha prodotto l'assegnazione.

Non esiste invece un endpoint Helix pubblico che, senza nuovi permessi e per un qualunque utente, colleghi la proprietà corrente di uno specifico badge o emote a una specifica campagna Drops:

- per le **emote**, `Get User Emotes` può confermare che una specifica emote è attualmente disponibile all'utente, ma richiede un user access token con scope `user:read:emotes` e non restituisce `campaign_id` o `benefit_id`;
- per i **badge**, gli endpoint pubblici restituiscono cataloghi di badge globali o di canale, non la collezione posseduta da un utente;
- `Get Drops Entitlements` espone `benefit_id`, utente, gioco e timestamp, ma il Client ID deve appartenere all'organizzazione proprietaria del gioco: non è una superficie generale utilizzabile da DropHunter per campagne di terzi o ricompense Twitch-native.

## Matrice delle prove

| Segnale Twitch | Badge | Emote | Autorizzazione aggiuntiva | Collega a una campagna Drops? |
|---|---|---|---|---|
| GraphQL web `currentUser.inventory.gameEventDrops` | Prova positiva dell'assegnazione se il `benefit.id` coincide e il timestamp è compatibile; non è una prova pubblicamente contrattualizzata della proprietà corrente | Stessa prova positiva dell'assegnazione; non dimostra che un'emote a tempo limitato sia ancora utilizzabile | No: è già letto con la sessione web Twitch | Non contiene un `campaign_id`; il collegamento deriva da benefit ID, gioco e finestra temporale. È euristico quando timestamp o unicità mancano |
| Helix `GET /helix/chat/emotes/user` | Non applicabile | Prova della **disponibilità corrente** per l'utente, tramite l'ID emote | Sì: user access token con `user:read:emotes`; `user_id` deve coincidere col token | No: la risposta contiene ID, nome, tipo, set e proprietario dell'emote, non campaign/benefit ID |
| Helix `GET /helix/chat/badges/global` e `/helix/chat/badges` | Nessuna prova di proprietà: sono cataloghi di definizioni globali o del broadcaster | Non applicabile | App o user access token; nessuno scope specifico indicato | No |
| IRC `GLOBALUSERSTATE` / `USERSTATE` | Prova positiva dei badge che Twitch sta associando allo stato chat autenticato; l'assenza non esclude il possesso, perché l'utente sceglie quali badge mostrare | Elenca gli `emote-sets` accessibili, non collega direttamente una ricompensa Drops | Connessione IRC autenticata; la guida IRC richiede token con `chat:read` e `chat:edit` | No |
| Helix `GET /helix/entitlements/drops` | Potenziale prova di entitlement se l'organizzazione è proprietaria del gioco | Potenziale prova di entitlement alle stesse condizioni | Token il cui Client ID appartiene a un membro dell'organizzazione proprietaria del gioco | Restituisce `benefit_id`, `timestamp`, `user_id` e `game_id`, ma non è accessibile come inventario generale del viewer |
| UI Twitch “Drops & Rewards” / raccolta badge | Prova manuale positiva per i Creator Badge Drops; Twitch dichiara che i badge ottenuti compaiono nella raccolta del canale e tra le ricompense claimed | Il selettore emote è un controllo manuale di disponibilità, ma Helix è la superficie programmabile documentata | Sessione Twitch interattiva | L'UI può mostrare il contesto umano, ma non offre un contratto API stabile |

La restrizione della riga Entitlements è esplicita nel contratto ufficiale: `Get Drops Entitlements` restituisce `benefit_id`, timestamp, utente e gioco, ma il Client ID del token deve appartenere a un membro dell'organizzazione che possiede il gioco ([Get Drops Entitlements](https://dev.twitch.tv/docs/api/reference/#get-drops-entitlements)).

## Badge

### Cosa si può provare oggi

Il contratto catturato dal repository legge `gameEventDrops` dall'inventario dell'utente autenticato e registra `game`, `name`, `id` del benefit e `lastAwardedAt` ([parser locale](../../src/background/twitch-api/claimed-rewards.ts#L44-L77)). Quando una ricompensa è `BADGE` o `EMOTE`, DropHunter consente al segnale di assegnazione di correggere uno stato di avanzamento ancora parziale, ma usa un match più stretto se esiste già uno stato inventario legato a una campagna ([proiezione locale](../../src/background/twitch-api/client.ts#L431-L464)).

Questo è sufficiente per dire **“Twitch ha registrato l'assegnazione di questo benefit per l'utente corrente”** quando:

1. il `benefit.id` della ricompensa coincide esattamente con l'`id` in `gameEventDrops`;
2. il gioco coincide;
3. `lastAwardedAt` è valido e cade nella finestra della ricompensa.

Non è sufficiente per dire **“il badge è certamente ancora nella collezione”**: `gameEventDrops` è un contratto GraphQL interno del sito Twitch, non documentato nell'API pubblica, e il record non espone un identificatore di campagna. La stessa implementazione locale deve quindi difendersi da timestamp mancanti/invalidi e benefit ID duplicati o riutilizzati ([regole di match locali](../../src/background/twitch-api/claimed-rewards.ts#L112-L170)).

Gli endpoint Helix per i badge non risolvono questo limite. Twitch documenta `Get Global Chat Badges` come lista dei badge Twitch e `Get Channel Chat Badges` come lista dei badge creati da un broadcaster; le risposte contengono set e versioni, non un `user_id` né uno stato “owned” ([Twitch API Reference, badge globali](https://dev.twitch.tv/docs/api/reference/#get-global-chat-badges), [badge di canale](https://dev.twitch.tv/docs/api/reference/#get-channel-chat-badges)).

IRC espone i badge nello stato dell'utente autenticato, ma soltanto come badge associati alla sua identità chat. Twitch permette di scegliere quali badge mostrare e di usare una scelta diversa per uno specifico canale; quindi un badge presente è una prova positiva, mentre un badge assente non dimostra che non sia posseduto ([IRC `GLOBALUSERSTATE`](https://dev.twitch.tv/docs/chat/irc/#globaluserstate-tags), [How to Use Badges](https://help.twitch.tv/s/article/how-to-use-badges)). Anche qui non esiste un legame con campagna o benefit ID.

Per i Creator Badge Drops esiste infine una verifica manuale first-party: Twitch afferma che i badge ottenuti compaiono nella raccolta badge del canale e, come claimed, nella pagina Drops & Rewards ([Creator Badge Drops](https://help.twitch.tv/s/article/creator-badge-rewards)). È una buona conferma utente, non una superficie automatizzabile stabile.

### Conclusione badge

- **Con i dati di sessione esistenti:** sì, si può provare l'assegnazione tramite un match stretto su `gameEventDrops`; no, non si può interrogare una collezione badge pubblica e contrattualizzata.
- **Endpoint/scope aggiuntivi:** non esiste oggi un endpoint Helix “Get User Badges”. IRC richiederebbe una nuova integrazione chat e i relativi scope, ma confermerebbe soltanto i badge mostrati.
- **Attribuzione a una campagna:** certa soltanto quando ID, gioco e timestamp rendono univoco il match; altrimenti deve essere presentata come probabile o sconosciuta.

## Emote

### Cosa si può provare oggi

La stessa prova `gameEventDrops` può stabilire che Twitch ha assegnato il benefit dell'emote, anche quando la progress bar della ricompensa è ancora al 98–99%. Il repository ha già un test di contratto che simula precisamente un'emote a 58/60 minuti e un record `gameEventDrops` con lo stesso benefit ID e un `lastAwardedAt` nella finestra; il risultato atteso diventa claimed, 100% e completed ([test locale](../../tests/api-operations.test.ts#L560-L644)).

Per verificare la **disponibilità corrente** esiste una superficie pubblica più forte: Twitch documenta `GET https://api.twitch.tv/helix/chat/emotes/user` come elenco delle emote disponibili all'utente su tutti i canali. Richiede `user:read:emotes`, e `user_id` deve coincidere con quello del token. Ogni elemento restituisce l'ID univoco dell'emote, nome, `emote_type`, `emote_set_id` e `owner_id`; tra i tipi documentati ci sono `rewards` (evento speciale) e `limitedtime` ([Get User Emotes](https://dev.twitch.tv/docs/api/reference/#get-user-emotes), [scope `user:read:emotes`](https://dev.twitch.tv/docs/authentication/scopes/)).

Questa API prova che **l'emote identificata da quell'ID è utilizzabile adesso**. Non prova da quale campagna provenga: la risposta non contiene `campaign_id`, Drop ID o `benefit_id`, e `emote_type: rewards` distingue soltanto la categoria generale “special event”. Per collegarla con certezza alla ricompensa Drops servirebbe che il payload della campagna esponesse anche lo stesso ID emote; il contratto attualmente catturato conserva soltanto benefit ID, nome e `distributionType`, quindi un match per nome o immagine sarebbe euristico.

DropHunter non conserva gli scope del token web che estrae; conserva token, utente, device e Client ID ([sessione locale](../../src/background/twitch-api/types.ts#L1-L20)). Twitch offre `/oauth2/validate` per scoprire `client_id`, scope e utente del token ([Validating Tokens](https://dev.twitch.tv/docs/authentication/validate-tokens/)). Tuttavia, per una integrazione pubblica e supportata non si deve assumere che il token first-party del sito Twitch abbia `user:read:emotes`: occorre un OAuth user token dell'app con quel consenso, salvo che una validazione positiva dimostri già lo scope sul token in uso. Twitch indica l'implicit grant come flusso per app client-side senza server ([Getting OAuth Access Tokens](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/)).

### Conclusione emote

- **Con i dati di sessione esistenti:** sì, `gameEventDrops` può provare l'assegnazione; no, non garantisce l'accesso corrente, soprattutto per emote a tempo limitato.
- **Endpoint/scope aggiuntivi:** `Get User Emotes` fornisce la prova corrente per ID emote, ma richiede `user:read:emotes` e un user token autorizzato.
- **Attribuzione a una campagna:** l'endpoint non la fornisce. Serve un mapping certo benefit ID → emote ID; nome, immagine o `emote_type` da soli non bastano.

## Cosa prova e cosa non prova `gameEventDrops`

`gameEventDrops` può provare positivamente che il backend dell'inventario dell'utente autenticato ha registrato un'assegnazione per un benefit. È particolarmente utile per badge ed emote assegnati prima che la progress bar raggiunga 100%, perché è indipendente dallo stato parziale del `dropCampaignsInProgress`.

Non prova invece:

- che la ricompensa sia ancora utilizzabile o non sia scaduta/revocata;
- che l'oggetto sia stato consegnato dentro un gioco;
- che l'assegnazione appartenga a una specifica campagna quando il benefit ID è riutilizzato e manca un timestamp discriminante;
- che l'assenza del record significhi “non ottenuto” (il contratto è interno, può essere incompleto o in ritardo);
- che `isClaimed`/progress della singola istanza sia aggiornato: proprio la divergenza tra questi campi e `gameEventDrops` è il caso da correggere.

Il livello di certezza consigliato è quindi:

1. **Assegnato (certo):** exact benefit ID + stesso gioco + timestamp valido dentro la finestra.
2. **Assegnato (forte ma non attribuibile):** exact benefit ID senza timestamp, solo se l'ID è noto come univoco tra le campagne considerate.
3. **Probabile:** corrispondenza soltanto per nome, immagine, tipo ricompensa o ID riutilizzato.
4. **Non verificabile:** nessun record positivo dopo un'anomalia attribuibile o una recovery esaurita; non trasformare l'assenza, da sola, in “non ottenuto”.

## Implicazione di prodotto

Il modello dovrebbe distinguere almeno tre stati, senza forzare tutti dentro `claimed: boolean`:

- **assegnazione confermata da Twitch** (`gameEventDrops` con prova stretta);
- **disponibilità corrente confermata** (solo emote, via `Get User Emotes`, se si introduce OAuth dedicato e un mapping ID certo);
- **stato sconosciuto** dopo un'anomalia attribuibile o una recovery esaurita, che non deve bloccare indefinitamente una farming session. La UI può conservare lo 0/99% riportato da Twitch, ma deve qualificarlo come non verificabile invece di presentarlo come certezza.

Una campagna appena scoperta a 0%, senza indizi contraddittori e prima di un tentativo di farming fallito, non rientra in questo stato: resta pronta da farmare.

Per i badge, finché Twitch non espone una API per la collezione dell'utente, l'assegnazione confermata da `gameEventDrops` più un link/istruzione alla raccolta badge Twitch è il massimo livello affidabile senza automatizzare UI interne.
