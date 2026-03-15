// ============================================================
// Main Application - Routing, Auth State, Initialization
// ============================================================

const App = (() => {
  let currentFamily = null;
  let isInitialized = false;

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
      currentFamily = await Store.getFamily(user.uid);

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

      // Route to current hash or dashboard
      if (!isInitialized) {
        isInitialized = true;
        const hash = window.location.hash || '#/dashboard';
        if (hash === '#/login' || hash === '#/register' || hash === '#/reset-password' || hash === '') {
          window.location.hash = '#/dashboard';
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
      Views.renderLogin();
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

    // Public routes
    if (!Store.getCurrentUser()) {
      if (route === 'register') return Views.renderRegister();
      if (route === 'reset-password') return Views.renderResetPassword();
      return Views.renderLogin();
    }

    // Need family setup
    if (!currentFamily && route !== 'login' && route !== 'register') {
      currentFamily = await Store.getFamily(Store.getCurrentUser().uid);
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
        const route = window.location.hash.replace('#/', '');
        if (route === 'register') Views.renderRegister();
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
