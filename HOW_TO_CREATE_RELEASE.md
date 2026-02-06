# 📦 Come Creare la Release v1.0.0 su GitHub

## Metodo 1: Tramite Interfaccia Web GitHub (Consigliato)

1. **Vai su GitHub**: Apri il repository su https://github.com/trevonerd/twitch-extension

2. **Clicca su "Releases"**: Nella sidebar destra o nel menu principale

3. **Clicca "Draft a new release"** o "Create a new release"

4. **Compila i campi**:
   - **Tag version**: `v1.0.0`
   - **Target**: Seleziona il branch `claude/simple-chrome-extension-011CUuJ54utqbFWJAyANorky` (o main/master se hai fatto merge)
   - **Release title**: `Twitch Drops Manager v1.0.0 🎮`
   - **Description**: Copia e incolla il contenuto da `RELEASE_NOTES_v1.0.0.md`

5. **Carica il file ZIP**:
   - Trascina il file `twitch-drops-manager-v1.0.0.zip` (presente nella root del progetto)
   - Oppure clicca "Attach binaries by dropping them here or selecting them"

6. **Pubblica**:
   - Se vuoi una pre-release, spunta "This is a pre-release"
   - Altrimenti clicca "Publish release"

## Metodo 2: Via GitHub CLI (se disponibile localmente)

Se hai `gh` installato sul tuo computer locale:

```bash
gh release create v1.0.0 twitch-drops-manager-v1.0.0.zip \
  --title "Twitch Drops Manager v1.0.0 🎮" \
  --notes-file RELEASE_NOTES_v1.0.0.md \
  --target claude/simple-chrome-extension-011CUuJ54utqbFWJAyANorky
```

## 📍 File Necessari

- ✅ `twitch-drops-manager-v1.0.0.zip` - Package dell'estensione (già creato nella root)
- ✅ `RELEASE_NOTES_v1.0.0.md` - Note di release (già committato)

## 🎯 Risultato

Una volta pubblicata, la release sarà visibile su:
```
https://github.com/trevonerd/twitch-extension/releases/tag/v1.0.0
```

Gli utenti potranno scaricare il file ZIP direttamente dalla pagina della release!

## 💡 Tip

Se vuoi fare merge del branch nel main prima di creare la release:

```bash
git checkout main
git merge claude/simple-chrome-extension-011CUuJ54utqbFWJAyANorky
git push origin main
```

Poi crea la release puntando al branch `main` invece che al branch feature.
