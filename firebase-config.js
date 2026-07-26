// ============================================================
// Firebase-Konfiguration
// ------------------------------------------------------------
// Trage hier die Konfiguration deines eigenen Firebase-Projekts ein.
// Du findest sie in der Firebase Console unter:
// Projekteinstellungen -> "Meine Apps" -> Web-App -> SDK-Konfiguration
//
// Diese Werte sind KEINE Geheimnisse (sie landen ohnehin im Browser),
// die eigentliche Absicherung passiert über die Firestore Security Rules
// (siehe firestore.rules) und die Firebase Authentication.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBRDNFRHAlkj0SP8DTz2AGeP4ZKTsZUH4g",
  authDomain: "together-2bd31.firebaseapp.com",
  projectId: "together-2bd31",
  storageBucket: "together-2bd31.firebasestorage.app",
  messagingSenderId: "418864552422",
  appId: "1:418864552422:web:249e0e1ce02feb67ce5e27"
};

// Trage hier die zwei E-Mail-Adressen ein, die sich anmelden dürfen.
// Muss exakt mit den Firestore Rules (firestore.rules) übereinstimmen.
// WICHTIG: Trage hier eure beiden echten Login-E-Mails ein (die Adressen,
// die ihr unter Authentication -> Users manuell angelegt habt).
export const ALLOWED_EMAILS = [
  "marcokkirchi@web.de",
  "sylvia.rondak@web.de"
];

// Feste, freundliche Anzeigenamen für die beiden Accounts (optional).
export const DISPLAY_NAMES = {
  "marcokkirchi@web.de": "Marco",
  "sylvia.rondak@web.de": "Sylvia"
};
