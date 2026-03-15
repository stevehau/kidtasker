// ============================================================
// Firebase Configuration
// ============================================================
// To set up your own Firebase project:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project (e.g., "family-checklist")
// 3. Add a Web app in Project Settings
// 4. Copy the config object here
// 5. Enable Authentication > Email/Password in the Firebase console
// 6. Create a Firestore database (start in test mode, then add rules)
//
// For demo/local testing, set USE_LOCAL_STORAGE = true below.
// ============================================================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDd5RIm8zmS8yOxOz4eTE9kLQ9V0TYZ6oo",
  authDomain: "kidtasker-d937a.firebaseapp.com",
  projectId: "kidtasker-d937a",
  storageBucket: "kidtasker-d937a.firebasestorage.app",
  messagingSenderId: "1063131733945",
  appId: "1:1063131733945:web:3aeef184b8f921b77aa068"
};

// Set to false to use Firebase, true for localStorage demo mode
const USE_LOCAL_STORAGE = false;

// App configuration
const APP_CONFIG = {
  maxItemsPerDay: 10,
  blankRowsPerDay: 3,
  defaultCategories: [
    'Cleaning', 'School Prep', 'Personal Hygiene', 'Homework',
    'Chores', 'Health', 'Athletics', 'Social', 'Other'
  ],
  priorities: ['A', 'B', 'C'],
  daysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  daysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  weekStartOptions: ['monday', 'sunday'],
  defaultWeekStart: 'monday',
  defaultTasks: [
    { text: 'Wake up on time', category: 'Personal Hygiene', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri'] },
    { text: 'Pack school bag', category: 'School Prep', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri'] },
    { text: 'Help set or clear the dinner table', category: 'Chores', priority: 'B', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
    { text: 'Clean your room', category: 'Cleaning', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
    { text: 'Tidy the bathroom', category: 'Cleaning', priority: 'B', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
    { text: 'Read or practice math', category: 'Homework', priority: 'B', daysApplicable: ['Sat','Sun'] },
    { text: 'Play well with siblings', category: 'Social', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] }
  ]
};

// Helper function to get ordered days based on week start preference
function getOrderedDays(weekStart) {
  const fullDays = APP_CONFIG.daysOfWeek;
  const shortDays = APP_CONFIG.daysShort;
  
  if (weekStart === 'sunday') {
    // Rotate Sunday to the front
    return {
      daysOfWeek: [fullDays[6], fullDays[0], fullDays[1], fullDays[2], fullDays[3], fullDays[4], fullDays[5]],
      daysShort: [shortDays[6], shortDays[0], shortDays[1], shortDays[2], shortDays[3], shortDays[4], shortDays[5]]
    };
  } else {
    // Keep Monday first (default)
    return {
      daysOfWeek: fullDays,
      daysShort: shortDays
    };
  }
}
