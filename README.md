# 🎯 DropHunter - Twitch Drops Chrome Extension

A modern and sleek Chrome extension to automatically manage Twitch drops. Monitor, collect, and track your favorite drops intelligently!

## ✨ Features

- 🎯 **Game Selection**: Easily select games with active drops
- ▶️ **Play/Pause Controls**: Manage drop farming as you wish
- 📊 **Progress Tracking**: Monitor completion percentage in real-time
- ✅ **Completed Drops List**: View all drops you've already obtained
- 🎨 **Modern UI**: Attractive interface with Twitch theme
- 🔇 **Muted Tabs**: Automatically opens streamers in muted tabs
- 💾 **State Persistence**: Automatically saves state even after restart

## 🛠️ Technologies

- **React 18** - Modern and reactive UI
- **TypeScript** - Complete type safety
- **Vite** - Lightning-fast build
- **Tailwind CSS** - Professional styling
- **Chrome Extension API V3** - Latest API version

## 📦 Super Simple Installation

### ⚡ Quick Method (RECOMMENDED)

The `dist/` folder already contains the compiled extension!

1. Open Chrome → `chrome://extensions/`
2. Enable **"Developer mode"** (toggle in top right)
3. Click **"Load unpacked"**
4. Select the **`dist/`** folder
5. ✅ **Done!** Extension installed!

### 🔨 Build from Scratch (optional)

Only if you want to recompile:

```bash
npm install
npm run build
```

**Done!** Icons are already included, no complicated setup needed.

---

## 🚀 How to Use

1. **Open Twitch Drops page**:
   - Go to https://www.twitch.tv/drops/campaigns
   - Extension will automatically detect available games

2. **Open Popup**:
   - Click extension icon in toolbar

3. **Select a Game**:
   - Choose a game from dropdown menu

4. **Start Farming**:
   - Click "Start Farming" button ▶️
   - Extension will open a streamer with active drops (muted)

5. **Monitor Progress**:
   - See drop progress in real-time
   - Use "Pause" ⏸️ to temporarily stop
   - Use "Stop" ⏹️ to completely terminate

6. **Completed Drops**:
   - Extension continues automatically until all drops are completed
   - Completed drops appear in dedicated list

## 📁 Project Structure

```
drophunter/
├── dist/              # Extension build ready for Chrome
├── src/
│   ├── popup/        # React UI
│   ├── background/   # Service worker
│   ├── content/      # Content script
│   └── types/        # TypeScript types
├── public/
│   ├── icons/        # PNG icons (16,32,48,128)
│   └── manifest.json # Manifest V3
└── vite.config.ts    # Build configuration
```

## 🔧 Development

### Available Commands

```bash
# Production build
npm run build

# Dev mode with hot reload
npm run dev

# Preview
npm run preview
```

### Development Workflow

1. Modify code in `src/`
2. Run `npm run build`
3. Go to `chrome://extensions/` → click "↻ Reload" on extension
4. Test changes

**Tip:** Icons are already included in `public/icons/`, no need to regenerate!

## ⚠️ Important Notes

- **API Limitations**: Extension currently uses page scraping. For advanced features, consider using official Twitch APIs.
- **DOM Selectors**: CSS selectors might change if Twitch updates their UI
- **Rate Limiting**: Extension uses conservative intervals to avoid issues
- **Twitch Account**: You must be logged into Twitch for drops to be tracked

## 🐛 Troubleshooting

### No games appear in dropdown

1. Make sure you're on https://www.twitch.tv/drops/campaigns
2. Reload the page
3. Reopen extension popup

### Progress doesn't update

1. Verify Twitch tab is still open
2. Check you're logged into Twitch
3. Try restarting farming

### Extension doesn't load

1. Run: `npm run build`
2. Check `dist/` folder exists
3. Verify icons are in `public/icons/`
4. Check Chrome console: `chrome://extensions/` → Details → Errors

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

## 📝 License

Educational purposes only. Twitch and the Twitch logo are registered trademarks of Twitch Interactive, Inc.

---

**Made with ❤️ for the Twitch community**
