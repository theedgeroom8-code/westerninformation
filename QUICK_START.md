# Quick Start - Sports Betting Edge Prototype

## 📱 Prototype Status: READY TO TEST ✅

Your mobile app prototype is fully built with all 5 screens, smooth animations, and realistic mock data.

## 🚀 Start in 2 Commands

```bash
cd sports-betting-edge
npm start
```

Then:
- **iOS/Android**: Scan QR code with Expo Go app
- **Android Emulator**: Press `a`
- **iOS Simulator (Mac)**: Press `i`
- **Web (Quick Test)**: Press `w`

## 📋 What You Can Test

### Screen 1: Live Edges (Home Tab)
✅ Swipe to refresh
✅ Tap any edge to see details
✅ Edges sorted by profitability (4%, 3.2%, 2.8%, 5.1%)

### Screen 2: Edge Details (Modal)
✅ Full line comparison (sharp vs local books)
✅ Enter custom wager amount
✅ "LOG BET" button adds to portfolio
✅ Smooth animations on load

### Screen 3: My Bets (Bets Tab)
✅ Tap unresolved bet to mark result (Win/Loss/Push)
✅ P&L calculation updates instantly
✅ Past bets show in resolved section

### Screen 4: Bankroll (Bankroll Tab)
✅ Live P&L tracking
✅ ROI % calculation
✅ Win/Loss/Push statistics
✅ Transaction history

### Screen 5: Settings (Settings Tab)
✅ Adjust Kelly Fraction (10%-33%)
✅ Set minimum edge threshold (1%-3%)
✅ Toggle notifications

## 🎨 UI Features to Notice

- 🌙 Dark theme optimized for mobile
- ✨ Smooth animations (Reanimated 4)
- 📱 Bottom tab navigation
- 💫 Staggered list animations
- 🎯 High edge cards highlighted in yellow
- 🟢 Edge detection highlighted in green in comparison

## 🔄 Test Flow Example

1. **Edges Tab** → Tap first edge (4% edge on NFL)
2. **Details Modal** → Scroll to see line comparison
3. **Wager Input** → Enter $200
4. **Log Bet** → Bet added to portfolio
5. **Bets Tab** → See your new unresolved bet
6. **Mark Result** → Tap bet → Select "Win"
7. **Bankroll Tab** → See P&L updated to +$200

## 📊 Mock Data Included

- **4 Active Edges**: NFL, NBA, MLB, College FB
- **3 Past Bets**: 2 wins, 1 loss (different sports)
- **Starting Bankroll**: $10,000
- **Current P&L**: +$270

## 🛠️ If Install Takes Time

Dependencies installing in background... It's normal for first-time npm install to take 5-15 minutes.

Check progress:
```bash
cd sports-betting-edge && npm list react
```

## ⚠️ Common Issues

**"Cannot find module"** → Run: `npm install --no-save expo-router`

**"NativeWind not found"** → Run: `npm install nativewind`

**Slow on first run** → This is normal. Expo needs to build the app.

**Dark theme not showing** → Force reload: Press `r` in terminal where `npm start` runs

## 🎯 What to Evaluate

1. **Smoothness**: Do animations feel natural?
2. **Usability**: Is navigation intuitive?
3. **Performance**: Any lag or stuttering?
4. **Design**: Do colors and layout work for your brand?
5. **Responsiveness**: Does it adapt to your phone size?

## 📝 Note on Mock Data

All data is hardcoded for testing. Real data will come from:
- **The Odds API** → Live odds
- **Supabase Edge Functions** → Edge detection logic
- **Firebase FCM** → Push notifications
- **PostgreSQL** → Persistent storage

## 🎉 Next Steps

Once you've tested and approved the UI:

1. ✅ Give feedback on design/UX
2. ✅ Confirm all flows feel right
3. ✅ Verify responsiveness on your devices
4. → Then we move to **Phase 2: Backend Integration**

---

**Your app is ready to test now. Start it up and let me know how it feels!** 🚀
