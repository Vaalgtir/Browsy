# Phase 0 : prototype de validation Electron

Environnement : Electron 45.4.1 (Chromium 156), `electron-chrome-extensions` 4.10, `electron-chrome-web-store` 0.13.

Lancement : `npm run dev`. Pour les tests automatisés, `BROWSY_USER_DATA=<dossier>` isole le profil. Pour charger en lecture seule les extensions installées dans Arc : `npm run dev:arc`.

## Résultats automatiques (22/11/2026)

| Point testé | Résultat |
|---|---|
| Chargement des 10 extensions Arc | ✅ toutes chargées, icônes affichées dans la sidebar |
| AdGuard, LastPass (service worker MV3) | ✅ après le correctif `browser` → `chrome` ([src/preload/compat.ts](src/preload/compat.ts)) |
| Nabla, Wappalyzer, Redux DevTools, Volume Master, Remove YouTube Shorts, LocatorJS | ✅ service workers démarrés sans erreur |
| uBlock Origin, Cypress Recorder (MV2) | ✅ chargées (avertissement de dépréciation MV2) |
| Codecs H.264 / AAC / HEVC | ✅ supportés |
| User-agent et Client Hints | ✅ identiques à Google Chrome 156 ([src/main/chromeIdentity.ts](src/main/chromeIdentity.ts)) |
| « Continuer avec Google » (Pinterest) | ✅ après désactivation de FedCM, que Electron expose sans le sélecteur de compte (même choix que Brave) |
| Connexion Google | ✅ plus de rejet « navigateur non sécurisé » (test avec une adresse inexistante, même résultat que Brave) |
| YouTube, page de connexion Google | ✅ s'affichent |

## Décision (22/11/2026)

**Go Electron.** Vidéo YouTube, extensions (ajout, suppression, popups), DevTools et connexion Google validés à la main. On passe à la phase 1.

## À vérifier à la main

Lancer avec `npm run dev:arc`.

**Extensions**
- [x] Popups des icônes (LastPass, uBlock, AdGuard, Wappalyzer)
- [ ] Remplissage automatique LastPass
- [ ] Blocage des pubs (uBlock / AdGuard)
- [x] Installation et suppression d'une extension depuis chromewebstore.google.com
- [ ] Menu clic droit des extensions (LastPass, AdGuard)

**Dev**
- [x] DevTools (⌥⌘I) qui s'ouvrent et restent ouverts sans perdre l'identité Chrome
- [–] Redux DevTools, LocatorJS : plus utilisées, non testées
- [ ] Serveur de dev sur `localhost` avec rechargement à chaud (HMR / WebSocket) — à voir à l'usage

**Comptes et sécurité**
- [x] Connexion Google (Pinterest connecté via Google)
- [ ] Passkeys / Touch ID (risque : `isUserVerifyingPlatformAuthenticatorAvailable` répond `false`)
- [ ] « Se connecter avec GitHub / Apple / Microsoft » sur un site tiers

**Usage quotidien**
- [x] YouTube
- [ ] Vidéo sur X / Twitch
- [ ] Netflix / Spotify web (KO attendu : pas de DRM Widevine)
- [ ] Google Meet : caméra, micro, partage d'écran
- [ ] Téléchargement et envoi de fichiers
- [ ] Lecture d'un PDF
- [ ] Notifications d'un site (Gmail, Slack web)
- [ ] Google Docs / Figma (apps lourdes, copier-coller)

## À traiter en phase 1
- Electron accorde toutes les permissions par défaut (notifications, caméra…) : ajouter un gestionnaire de permissions avec demande à l'utilisateur.
