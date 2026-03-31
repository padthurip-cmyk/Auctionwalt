# Auction Vault 🔱

A mobile-first PWA for auction resellers to track inventory from purchase to profit — powered by Claude AI.

## Features

- **📄 AI Invoice Parsing** — Upload any auction invoice (PDF/photo), Claude extracts all items, prices, and fees automatically
- **📦 Inventory Management** — Full cost breakdown per item (hammer + premium + tax = total cost)
- **📸 Product Photos** — Attach images to inventory items
- **💰 Sales Tracking** — Record sales with customer info, platform, and automatic profit calculation
- **🧾 AI Receipt Generation** — Claude creates professional printable receipts
- **📧 Multi-channel Sharing** — Email (Gmail), WhatsApp, SMS, print PDF, copy text
- **🔄 Lifecycle Tracker** — Full audit trail from purchase to sale
- **📊 Analytics** — ROI, spending by auction house, revenue tracking
- **👁 Original Invoice Viewing** — Original PDFs/photos stored permanently in IndexedDB
- **📱 Mobile PWA** — Install to homescreen, works offline, native app feel

## Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/auction-vault.git
cd auction-vault

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open `http://localhost:5173` on your phone or browser.

## Deploy to Netlify

### Option 1: Netlify CLI
```bash
npm run build
npx netlify deploy --prod --dir=dist
```

### Option 2: GitHub + Netlify (Recommended)
1. Push this repo to GitHub
2. Go to [app.netlify.com](https://app.netlify.com)
3. Click **"Add new site"** → **"Import an existing project"**
4. Select your GitHub repo
5. Build settings are auto-detected from `netlify.toml`
6. Click **Deploy**

Every push to `main` will auto-deploy.

## Install as Mobile App

After deploying to Netlify:

### iOS (Safari)
1. Open your Netlify URL in Safari
2. Tap the **Share** button (box with arrow)
3. Tap **"Add to Home Screen"**
4. Tap **"Add"**

### Android (Chrome)
1. Open your Netlify URL in Chrome
2. Tap the **⋮** menu
3. Tap **"Install app"** or **"Add to Home Screen"**

The app will look and feel like a native mobile app — full screen, no browser bar, with proper safe area handling for notched phones.

## Data Storage

All data is stored locally in **IndexedDB** on your device:
- Invoice data, items, sold items, customer records
- **Original invoice files** (PDF/images) — viewable anytime
- Product photos
- Business settings

Data persists across sessions and browser restarts. No server-side storage needed.

## API Costs

The app uses Claude Sonnet 4 API (~$3/1M input, $15/1M output tokens):
- **Invoice parsing**: ~$0.03 per invoice
- **Receipt generation**: ~$0.02 per receipt
- **100 invoices/month**: ~$3-6 total

## Tech Stack

- **React 18** + Vite
- **IndexedDB** (via `idb` library) for persistent storage
- **Claude API** for invoice parsing & receipt generation
- **Gmail MCP** for email sending
- **Vite PWA Plugin** for service worker + manifest
- **CSS Variables** for theming

## Project Structure

```
auction-vault/
├── public/
│   ├── favicon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   └── apple-touch-icon.png
├── src/
│   ├── components/
│   ├── utils/
│   │   ├── api.js          # Claude API functions
│   │   ├── db.js           # IndexedDB storage
│   │   └── helpers.js      # Utility functions
│   ├── styles/
│   │   └── global.css      # Mobile-first CSS
│   ├── App.jsx             # Main app component
│   └── main.jsx            # Entry point
├── index.html
├── vite.config.js
├── netlify.toml
└── package.json
```
