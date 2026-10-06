const firebaseConfig = {
  apiKey: "AIzaSyCZNdm9Ostpi80En26IMSVEOTkBoAEuAL0",
  authDomain: "peace-mindset-school.firebaseapp.com",
  databaseURL: "https://peace-mindset-school-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "peace-mindset-school",
  storageBucket: "peace-mindset-school.firebasestorage.app",
  messagingSenderId: "455475709363",
  appId: "1:455475709363:web:68abf1aa2d04bf4890f7c6"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

const firebaseAuth = firebase.auth();
