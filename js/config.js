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
    'Cleaning', 'School Prep', 'Maturity', 'Homework',
    'Chores', 'Health', 'Screen Time', 'Athletics', 'Social', 'Other'
  ],
  priorities: ['A', 'B', 'C'],
  daysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  daysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  weekStartOptions: ['monday', 'sunday'],
  defaultWeekStart: 'monday',
  // Age-grouped default tasks (selected based on child's age at creation)
  defaultTasksByAge: {
    // Ages 4-6: Simple habits, routine-building, gentle responsibilities
    young: {
      label: 'Ages 4\u20136',
      maxAge: 6,
      tasks: [
        { text: 'Brush teeth (morning & night)', category: 'Health', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        { text: 'Put dirty clothes in hamper', category: 'Cleaning', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        { text: 'Put away toys before bed', category: 'Cleaning', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        { text: 'Use good manners at meals', category: 'Maturity', priority: 'B', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        { text: 'Get dressed by yourself', category: 'Maturity', priority: 'B', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        { text: 'Read or be read to (15 min)', category: 'Homework', priority: 'B', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        { text: 'Screen time under 1 hour', category: 'Screen Time', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
      ]
    },
    // Ages 7-11: School-age independence, chores, academic habits
    middle: {
      label: 'Ages 7\u201311',
      maxAge: 11,
      tasks: [
        { text: 'Wake up on time', category: 'Maturity', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri'] },
        { text: 'Pack school bag', category: 'School Prep', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri'] },
        { text: 'Clean your room', category: 'Cleaning', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        { text: 'Help set or clear the dinner table', category: 'Chores', priority: 'B', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        { text: 'Read or practice math (20 min)', category: 'Homework', priority: 'B', daysApplicable: ['Mon','Tue','Wed','Thu','Fri'] },
        { text: 'Be kind to siblings', category: 'Social', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        { text: 'Screen time under 2 hours', category: 'Screen Time', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
      ]
    },
    // Ages 12+: Teen responsibilities, self-management, household contribution
    teen: {
      label: 'Ages 12+',
      maxAge: 99,
      tasks: [
        { text: 'Wake up on time (no reminders)', category: 'Maturity', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri'] },
        { text: 'Complete homework before screens', category: 'Homework', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri'] },
        { text: 'Keep room and bathroom clean', category: 'Cleaning', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        { text: 'Help with a household chore', category: 'Chores', priority: 'B', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        { text: 'Exercise or practice a sport (30 min)', category: 'Athletics', priority: 'B', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        { text: 'No phone at the dinner table', category: 'Maturity', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
        { text: 'Screen time under 2 hours', category: 'Screen Time', priority: 'A', daysApplicable: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
      ]
    }
  },
  // Fallback for any code that still references the flat list
  get defaultTasks() {
    return this.defaultTasksByAge.middle.tasks;
  }
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
