# Sports Betting Edge - Mobile App Prototype

## Overview

This is a **fully functional UI prototype** of the Sports Betting Edge detection system for iOS & Android. All UI screens are built and animated, with mock data to test flows and design without backend integration.

## ✅ What's Included

### Screens
1. **Live Edges** (Home) - Real-time edge detection feed sorted by edge %
2. **Edge Detail** - Line comparison view + bet logger
3. **My Bets** - Log and track bets with result entry
4. **Bankroll** - P&L tracking, statistics, transaction history
5. **Settings** - Configure Kelly fraction, edge thresholds, notifications

### Features
- 🎨 Smooth animations with Reanimated 4 + Moti
- 🌗 Dark theme optimized for mobile viewing
- 📊 Real-time edge updates (mocked)
- 💰 Bankroll tracker with P&L calculations
- ⚙️ Configurable settings (Kelly, edge threshold)
- 📱 Bottom tab navigation
- 🔄 Pull-to-refresh functionality
- ✨ Glassmorphism + modern UI

## Getting Started

### Prerequisites
- Node.js 18+ installed
- npm or yarn
- Expo CLI: `npm install -g expo-cli`

### Installation

```bash
cd sports-betting-edge
npm install
```

### Running the App

**On mobile device (iOS/Android):**
```bash
npm start
```
Then scan the QR code with Expo Go app.

**On Android Emulator:**
```bash
npm run android
```

**On iOS Simulator (Mac only):**
```bash
npm run ios
```

**On Web Browser (for quick testing):**
```bash
npm run web
```

## 🎮 How to Test

### Live Edges Screen
- Tap any edge card to view details
- Swipe down to refresh
- Edges are sorted by edge % (highest first)

### Edge Detail Screen
- See line comparison (sharp vs local books)
- Enter a wager amount
- Tap "LOG BET" to add to your bets

### My Bets Screen
- Tap an unresolved bet to mark result (Win/Loss/Push)
- Resolved bets show P&L
- See full history

### Bankroll Screen
- View total P&L and ROI
- See win/loss/push breakdown
- Transaction history with timestamps

### Settings
- Adjust Kelly fraction (10%-33%)
- Set minimum edge threshold (1%-3%)
- Toggle notifications

## 📁 Project Structure

```
sports-betting-edge/
├── app/                          # Expo Router app directory
│   ├── _layout.tsx              # Root layout
│   ├── edge-detail.tsx          # Edge detail modal
│   └── (tabs)/                  # Bottom tab navigation
│       ├── _layout.tsx
│       ├── index.tsx            # Live edges
│       ├── bets.tsx             # My bets
│       ├── bankroll.tsx         # Bankroll tracker
│       └── settings.tsx         # Settings
├── components/                   # Reusable UI components
│   ├── EdgeCard.tsx             # Edge list item
│   ├── LineComparison.tsx       # Line comparison view
│   └── BankrollCard.tsx         # Bankroll summary
├── store/
│   └── bettingStore.ts          # Zustand state + mock data
├── types/
│   └── index.ts                 # TypeScript interfaces
├── tailwind.config.js           # Tailwind CSS config
├── package.json
└── app.json                     # Expo config
```

## 🎨 Design System

### Colors
- **Primary**: #1e3a8a (Dark Blue)
- **Secondary**: #fbbf24 (Amber)
- **Success**: #10b981 (Green)
- **Danger**: #ef4444 (Red)
- **Background**: #0f172a (Almost Black)

### Typography
- **Body**: React Native default
- **Bold**: font-bold
- **Sizes**: Text scaling based on system preferences

### Animations
- **Entry**: Fade + Translate (300ms)
- **Spring**: Reanimated spring (bankroll card)
- **List Stagger**: 50ms delay per item

## 🔄 Mock Data

All data comes from `store/bettingStore.ts`:

- **4 Mock Edges** - Different sports and edge percentages
- **3 Mock Bets** - Examples of Won/Lost/Unresolved
- **1 Mock Bankroll History** - Transaction tracking
- **Default Settings** - 25% Kelly, 2% edge threshold

You can modify mock data in the store for testing edge cases.

## 🚀 Next Steps (Phase 2)

When ready to integrate backend:

1. Replace mock data in `bettingStore.ts` with API calls
2. Add Supabase realtime subscriptions for live edges
3. Hook edge detection to The Odds API
4. Implement push notifications with Firebase FCM
5. Add Supabase authentication

## 📝 Notes

- **No Backend**: This is a frontend-only prototype
- **No Real APIs**: All data is mocked
- **TypeScript**: Fully typed for production-ready code
- **Responsive**: Works on all phone sizes
- **Dark Mode**: Optimized for low-light betting environment

## 🆘 Troubleshooting

### App won't start
```bash
npm install
npx expo start --clear
```

### Tailwind not working
Make sure NativeWind is installed:
```bash
npm install nativewind
```

### Icons not showing
Icons come from Expo Symbols. Ensure `expo-symbols` is installed.

## 📞 Support

For issues with:
- **Expo**: https://docs.expo.dev
- **NativeWind**: https://www.nativewind.dev
- **Zustand**: https://github.com/pmndrs/zustand
- **Reanimated**: https://docs.swmansion.com/react-native-reanimated/

---

**Ready for Phase 2 backend integration when you give the go-ahead!** ✅
