# JARVIS — Just A Rather Very Intelligent System

Futuristic AI personal assistant Android application (Vite + Capacitor). Features a high-performance animated circular HUD visualizer, real voice interaction (Speech Recognition & Text-to-Speech), executive tool suites (Create, Search, Analyze, Automate, System Control), and live multi-provider AI chat with automatic failover between Render and Vercel backends.

## Key Features

1. **Futuristic Circular HUD Visualizer**
   - High-performance canvas-based multi-ring visualizer reacting to live system states: `IDLE`, `LISTENING`, `THINKING`, `SPEAKING`, `PROCESSING`, and `ERROR`.
   - Real microphone energy visualization during voice input and rhythmic frequency animations during speech output.

2. **Full Voice Interaction Engine**
   - Android-compatible speech recognition (`webkitSpeechRecognition` / native bridge).
   - Text-to-Speech response playback with voice selection, speed rate adjustments, and speech interruption.
   - Synthesized Web Audio sci-fi chimes and tactile feedback.

3. **Discreet Settings & Profile Access**
   - Main interface hides configuration buttons to keep a clean, immersion-focused HUD.
   - Settings are accessed through the profile avatar in the upper right.
   - Seven structured configuration panels: AI Providers, Voice & Speech, Connected Services, Device Permissions, Appearance & Theme Accents, Privacy & Storage, and Advanced Backend Setup.

4. **Streamlined 4-Tab Bottom Navigation**
   - **Home:** Central control dashboard with personalized greeting, live visualizer, prominent voice mic, and 6 action tiles.
   - **Commands:** Quick-action voice command launcher for system, productivity, and intelligence requests.
   - **Chat:** Comprehensive AI conversation workspace with markdown rendering, code formatting, image zoom, audio player, task execution details, and file attachments.
   - **Files:** Personal Vault for generated drafts, notes, and file analysis reports with copy, export, and delete capabilities.

5. **Home Feature Modules**
   - **Live Chat:** Real-time conversation with failover backend communication.
   - **System Control:** Safe app launcher for Google Maps, Google Calendar, Gmail, and Clock.
   - **Create:** Structured drafting studio for emails, executive summaries, meeting notes, and brainstorms.
   - **Search:** Dedicated intelligence search with query history.
   - **Analyze:** Document and image inspection (OCR, scene analysis, summarization).
   - **Automate:** Digital HUD clock, stopwatch with lap tracking, countdown timer with audio chime, and local reminders.

6. **Automatic Backend Failover**
   - Primary URL: Render (`https://jarvis-ukcy.onrender.com`)
   - Backup URL: Vercel (`https://jarviss-eight.vercel.app`)
   - Auto-races `/health` endpoints and seamlessly fails over upon connection interruptions.

## Build the APK with GitHub Actions (no Android Studio needed)
1. Push this repository to GitHub.
2. In the **Actions** tab, open the latest "Build APK" run.
3. Download the `jarvis-debug-apk` artifact, unzip, and install `app-debug.apk` on your Android device.

## Build Locally
```bash
npm install
npm run build
npx cap add android
npx cap sync
cd android && ./gradlew assembleDebug
```
Output APK: `android/app/build/outputs/apk/debug/app-debug.apk`

## External Integrations Status
- **LLM Providers:** Dynamic inspection via `/health` reports configured providers on the active server (Groq, Gemini, Mistral, OpenRouter, OpenAI). Unconfigured providers display honest status tags.
- **Google Calendar & Gmail:** Displayed with honest integration notice requiring server-side Google Workspace OAuth routes before displaying private user account data.
- **Location:** Uses device `navigator.geolocation` for real coordinate queries and Google Maps navigation.
