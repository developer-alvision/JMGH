/*
 * FIREBASE CONNECTION — fill this in before deploying.
 *
 * This is the only place the hospital's Firebase project is named. Every
 * screen, the patient portal and the waiting-room display all read from
 * here, so there is one value to set and nothing to miss.
 *
 * Where to find these values:
 *   Firebase Console -> Project settings -> General
 *   -> Your apps -> Web app -> SDK setup and configuration -> Config
 *
 * Copy the six values across exactly as shown there.
 *
 * These keys are safe to publish. A Firebase web config is public by
 * design; access is controlled by Firestore Security Rules, not by
 * keeping this file secret.
 *
 * Leave this file untouched for local development: on localhost the app
 * ignores it and uses the Firebase emulators instead.
 */
window.FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCg4aGK9iyawXRj4UFwjyED-uCb6_vV-_A',
    authDomain: 'jmgh-9dbf9.firebaseapp.com',
    projectId: 'jmgh-9dbf9',
    storageBucket: 'jmgh-9dbf9.firebasestorage.app',
    messagingSenderId: '800704990080',
    appId: '1:800704990080:web:30cc50b9e0a6cff8068f65',
    measurementId: 'G-PFTT5X7DKS'
};

/* Cloud Functions region. Change only if you deploy functions elsewhere. */
window.FIREBASE_REGION = 'asia-south1';
