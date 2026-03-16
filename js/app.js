// ============================================================
// Main Application - Routing, Auth State, Initialization
// ============================================================

const App = (() => {
  let currentFamily = null;
  let isInitialized = false;

  // Timeout wrapper to prevent Firestore queries from hanging forever
  function withTimeout(promise, ms = 10000, label = 'Operation') {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms/1000}s. Check your internet connection and Firestore rules.`)), ms))
    ]);
  }

  function showNavbar(show) {
    const nav = document.getElementById('navbar');
    nav.classList.toggle('hidden', !show);
  }

  function setActiveNav(route) {
    let navRoute = route;
    if (route === 'scanner') navRoute = 'submit';
    if (route === 'admin' || route === 'children' || route === 'checklist') navRoute = 'settings';
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.route === navRoute);
    });
  }

  async function onAuthStateChanged(user) {
    if (user) {
      showNavbar(true);
      document.getElementById('nav-username').textContent = user.displayName || user.email;

      // Load family
      try {
        currentFamily = await withTimeout(Store.getFamily(user.uid), 10000, 'Loading family data');
      } catch (err) {
        console.error('Failed to load family:', err);
        // Show error to user instead of hanging
        const main = document.getElementById('main-content');
        if (main) main.innerHTML = `<div style="padding:40px;text-align:center">
          <h2>Connection Error</h2>
          <p style="color:#666;max-width:500px;margin:12px auto">${err.message}</p>
          <p style="color:#999;font-size:0.85rem;max-width:500px;margin:8px auto">Make sure your Firestore security rules are published in the Firebase Console. The rules should allow read/write for authenticated users.</p>
          <button onclick="location.reload()" style="margin-top:12px;padding:8px 20px;cursor:pointer;border-radius:6px;border:1px solid #ccc;background:#f5f5f5">Retry</button>
        </div>`;
        showNavbar(false);
        return;
      }

      if (!currentFamily) {
        showNavbar(false);
        Views.renderFamilySetup();
        return;
      }

      // Show email verification banner if needed (Firebase mode only)
      if (!USE_LOCAL_STORAGE && user.emailVerified === false) {
        const existing = document.getElementById('verify-banner');
        if (!existing) {
          const banner = document.createElement('div');
          banner.id = 'verify-banner';
          banner.style.cssText = 'background:#fff3cd;color:#856404;padding:10px 16px;text-align:center;font-size:0.85rem;border-bottom:1px solid #ffc107';
          banner.innerHTML = 'Please verify your email address. Check your inbox for a verification link. <button id="btn-resend-verify" style="background:none;border:none;color:#0056b3;text-decoration:underline;cursor:pointer;font-size:0.85rem">Resend</button>';
          document.body.insertBefore(banner, document.body.firstChild);
          banner.querySelector('#btn-resend-verify').addEventListener('click', async () => {
            try { await Store.resendVerification(); alert('Verification email sent!'); } catch (e) { alert(e.message); }
          });
        }
      }

      // Route to current hash or dashboard (first-time users go to help)
      if (!isInitialized) {
        isInitialized = true;
        const hash = window.location.hash || '#/dashboard';
        if (hash === '#/login' || hash === '#/register' || hash === '#/reset-password' || hash === '') {
          // Check if this is a first-time user (never seen help page)
          const hasSeenHelp = localStorage.getItem('fc_has_seen_help');
          if (!hasSeenHelp) {
            localStorage.setItem('fc_has_seen_help', '1');
            window.location.hash = '#/help';
          } else {
            window.location.hash = '#/dashboard';
          }
        } else {
          navigate(hash);
        }
      } else {
        navigate(window.location.hash || '#/dashboard');
      }
    } else {
      showNavbar(false);
      currentFamily = null;
      isInitialized = false;
      // Check if user is on an invite URL before defaulting to login
      const hash = window.location.hash || '';
      const inviteMatch = hash.match(/^#\/invite\/(.+)$/);
      if (inviteMatch) {
        Views.renderInviteAccept(inviteMatch[1]);
      } else {
        Views.renderLogin();
      }
    }
  }

  async function navigate(hash) {
    const parts = hash.replace('#/', '').split('/');
    const route = parts[0] || 'dashboard';
    const param = parts[1] || null;

    // Clear splash background when leaving login
    const mainEl = document.getElementById('main-content');
    if (mainEl) {
      mainEl.style.backgroundImage = '';
      mainEl.style.backgroundSize = '';
      mainEl.style.backgroundPosition = '';
      mainEl.style.backgroundAttachment = '';
    }

    // Clean up landscape worksheet mode when navigating away
    document.body.classList.remove('ws-landscape-active');
    const exitBtn = document.querySelector('.ws-landscape-exit-btn');
    if (exitBtn) exitBtn.remove();
    if (window._wsOrientHandler) {
      window.removeEventListener('resize', window._wsOrientHandler);
      window._wsOrientHandler = null;
    }

    // Invite route works for both logged-in and not-logged-in users
    if (route === 'invite' && param) {
      showNavbar(false);
      return Views.renderInviteAccept(param);
    }

    // Public routes
    if (!Store.getCurrentUser()) {
      if (route === 'register') return Views.renderRegister();
      if (route === 'reset-password') return Views.renderResetPassword();
      return Views.renderLogin();
    }

    // Need family setup
    if (!currentFamily && route !== 'login' && route !== 'register') {
      try {
        currentFamily = await withTimeout(Store.getFamily(Store.getCurrentUser().uid), 10000, 'Loading family');
      } catch (err) {
        console.error('Failed to load family in navigate:', err);
        const main = document.getElementById('main-content');
        if (main) main.innerHTML = `<div style="padding:40px;text-align:center"><h2>Connection Error</h2><p style="color:#666">${err.message}</p><button onclick="location.reload()" style="margin-top:12px;padding:8px 20px;cursor:pointer">Retry</button></div>`;
        return;
      }
      if (!currentFamily) {
        showNavbar(false);
        return Views.renderFamilySetup();
      }
    }

    showNavbar(true);
    setActiveNav(route);

    switch (route) {
      case 'dashboard':
        await Views.renderDashboard(currentFamily);
        break;
      case 'children':
        await Views.renderChildren(currentFamily);
        break;
      case 'checklist':
        if (param) await Views.renderChecklist(currentFamily, param);
        else window.location.hash = '#/dashboard';
        break;
      case 'worksheet':
        if (param) await Views.renderWorksheet(currentFamily, param);
        else window.location.hash = '#/dashboard';
        break;
      case 'draft':
        if (param) await Views.renderDraftEditor(currentFamily, param);
        else window.location.hash = '#/dashboard';
        break;
      case 'results':
        if (param) await Views.renderResultsEntry(param);
        else window.location.hash = '#/dashboard';
        break;
      case 'scanner':
      case 'submit':
        Views.renderScanner(currentFamily);
        break;
      case 'analytics':
        await Views.renderAnalytics(currentFamily, param);
        break;
      case 'settings':
      case 'admin':
        await Views.renderSettings(currentFamily);
        break;
      case 'children':
        await Views.renderChildren(currentFamily);
        break;
      case 'help':
        Views.renderHelp();
        break;
      default:
        window.location.hash = '#/dashboard';
    }
  }

  // Global helpers accessible from onclick handlers in HTML
  async function printWorksheet(worksheetId) {
    const ws = await Store.getWorksheet(worksheetId);
    if (!ws) return;

    // Fetch previous reviewed worksheet for gamification stats
    let lastWs = null;
    try {
      lastWs = await Store.getPreviousReviewedWorksheet(ws.familyId, ws.childId, ws.id);
    } catch (e) { /* no previous worksheet */ }

    // Build weekly history for the year (52-54 weeks)
    let weeklyHistory = [];
    try {
      const allWs = await Store.getWorksheets(ws.familyId, ws.childId, ws.year);
      // Determine how many weeks in this year (ISO weeks: 52 or 53)
      const jan1 = new Date(ws.year, 0, 1);
      const dec31 = new Date(ws.year, 11, 31);
      const totalWeeks = getISOWeeksInYear(ws.year);
      for (let w = 1; w <= totalWeeks; w++) {
        const weekWs = allWs.find(x => x.weekNumber === w && (x.status === 'reviewed' || x.status === 'scanned'));
        if (weekWs) {
          const stats = PDFGenerator.calcLastWeekStats(weekWs);
          weeklyHistory.push({ week: w, pct: stats ? stats.pctAll : 0 });
        } else {
          weeklyHistory.push({ week: w, pct: 0 });
        }
      }
    } catch (e) { /* no history */ }

    await PDFGenerator.generateAndDownload(ws, lastWs, weeklyHistory);
  }

  // Helper: get number of ISO weeks in a year
  function getISOWeeksInYear(year) {
    const jan1 = new Date(year, 0, 1);
    const dec28 = new Date(year, 11, 28);
    // ISO week date: week 1 contains the first Thursday of the year
    const dayOfWeek = jan1.getDay() || 7; // Monday = 1 ... Sunday = 7
    // A year has 53 weeks if Jan 1 is Thursday, or Dec 31 is Thursday
    const dec31 = new Date(year, 11, 31);
    const dec31Day = dec31.getDay() || 7;
    if (dayOfWeek === 4 || dec31Day === 4) return 53;
    return 52;
  }

  function enterResults(worksheetId) {
    window.location.hash = `#/results/${worksheetId}`;
  }

  // ---- Initialize ----
  function init() {
    // Set up auth listener
    Store.init(onAuthStateChanged);

    // Hash change routing
    window.addEventListener('hashchange', () => {
      if (Store.getCurrentUser()) {
        navigate(window.location.hash);
      } else {
        const hash = window.location.hash.replace('#/', '');
        const parts = hash.split('/');
        const route = parts[0];
        const param = parts[1] || null;
        if (route === 'invite' && param) Views.renderInviteAccept(param);
        else if (route === 'register') Views.renderRegister();
        else if (route === 'reset-password') Views.renderResetPassword();
        else Views.renderLogin();
      }
    });

    // Logout button
    document.getElementById('btn-logout').addEventListener('click', async () => {
      await Store.signOut();
      window.location.hash = '#/login';
    });

    // Show loading
    document.getElementById('main-content').innerHTML = `
      <div class="loading-screen">
        <div class="spinner"></div>
        <p>Loading Kid Tasker...</p>
      </div>
    `;
  }

  return { init, navigate, printWorksheet, enterResults };
})();

// Boot the app
document.addEventListener('DOMContentLoaded', App.init);
