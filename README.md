# Notebook — personal knowledge hub

A personal publishing and knowledge platform built with React, TypeScript, Vite, Firebase, and Framer Motion. The responsive homepage includes a featured story, pinned project carousel, learning series, videos, notes, and an activity graph. The visual system supports light and dark themes with blue, navy, violet, and cyan accents.

## Run locally

- Install Node.js 20+.
- Run `npm install`.
- Copy `.env.example` to `.env.local` and fill in your Firebase web app settings.
- Run `npm run dev` and open the Vite URL shown in the terminal.
- Run `npm run build` to create the production bundle in `dist/`.

The `.env.local` file is ignored by Git. Firebase web API keys identify the project; access is controlled by Authentication and Security Rules. Never put a Firebase Admin service-account key in the browser or commit it.

## Firebase setup

1. Enable **Authentication → Email/Password** and create your administrator account.
2. Create the Cloud Firestore database and enable Firebase Storage if image uploads are needed.
3. Grant the administrator account the custom claim `admin: true` from a trusted environment using Firebase Admin SDK. Sign out and back in after the claim is assigned.
4. From the project directory, deploy the rules with `firebase deploy --only firestore:rules,storage`. Check the Firebase CLI output to confirm both services succeeded.
5. Build and deploy the site with `npm run build` and `firebase deploy --only hosting`.

Public clients subscribe in real time to published content in `posts`, `videos`, `projects`, `notes`, and enabled `sections`. The global search searches loaded published articles, videos, projects, and notes, including article body text. Admin access and draft reads require Authentication plus the `admin` custom claim. The pin registry is admin-readable only; project writes validate the maximum of three pinned projects. Storage uploads require an admin claim and are limited to PNG, JPEG, WebP, or GIF files up to 10 MB.

## Environment variables

Set these values in `.env.local`:

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
```

Restart the Vite server after changing environment variables. The app uses local demo data when Firebase is not configured. Demo content is not copied into Firestore automatically.

## Firebase Admin claim example

Run this only in a trusted environment with Firebase Admin SDK and credentials configured outside the frontend project:

```ts
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

initializeApp({ credential: applicationDefault(), projectId: 'notebook-personal-17' });
const auth = getAuth();
const user = await auth.getUserByEmail('YOUR_ADMIN_EMAIL');
await auth.setCustomUserClaims(user.uid, { admin: true });
```

## Key files

- `src/App.tsx` — pages, navigation, search, and CMS.
- `src/firebase-services.ts` — typed Firestore listeners, writes, pin transactions, and media uploads.
- `src/firebase.ts` — Firebase initialization.
- `src/styles.css` and `src/design-system.css` — responsive layout, themes, and design tokens.
- `firestore.rules` and `storage.rules` — deployed access controls.
