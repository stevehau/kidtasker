// ============================================================
// Views - All page rendering functions
// ============================================================

const Views = (() => {
  const $ = sel => document.querySelector(sel);
  const $main = () => $('#main-content');

  // ---- Helpers ----
  function html(strings, ...vals) {
    return strings.reduce((result, str, i) => result + str + (vals[i] ?? ''), '');
  }

  // Check if email verification is required before proceeding (Firebase mode only)
  function requireVerifiedEmail(container) {
    if (USE_LOCAL_STORAGE) return true; // skip in demo mode
    const user = Store.getCurrentUser();
    if (user && user.emailVerified === false) {
      showAlert(container, 'Please verify your email address before publishing worksheets. Check your inbox for a verification link, then refresh this page.', 'danger');
      return false;
    }
    return true;
  }

  function showAlert(container, msg, type = 'danger') {
    const el = container.querySelector('.alert-slot') || container;
    const alertEl = document.createElement('div');
    alertEl.className = `alert alert-${type}`;
    alertEl.textContent = msg;
    if (container.querySelector('.alert-slot')) {
      container.querySelector('.alert-slot').innerHTML = '';
      container.querySelector('.alert-slot').appendChild(alertEl);
    } else {
      el.prepend(alertEl);
    }
    setTimeout(() => alertEl.remove(), 5000);
  }

  function getCurrentWeekInfo() {
    const now = new Date();
    return {
      year: now.getFullYear(),
      week: Store.getWeekNumber(now)
    };
  }

  // Build weekly history array for a child's year (for PDF column chart)
  async function buildWeeklyHistory(familyId, childId, year) {
    try {
      const allWs = await Store.getWorksheets(familyId, childId, year);
      // Determine weeks in year (52 or 53)
      const jan1 = new Date(year, 0, 1);
      const dec31 = new Date(year, 11, 31);
      const jan1Day = jan1.getDay() || 7;
      const dec31Day = dec31.getDay() || 7;
      const totalWeeks = (jan1Day === 4 || dec31Day === 4) ? 53 : 52;

      const history = [];
      for (let w = 1; w <= totalWeeks; w++) {
        const weekWs = allWs.find(x => x.weekNumber === w && (x.status === 'reviewed' || x.status === 'scanned'));
        if (weekWs) {
          const stats = PDFGenerator.calcLastWeekStats(weekWs);
          history.push({ week: w, pct: stats ? stats.pctAll : 0 });
        } else {
          history.push({ week: w, pct: 0 });
        }
      }
      return history;
    } catch (e) {
      return [];
    }
  }

  // ============================================================
  // LOGIN VIEW
  // ============================================================
  function renderLogin() {
    const mainContent = $main();

    mainContent.innerHTML = html`
      <div class="splash-wrapper">
        <div class="auth-container">
          <div class="auth-card">
            <div class="auth-title"><img src="img/favicon.svg" alt="" style="height:28px;vertical-align:middle;margin-right:6px"> Kid Tasker</div>
            <div class="auth-subtitle">Sign in to manage your family's tasks</div>
            <div class="alert-slot"></div>
            <form id="login-form">
              <div class="form-group">
                <label>Email</label>
                <input type="email" class="form-control" id="login-email" required placeholder="parent@example.com">
              </div>
              <div class="form-group">
                <label>Password</label>
                <input type="password" class="form-control" id="login-password" required placeholder="Your password">
              </div>
              <button type="submit" class="btn btn-primary btn-block btn-lg">Sign In</button>
            </form>
            <a href="#/register" class="auth-link">Don't have an account? Create one</a>
            <a href="#/reset-password" class="auth-link">Forgot your password?</a>
          </div>
          <div class="text-center mt-2" style="font-size:0.8rem">
            <a href="privacy.html" style="color:#fff;text-decoration:underline">Privacy Policy</a> &middot;
            <a href="terms.html" style="color:#fff;text-decoration:underline">Terms of Use</a>
          </div>
        </div>
      </div>
    `;

    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Signing in...';
      try {
        await Store.signIn($('#login-email').value, $('#login-password').value);
        // Auth callback will handle routing
      } catch (err) {
        let msg = err.message;
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') msg = 'Invalid email or password. Please try again.';
        else if (err.code === 'auth/wrong-password') msg = 'Incorrect password. Try "Forgot your password?" below.';
        else if (err.code === 'auth/too-many-requests') msg = 'Too many failed attempts. Please wait a few minutes and try again.';
        showAlert($('.auth-card'), msg);
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });
  }

  // ============================================================
  // REGISTER VIEW
  // ============================================================
  function renderRegister() {
    $main().innerHTML = html`
      <div class="splash-wrapper">
        <div class="auth-container">
          <div class="auth-card">
            <div class="auth-title">Create Account</div>
            <div class="auth-subtitle">Set up your family checklist account</div>
            <div class="alert-slot"></div>
            <form id="register-form">
              <div class="form-group">
                <label>Your Name</label>
                <input type="text" class="form-control" id="reg-name" required placeholder="e.g., Steve">
              </div>
              <div class="form-group">
                <label>Email</label>
                <input type="email" class="form-control" id="reg-email" required placeholder="parent@example.com">
              </div>
              <div class="form-group">
                <label>Password</label>
                <input type="password" class="form-control" id="reg-password" required minlength="6" placeholder="At least 6 characters">
              </div>
              <div class="form-group">
                <label>Confirm Password</label>
                <input type="password" class="form-control" id="reg-password2" required placeholder="Repeat password">
              </div>
              <button type="submit" class="btn btn-primary btn-block btn-lg">Create Account</button>
            </form>
            <a href="#/login" class="auth-link">Already have an account? Sign in</a>
            <p style="font-size:0.75rem;color:#999;margin-top:12px">By creating an account, you agree to our <a href="terms.html">Terms of Use</a> and <a href="privacy.html">Privacy Policy</a>.</p>
          </div>
        </div>
      </div>
    `;

    $('#register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if ($('#reg-password').value !== $('#reg-password2').value) {
        showAlert($('.auth-card'), 'Passwords do not match.');
        return;
      }
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Creating account...';
      try {
        await Store.signUp($('#reg-email').value, $('#reg-password').value, $('#reg-name').value);
      } catch (err) {
        let msg = err.message;
        if (err.code === 'auth/email-already-in-use') msg = 'This email is already registered. <a href="#/login">Sign in instead</a>.';
        else if (err.code === 'auth/weak-password') msg = 'Password must be at least 6 characters.';
        else if (err.code === 'auth/invalid-email') msg = 'Please enter a valid email address.';
        showAlert($('.auth-card'), msg);
        btn.disabled = false;
        btn.textContent = 'Create Account';
      }
    });
  }

  // ============================================================
  // RESET PASSWORD VIEW
  // ============================================================
  function renderResetPassword() {
    $main().innerHTML = html`
      <div class="splash-wrapper">
        <div class="auth-container">
          <div class="auth-card">
            <div class="auth-title">Reset Password</div>
            <div class="auth-subtitle">Enter your email to receive a reset link</div>
            <div class="alert-slot"></div>
            <form id="reset-form">
              <div class="form-group">
                <label>Email</label>
                <input type="email" class="form-control" id="reset-email" required placeholder="parent@example.com">
              </div>
              <button type="submit" class="btn btn-primary btn-block btn-lg">Send Reset Link</button>
            </form>
            <a href="#/login" class="auth-link">Back to sign in</a>
          </div>
        </div>
      </div>
    `;

    $('#reset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Sending...';
      try {
        await Store.resetPassword($('#reset-email').value);
        showAlert($('.auth-card'), 'If this email is registered, you\'ll receive a reset link shortly. Check your spam folder too.', 'success');
        btn.textContent = 'Email Sent';
      } catch (err) {
        // Firebase may throw for non-existent emails — show generic message for security
        showAlert($('.auth-card'), 'If this email is registered, you\'ll receive a reset link shortly. Check your spam folder too.', 'success');
        btn.disabled = false;
        btn.textContent = 'Send Reset Link';
      }
    });
  }

  // ============================================================
  // FAMILY SETUP VIEW
  // ============================================================
  function renderFamilySetup() {
    $main().innerHTML = html`
      <div class="splash-wrapper">
        <div class="auth-container">
          <div class="auth-card">
            <div class="auth-title">Set Up Your Family</div>
            <div class="auth-subtitle">Create a new family or join an existing one</div>
            <div class="alert-slot"></div>
            <div class="tabs">
              <button class="tab active" data-tab="create">Create Family</button>
              <button class="tab" data-tab="join">Join Family</button>
            </div>
            <div id="tab-create">
              <form id="create-family-form">
                <div class="form-group">
                  <label>Family Name (e.g., "The Smith Family")</label>
                  <input type="text" class="form-control" id="family-name" required placeholder="The Smith Family">
                </div>
                <button type="submit" class="btn btn-primary btn-block">Create Family</button>
              </form>
            </div>
            <div id="tab-join" class="hidden">
              <form id="join-family-form">
                <div class="form-group">
                  <label>Family Code</label>
                  <input type="text" class="form-control" id="family-code" required placeholder="Enter the code from your partner">
                </div>
                <button type="submit" class="btn btn-primary btn-block">Join Family</button>
              </form>
            </div>
          </div>
        </div>
      </div>
    `;

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        $('#tab-create').classList.toggle('hidden', tab.dataset.tab !== 'create');
        $('#tab-join').classList.toggle('hidden', tab.dataset.tab !== 'join');
      });
    });

    $('#create-family-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Creating...';
      try {
        const user = Store.getCurrentUser();
        if (!user) throw new Error('Not signed in. Please refresh and try again.');
        const name = $('#family-name').value.trim();
        if (!name) throw new Error('Please enter a family name.');
        await Store.createFamily(name, user.uid);
        window.location.hash = '#/dashboard';
        window.location.reload();
      } catch (err) {
        showAlert($('.auth-card'), err.message);
        btn.disabled = false;
        btn.textContent = 'Create Family';
      }
    });

    $('#join-family-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const user = Store.getCurrentUser();
        const family = await Store.getFamilyByCode($('#family-code').value);
        if (!family) throw new Error('Family not found. Check the code and try again.');
        await Store.joinFamily(family.id, user.uid);
        window.location.hash = '#/dashboard';
      } catch (err) {
        showAlert($('.auth-card'), err.message);
      }
    });
  }

  // ============================================================
  // DASHBOARD VIEW
  // ============================================================
  async function renderDashboard(family) {
    let children;
    try {
      children = await Store.getChildren(family.id);
    } catch (err) {
      console.error('Dashboard load error:', err);
      $main().innerHTML = '<div style="padding:40px;text-align:center"><h2>Database Error</h2><p style="color:#666">' + err.message + '</p><p style="color:#999;font-size:0.85rem">This usually means Firestore security rules need updating. Open the browser console (F12) for details.</p><button onclick="location.reload()" style="margin-top:12px;padding:8px 20px;cursor:pointer">Retry</button></div>';
      return;
    }
    const { year, week } = getCurrentWeekInfo();

    $main().innerHTML = html`
      <div class="page-header">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <p class="text-muted">Week ${week}, ${year} &mdash; ${family.name}</p>
        </div>
        <div class="flex gap-1">
          <span class="text-muted" style="font-size:0.8rem">Family code: <strong>${family.id}</strong></span>
        </div>
      </div>

      ${children.length === 0 ? html`
        <div class="empty-state">
          <div class="empty-icon">&#128102;</div>
          <p>No children added yet. Add your first child to get started!</p>
          <a href="#/settings" class="btn btn-primary">Add Children</a>
        </div>
      ` : html`
        <div class="card-grid">
          ${children.map(child => html`
            <div class="child-card">
              <div>
                <div class="child-name">${child.name}</div>
                <div class="child-age">Age ${Store.getChildAge(child)}</div>
              </div>
              <div class="child-actions">
                <a href="#/checklist/${child.id}" class="btn btn-primary btn-sm">Edit Checklist</a>
                <a href="#/worksheet/${child.id}" class="btn btn-success btn-sm">Worksheet</a>
                <a href="#/analytics/${child.id}" class="btn btn-outline btn-sm">Analytics</a>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="card mt-3">
          <div class="card-title">Recent Worksheets</div>
          <div id="recent-worksheets">Loading...</div>
        </div>
      `}
    `;

    // Load recent worksheets
    if (children.length > 0) {
      let allSheets = [];
      try {
        allSheets = await Store.getWorksheets(family.id);
      } catch (err) {
        console.error('Failed to load worksheets:', err);
      }
      const recent = allSheets.slice(0, 10);
      const container = $('#recent-worksheets');

      if (recent.length === 0) {
        container.innerHTML = '<p class="text-muted">No worksheets created yet. Select a child to create one!</p>';
      } else {
        container.innerHTML = html`
          <table class="data-table">
            <thead>
              <tr>
                <th>Child</th>
                <th>Week</th>
                <th>Date Range</th>
                <th>Status</th>
                <th>Form ID</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${recent.map(ws => {
                const start = new Date(ws.weekStartDate + 'T00:00:00');
                const end = new Date(start);
                end.setDate(end.getDate() + 6);
                const statusBadge = {
                  'draft': 'badge-secondary', 'printed': 'badge-info',
                  'scanned': 'badge-warning', 'reviewed': 'badge-success'
                }[ws.status] || 'badge-secondary';
                return html`
                  <tr>
                    <td>${ws.childName}</td>
                    <td>W${ws.weekNumber}</td>
                    <td>${start.toLocaleDateString('en-US', {month:'short',day:'numeric'})} - ${end.toLocaleDateString('en-US', {month:'short',day:'numeric'})}</td>
                    <td><span class="badge ${statusBadge}">${ws.status}</span></td>
                    <td style="font-family:monospace;font-size:0.8rem">${ws.serialNumber}</td>
                    <td>
                      <button class="btn btn-sm btn-outline" onclick="App.printWorksheet('${ws.id}')">Print</button>
                      <button class="btn btn-sm btn-outline" onclick="App.enterResults('${ws.id}')">Results</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `;
      }
    }
  }

  // ============================================================
  // CHILDREN MANAGEMENT VIEW
  // ============================================================
  async function renderChildren(family) {
    const children = await Store.getChildren(family.id);

    $main().innerHTML = html`
      <div class="page-header">
        <h1 class="page-title">Manage Children</h1>
        <button class="btn btn-primary" id="btn-add-child">+ Add Child</button>
      </div>
      <div class="alert-slot"></div>

      ${children.length === 0 ? html`
        <div class="empty-state">
          <div class="empty-icon">&#128103;</div>
          <p>No children added yet.</p>
        </div>
      ` : html`
        <div class="card-grid">
          ${children.map(child => html`
            <div class="child-card" data-child-id="${child.id}">
              <div>
                <div class="child-name">${child.name}</div>
                <div class="child-age">Age ${Store.getChildAge(child)}</div>
              </div>
              <div class="child-actions">
                <button class="btn btn-sm btn-outline btn-edit-child" data-id="${child.id}" data-name="${child.name}" data-age="${Store.getChildAge(child)}" data-birthday="${child.birthday || ''}">Edit</button>
                <button class="btn btn-sm btn-danger btn-delete-child" data-id="${child.id}" data-name="${child.name}">Remove</button>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;

    $('#btn-add-child').addEventListener('click', () => showChildModal());

    document.querySelectorAll('.btn-edit-child').forEach(btn => {
      btn.addEventListener('click', () => {
        showChildModal(btn.dataset.id, btn.dataset.name, btn.dataset.age, btn.dataset.birthday);
      });
    });

    document.querySelectorAll('.btn-delete-child').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm(`Remove ${btn.dataset.name}? This will not delete existing worksheets.`)) {
          await Store.deleteChild(btn.dataset.id);
          renderChildren(family);
        }
      });
    });
  }

  function showChildModal(id, name = '', age = '', birthday = '') {
    const isEdit = !!id;
    const useBirthday = !!birthday;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = html`
      <div class="modal">
        <div class="modal-title">${isEdit ? 'Edit' : 'Add'} Child</div>
        <div class="alert-slot"></div>
        <form id="child-form">
          <div class="form-group">
            <label>Name</label>
            <input type="text" class="form-control" id="child-name" value="${name}" required placeholder="Child's name">
          </div>
          <div class="form-group">
            <label style="margin-bottom:4px">Age Method</label>
            <div style="display:flex;gap:12px;margin-bottom:8px">
              <label style="font-weight:normal;display:flex;align-items:center;gap:4px;cursor:pointer">
                <input type="radio" name="age-method" value="birthday" ${useBirthday ? 'checked' : ''}> Birthday (auto-calculates age)
              </label>
              <label style="font-weight:normal;display:flex;align-items:center;gap:4px;cursor:pointer">
                <input type="radio" name="age-method" value="manual" ${!useBirthday ? 'checked' : ''}> Enter age manually
              </label>
            </div>
            <div id="birthday-field" style="display:${useBirthday ? 'block' : 'none'}">
              <label>Birthday</label>
              <input type="date" class="form-control" id="child-birthday" value="${birthday}" max="${new Date().toISOString().split('T')[0]}">
              ${birthday ? `<p class="text-muted" style="font-size:0.8rem;margin-top:4px">Current age: ${Store.calcAge(birthday)}</p>` : ''}
            </div>
            <div id="manual-age-field" style="display:${useBirthday ? 'none' : 'block'}">
              <label>Age</label>
              <input type="number" class="form-control" id="child-age" value="${!useBirthday ? age : ''}" min="1" max="18" placeholder="Age">
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline btn-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Add Child'}</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    // Toggle age method
    overlay.querySelectorAll('input[name="age-method"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const isBday = radio.value === 'birthday';
        overlay.querySelector('#birthday-field').style.display = isBday ? 'block' : 'none';
        overlay.querySelector('#manual-age-field').style.display = isBday ? 'none' : 'block';
      });
    });

    overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#child-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const n = overlay.querySelector('#child-name').value.trim();
        const method = overlay.querySelector('input[name="age-method"]:checked').value;
        const bday = overlay.querySelector('#child-birthday').value;
        const manualAge = overlay.querySelector('#child-age').value;

        if (method === 'birthday' && !bday) {
          showAlert(overlay.querySelector('.modal'), 'Please select a birthday.');
          return;
        }
        if (method === 'manual' && !manualAge) {
          showAlert(overlay.querySelector('.modal'), 'Please enter an age.');
          return;
        }

        const updates = { name: n };
        if (method === 'birthday') {
          updates.birthday = bday;
          updates.age = Store.calcAge(bday);
        } else {
          updates.birthday = null;
          updates.age = parseInt(manualAge);
        }

        if (isEdit) {
          await Store.updateChild(id, updates);
        } else {
          const family = await Store.getFamily(Store.getCurrentUser().uid);
          await Store.addChild(family.id, n, updates.age, updates.birthday);
        }
        overlay.remove();
        App.navigate(window.location.hash);
      } catch (err) {
        showAlert(overlay.querySelector('.modal'), err.message);
      }
    });

    overlay.querySelector('#child-name').focus();
  }

  // ============================================================
  // CHECKLIST EDITOR VIEW
  // ============================================================
  async function renderChecklist(family, childId) {
    const children = await Store.getChildren(family.id);
    const child = children.find(c => c.id === childId);
    if (!child) {
      $main().innerHTML = '<div class="alert alert-danger">Child not found.</div>';
      return;
    }

    let tasks = await Store.getTaskTemplates(family.id, childId);
    const { year, week } = getCurrentWeekInfo();

    $main().innerHTML = html`
      <div class="page-header">
        <div>
          <h1 class="page-title">Checklist for ${child.name}</h1>
          <p class="text-muted">Manage recurring task items</p>
        </div>
        <div class="flex gap-1">
          <button class="btn btn-outline btn-sm" id="btn-copy-last" data-tooltip="Import items from last week's worksheet">Copy from Last Week</button>
          <a href="#/worksheet/${childId}" class="btn btn-success btn-sm" data-tooltip="Create or manage weekly worksheets">Generate Worksheet</a>
        </div>
      </div>
      <div class="alert-slot"></div>

      <div class="card">
        <div class="card-title">Add New Item</div>
        <div class="add-item-form">
          <div class="form-group">
            <label>Task Description</label>
            <input type="text" class="form-control" id="new-task-text" placeholder="e.g., Clean your room" maxlength="80">
          </div>
          <div class="form-group small">
            <label>Category</label>
            <select class="form-control" id="new-task-category">
              ${APP_CONFIG.defaultCategories.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group small">
            <label>Priority</label>
            <select class="form-control" id="new-task-priority">
              <option value="A">A - High</option>
              <option value="B" selected>B - Medium</option>
              <option value="C">C - Low</option>
            </select>
          </div>
          <div class="form-group">
            <label>Applicable Days</label>
            <div class="days-checkboxes" id="new-task-days">
              ${APP_CONFIG.daysShort.map(d => `<label class="day-check"><input type="checkbox" value="${d}" checked> ${d}</label>`).join('')}
            </div>
          </div>
          <button class="btn btn-primary" id="btn-add-task" data-tooltip="Add this task to the checklist">Add</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Current Items (${tasks.length}/${APP_CONFIG.maxItemsPerDay})</div>
        <div id="task-list">
          ${renderTaskList(tasks)}
        </div>
      </div>
    `;

    // Add task
    $('#btn-add-task').addEventListener('click', async () => {
      const text = $('#new-task-text').value.trim();
      if (!text) return;
      if (tasks.length >= APP_CONFIG.maxItemsPerDay) {
        showAlert($main(), `Maximum ${APP_CONFIG.maxItemsPerDay} items allowed.`, 'danger');
        return;
      }
      const cat = $('#new-task-category').value;
      const pri = $('#new-task-priority').value;
      const days = Array.from(document.querySelectorAll('#new-task-days input:checked')).map(cb => cb.value);
      await Store.addTaskTemplate(family.id, childId, text, cat, pri, days.length ? days : APP_CONFIG.daysShort);
      tasks = await Store.getTaskTemplates(family.id, childId);
      $('#task-list').innerHTML = renderTaskList(tasks);
      $('.card-title:last-of-type') && document.querySelectorAll('.card-title')[1] &&
        (document.querySelectorAll('.card-title')[1].textContent = `Current Items (${tasks.length}/${APP_CONFIG.maxItemsPerDay})`);
      $('#new-task-text').value = '';
      $('#new-task-text').focus();
      bindTaskActions(family.id, childId);
    });

    // Enter key to add
    $('#new-task-text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('#btn-add-task').click(); }
    });

    // Copy from last week
    $('#btn-copy-last').addEventListener('click', async () => {
      const lastWs = await Store.getLastWorksheet(family.id, childId);
      if (!lastWs) {
        showAlert($main(), 'No previous worksheet found to copy from.', 'info');
        return;
      }
      let added = 0;
      for (const item of lastWs.items) {
        if (tasks.length + added >= APP_CONFIG.maxItemsPerDay) break;
        if (!tasks.find(t => t.text === item.text)) {
          await Store.addTaskTemplate(family.id, childId, item.text, item.category, item.priority, item.daysApplicable);
          added++;
        }
      }
      tasks = await Store.getTaskTemplates(family.id, childId);
      $('#task-list').innerHTML = renderTaskList(tasks);
      bindTaskActions(family.id, childId);
      showAlert($main(), `Copied ${added} items from previous worksheet.`, 'success');
    });

    bindTaskActions(family.id, childId);
  }

  function renderTaskList(tasks) {
    if (tasks.length === 0) {
      return '<div class="empty-state"><p>No items yet. Add your first task above!</p></div>';
    }
    return tasks.map((task, i) => {
      const days = task.daysApplicable || APP_CONFIG.daysShort;
      const daysLabel = days.length === 7 ? 'Every day' : days.join(', ');
      return html`
      <div class="checklist-item" data-id="${task.id}">
        <span class="item-number">${i + 1}</span>
        <span class="item-text">${task.text} <span class="item-days">${daysLabel}</span></span>
        <span class="item-category">${task.category}</span>
        <span class="item-priority priority-${task.priority}">${task.priority}</span>
        <div class="item-actions">
          <button class="btn-icon btn-edit-task" data-id="${task.id}" data-text="${task.text}" data-cat="${task.category}" data-pri="${task.priority}" data-days="${days.join(',')}" title="Edit">&#9998;</button>
          <button class="btn-icon danger btn-delete-task" data-id="${task.id}" title="Remove">&#10005;</button>
        </div>
      </div>
    `;
    }).join('');
  }

  function bindTaskActions(familyId, childId) {
    document.querySelectorAll('.btn-delete-task').forEach(btn => {
      btn.addEventListener('click', async () => {
        await Store.deleteTaskTemplate(btn.dataset.id);
        const tasks = await Store.getTaskTemplates(familyId, childId);
        $('#task-list').innerHTML = renderTaskList(tasks);
        bindTaskActions(familyId, childId);
      });
    });

    document.querySelectorAll('.btn-edit-task').forEach(btn => {
      btn.addEventListener('click', () => {
        showEditTaskModal(btn.dataset.id, btn.dataset.text, btn.dataset.cat, btn.dataset.pri, btn.dataset.days, async () => {
          const tasks = await Store.getTaskTemplates(familyId, childId);
          $('#task-list').innerHTML = renderTaskList(tasks);
          bindTaskActions(familyId, childId);
        });
      });
    });
  }

  function showEditTaskModal(taskId, text, category, priority, daysStr, onSave) {
    const currentDays = daysStr ? daysStr.split(',') : APP_CONFIG.daysShort;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = html`
      <div class="modal">
        <div class="modal-title">Edit Task</div>
        <form id="edit-task-form">
          <div class="form-group">
            <label>Task Description</label>
            <input type="text" class="form-control" id="edit-text" value="${text}" required>
          </div>
          <div class="form-group">
            <label>Category</label>
            <select class="form-control" id="edit-category">
              ${APP_CONFIG.defaultCategories.map(c => `<option value="${c}" ${c === category ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Priority</label>
            <select class="form-control" id="edit-priority">
              <option value="A" ${priority === 'A' ? 'selected' : ''}>A - High</option>
              <option value="B" ${priority === 'B' ? 'selected' : ''}>B - Medium</option>
              <option value="C" ${priority === 'C' ? 'selected' : ''}>C - Low</option>
            </select>
          </div>
          <div class="form-group">
            <label>Applicable Days</label>
            <div class="days-checkboxes" id="edit-task-days">
              ${APP_CONFIG.daysShort.map(d => `<label class="day-check"><input type="checkbox" value="${d}" ${currentDays.includes(d) ? 'checked' : ''}> ${d}</label>`).join('')}
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline btn-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#edit-task-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const editDays = Array.from(overlay.querySelectorAll('#edit-task-days input:checked')).map(cb => cb.value);
      await Store.updateTaskTemplate(taskId, {
        text: overlay.querySelector('#edit-text').value.trim(),
        category: overlay.querySelector('#edit-category').value,
        priority: overlay.querySelector('#edit-priority').value,
        daysApplicable: editDays.length ? editDays : APP_CONFIG.daysShort
      });
      overlay.remove();
      if (onSave) onSave();
    });
  }

  // Helper function for photo crop overlay
  function showPhotoCropOverlay(file, family) {
    const cropOverlay = $('#photo-crop-overlay');
    const cropImage = $('#photo-crop-image');
    let rotationAngle = 0;

    // Load the image
    const reader = new FileReader();
    reader.onload = (e) => {
      cropImage.src = e.target.result;
      cropOverlay.classList.remove('hidden');
      rotationAngle = 0;
      updateCropImageDisplay();
    };
    reader.readAsDataURL(file);

    function updateCropImageDisplay() {
      cropImage.style.transform = `rotate(${rotationAngle}deg)`;
    }

    // Rotate left (CCW)
    const btnRotateCCW = $('#btn-rotate-ccw');
    if (btnRotateCCW) {
      btnRotateCCW.onclick = (e) => {
        e.preventDefault();
        rotationAngle = (rotationAngle - 90) % 360;
        updateCropImageDisplay();
      };
    }

    // Rotate right (CW)
    const btnRotateCW = $('#btn-rotate-cw');
    if (btnRotateCW) {
      btnRotateCW.onclick = (e) => {
        e.preventDefault();
        rotationAngle = (rotationAngle + 90) % 360;
        updateCropImageDisplay();
      };
    }

    // Confirm and process
    const btnConfirm = $('#btn-confirm-crop');
    if (btnConfirm) {
      btnConfirm.onclick = async (e) => {
        e.preventDefault();
        cropOverlay.classList.add('hidden');

        // If rotation was applied, create a rotated version
        if (rotationAngle !== 0) {
          // Create canvas and rotate the image
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const img = new Image();

          img.onload = () => {
            const radians = (rotationAngle * Math.PI) / 180;
            canvas.width = Math.abs(Math.cos(radians) * img.width) + Math.abs(Math.sin(radians) * img.height);
            canvas.height = Math.abs(Math.sin(radians) * img.width) + Math.abs(Math.cos(radians) * img.height);

            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(radians);
            ctx.drawImage(img, -img.width / 2, -img.height / 2);

            canvas.toBlob((blob) => {
              const rotatedFile = new File([blob], file.name, { type: 'image/jpeg' });
              processFile(rotatedFile, family, 'photo');
            }, 'image/jpeg', 0.95);
          };
          img.src = cropImage.src;
        } else {
          processFile(file, family, 'photo');
        }
      };
    }

    // Cancel
    const btnCancel = $('#btn-cancel-crop');
    if (btnCancel) {
      btnCancel.onclick = (e) => {
        e.preventDefault();
        cropOverlay.classList.add('hidden');
      };
    }
  }

  // ============================================================
  // WORKSHEET VIEW
  // ============================================================
  async function renderWorksheet(family, childId) {
    const children = await Store.getChildren(family.id);
    const child = children.find(c => c.id === childId);
    if (!child) {
      $main().innerHTML = '<div class="alert alert-danger">Child not found.</div>';
      return;
    }

    const tasks = await Store.getTaskTemplates(family.id, childId);
    const { year, week } = getCurrentWeekInfo();
    const existingSheets = await Store.getWorksheets(family.id, childId);
    const TOTAL_ROWS = 10;
    const days = APP_CONFIG.daysShort;

    // Compute week start date for column headers
    const weekStartDate = Store.getMondayOfWeek(year, week);

    // Build preview rows: tasks first, then blanks up to TOTAL_ROWS
    const previewRows = tasks.slice(0, TOTAL_ROWS).map((t, i) => ({
      num: i + 1,
      text: t.text,
      priority: t.priority || 'B',
      daysApplicable: t.daysApplicable || days,
      taskId: t.id
    }));
    for (let i = previewRows.length; i < TOTAL_ROWS; i++) {
      previewRows.push({ num: i + 1, text: '', priority: '', daysApplicable: days, taskId: null });
    }

    $main().innerHTML = html`
      <div class="page-header">
        <div>
          <h1 class="page-title">Worksheet for ${child.name}</h1>
          <p class="text-muted">Week ${week}, ${year} — starting ${weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:8px">
            <label style="margin:0;font-size:0.85rem">Week</label>
            <input type="number" class="form-control" id="ws-week" value="${week}" min="1" max="53" style="width:70px">
            <input type="number" class="form-control" id="ws-year" value="${year}" min="2024" max="2030" style="width:80px">
            <button class="btn btn-sm btn-outline" id="btn-go-week">Go</button>
          </div>
        </div>
      </div>
      <div class="alert-slot"></div>

      <!-- Action bar -->
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
        <a href="#/checklist/${childId}" class="btn btn-outline btn-sm">Edit Items</a>
        <button class="btn btn-primary btn-sm" id="btn-publish" ${tasks.length === 0 ? 'disabled' : ''}>Publish &amp; Print PDF</button>
        ${existingSheets.length > 0 ? html`
          <select class="form-control" id="sel-history" style="width:auto;font-size:0.85rem">
            <option value="">Previous worksheets...</option>
            ${existingSheets.map(ws => html`
              <option value="${ws.id}">W${ws.weekNumber} ${ws.year} — ${ws.status}${ws.status === 'draft' ? ' (draft)' : ''}</option>
            `).join('')}
          </select>
          <button class="btn btn-outline btn-sm" id="btn-reprint-sel" style="display:none">Reprint</button>
          <button class="btn btn-outline btn-sm" id="btn-results-sel" style="display:none">Enter Results</button>
        ` : ''}
      </div>

      <!-- PDF-like worksheet preview -->
      <div class="card" style="padding:0;overflow-x:auto">
        <table class="ws-preview">
          <thead>
            <tr class="ws-header">
              <th class="ws-col-num">#</th>
              <th class="ws-col-task">Task</th>
              ${days.map((d, di) => {
                const dayDate = new Date(weekStartDate);
                dayDate.setDate(dayDate.getDate() + di);
                const dateStr = (dayDate.getMonth() + 1) + '/' + dayDate.getDate();
                return `<th class="ws-col-day"><div class="ws-day-name">${d}</div><div class="ws-day-date">${dateStr}</div><div class="ws-day-sub"><span>${child.name.split(' ')[0]}</span><span>Parent</span></div></th>`;
              }).join('')}
              <th class="ws-col-pri">Pri</th>
            </tr>
          </thead>
          <tbody>
            ${previewRows.map(row => {
              const priClass = row.priority === 'A' ? 'ws-pri-a' : row.priority === 'C' ? 'ws-pri-c' : 'ws-pri-b';
              return html`
                <tr class="${row.text ? '' : 'ws-blank-row'}">
                  <td class="ws-col-num">${row.num}</td>
                  <td class="ws-col-task">${row.text || '<span style="color:#ccc">blank row</span>'}</td>
                  ${days.map(d => {
                    const applicable = row.daysApplicable.includes(d);
                    if (!applicable || !row.text) {
                      return `<td class="ws-col-day ${!applicable && row.text ? 'ws-na' : ''}"><div class="ws-cb-pair">${!applicable && row.text ? '<span class="ws-na-text">—</span>' : '<span class="ws-cb"></span><span class="ws-cb"></span>'}</div></td>`;
                    }
                    return `<td class="ws-col-day"><div class="ws-cb-pair"><span class="ws-cb"></span><span class="ws-cb"></span></div></td>`;
                  }).join('')}
                  <td class="ws-col-pri"><span class="ws-pri ${priClass}">${row.priority || ''}</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      ${tasks.length === 0 ? html`
        <div class="alert alert-info" style="margin-top:12px">
          No checklist items for ${child.name}. <a href="#/checklist/${childId}">Add items</a> to get started.
        </div>
      ` : ''}
    `;

    // Week selector
    if ($('#btn-go-week')) {
      $('#btn-go-week').addEventListener('click', () => {
        renderWorksheet(family, childId);
      });
    }

    // History dropdown
    if ($('#sel-history')) {
      $('#sel-history').addEventListener('change', () => {
        const wsId = $('#sel-history').value;
        const reprintBtn = $('#btn-reprint-sel');
        const resultsBtn = $('#btn-results-sel');
        if (wsId) {
          reprintBtn.style.display = '';
          resultsBtn.style.display = '';
        } else {
          reprintBtn.style.display = 'none';
          resultsBtn.style.display = 'none';
        }
      });

      if ($('#btn-reprint-sel')) {
        $('#btn-reprint-sel').addEventListener('click', async () => {
          const wsId = $('#sel-history').value;
          if (!wsId) return;
          const ws = await Store.getWorksheet(wsId);
          if (ws) {
            const prevWs = await Store.getPreviousReviewedWorksheet(family.id, childId, ws.id);
            const weeklyHistory = await buildWeeklyHistory(family.id, childId, ws.year);
            await PDFGenerator.generateAndDownload(ws, prevWs, weeklyHistory);
          }
        });
      }

      if ($('#btn-results-sel')) {
        $('#btn-results-sel').addEventListener('click', () => {
          const wsId = $('#sel-history').value;
          if (wsId) App.enterResults(wsId);
        });
      }
    }

    // Publish & Print button
    if ($('#btn-publish')) {
      $('#btn-publish').addEventListener('click', async () => {
        if (!requireVerifiedEmail($main())) return;

        const y = parseInt($('#ws-year').value);
        const w = parseInt($('#ws-week').value);
        const btn = $('#btn-publish');

        // Pre-print warning: check if previous week has been scanned
        try {
          const prevWeekNum = w > 1 ? w - 1 : 52;
          const prevYear = w > 1 ? y : y - 1;
          const prevSheets = await Store.getWorksheets(family.id, childId, prevYear, prevWeekNum);
          const prevScanned = prevSheets.find(s => s.status === 'scanned' || s.status === 'reviewed');
          if (prevSheets.length > 0 && !prevScanned) {
            if (!confirm(`Week ${prevWeekNum} hasn't been scanned yet. Scanning it first improves gamification on the printout.\n\nContinue printing without last week's results?`)) return;
          }
        } catch (e) { /* ignore */ }

        // Check if already published for this week
        try {
          const existing = await Store.getWorksheets(family.id, childId, y, w);
          const alreadyPublished = existing.find(ws => ws.status === 'published' || ws.status === 'printed' || ws.status === 'scanned' || ws.status === 'reviewed');
          if (alreadyPublished) {
            showAlert($main(), `Week ${w} already has a published worksheet (${alreadyPublished.serialNumber}). Use the history dropdown to reprint it.`);
            return;
          }
        } catch (e) { /* proceed */ }

        if (!confirm('This will publish and print the worksheet. Continue?')) return;

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Publishing...';

        try {
          const draft = await Store.saveDraftWorksheet(family.id, childId, child.name, y, w, tasks);
          const published = await Store.publishWorksheet(draft.id);
          const prevWs = await Store.getPreviousReviewedWorksheet(family.id, childId, published.id);
          const weeklyHistory = await buildWeeklyHistory(family.id, childId, published.year);
          await PDFGenerator.generateAndDownload(published, prevWs, weeklyHistory);
          await Store.updateWorksheet(published.id, { status: 'printed' });
          showAlert($main(), `Worksheet published! Form ID: ${published.serialNumber}`, 'success');
          setTimeout(() => renderWorksheet(family, childId), 2000);
        } catch (err) {
          showAlert($main(), err.message);
          btn.disabled = false;
          btn.textContent = 'Publish & Print PDF';
        }
      });
    }
  }

  // ============================================================
  // MANUAL RESULTS ENTRY VIEW
  // ============================================================
  async function renderResultsEntry(worksheetId) {
    const ws = await Store.getWorksheet(worksheetId);
    if (!ws) {
      $main().innerHTML = '<div class="alert alert-danger">Worksheet not found.</div>';
      return;
    }

    const days = APP_CONFIG.daysShort;

    $main().innerHTML = html`
      <div class="page-header">
        <div>
          <h1 class="page-title">Enter Results</h1>
          <p class="text-muted">${ws.childName} &mdash; Week ${ws.weekNumber}, ${ws.year} &mdash; ${ws.serialNumber}</p>
        </div>
        <button class="btn btn-success" id="btn-save-results">Save Results</button>
      </div>
      <div class="alert-slot"></div>

      <div class="card" style="overflow-x:auto">
        <table class="data-table" id="results-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Task</th>
              ${days.map(d => `<th class="text-center">${d}</th>`).join('')}
              <th class="text-center" data-tooltip="Parent confirms all days for this task">Confirmed</th>
            </tr>
          </thead>
          <tbody>
            ${ws.items.map((item, idx) => html`
              <tr>
                <td>${idx + 1}</td>
                <td>${item.text}</td>
                ${days.map(d => {
                  const dayResult = item.results && item.results[d];
                  const checked = dayResult && dayResult.completed;
                  const applicable = !item.daysApplicable || item.daysApplicable.includes(d);
                  if (!applicable) {
                    return `<td class="text-center" style="background:#f0f0f0">N/A</td>`;
                  }
                  return `<td class="text-center">
                    <input type="checkbox" class="result-check" data-item="${idx}" data-day="${d}" ${checked ? 'checked' : ''}>
                  </td>`;
                }).join('')}
                <td class="text-center">
                  <input type="checkbox" class="confirm-check" data-item="${idx}" ${item.results && item.results._confirmed ? 'checked' : ''} title="Parent confirms all">
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title">Quick Actions</div>
        <div class="flex gap-1 flex-wrap">
          <button class="btn btn-outline btn-sm" id="btn-check-all">Check All</button>
          <button class="btn btn-outline btn-sm" id="btn-uncheck-all">Uncheck All</button>
          <button class="btn btn-outline btn-sm" id="btn-confirm-all">Confirm All</button>
        </div>
      </div>
    `;

    // Quick actions
    $('#btn-check-all').addEventListener('click', () => {
      document.querySelectorAll('.result-check').forEach(cb => cb.checked = true);
    });
    $('#btn-uncheck-all').addEventListener('click', () => {
      document.querySelectorAll('.result-check').forEach(cb => cb.checked = false);
    });
    $('#btn-confirm-all').addEventListener('click', () => {
      document.querySelectorAll('.confirm-check').forEach(cb => cb.checked = true);
    });

    // Save results
    $('#btn-save-results').addEventListener('click', async () => {
      const items = ws.items.map((item, idx) => {
        const results = {};
        const confCb = document.querySelector(`.confirm-check[data-item="${idx}"]`);
        const globalConfirmed = confCb ? confCb.checked : false;
        days.forEach(d => {
          const cb = document.querySelector(`.result-check[data-item="${idx}"][data-day="${d}"]`);
          if (cb) {
            results[d] = { completed: cb.checked, confirmed: globalConfirmed };
          }
        });
        results._confirmed = globalConfirmed;
        return { index: idx, text: item.text, results };
      });

      try {
        await Store.saveOCRResults(ws.id, { items }, Store.getCurrentUser().displayName);
        await Store.updateWorksheet(ws.id, { status: 'reviewed' });
        showAlert($main(), 'Results saved successfully!', 'success');
      } catch (err) {
        showAlert($main(), err.message);
      }
    });
  }

  // ============================================================
  // SCANNER VIEW
  // ============================================================
  function renderScanner(family) {
    $main().innerHTML = html`
      <div class="page-header">
        <h1 class="page-title">Submit Worksheet</h1>
      </div>
      <div class="alert-slot"></div>

      <div class="card">
        <div class="card-title">Submit Completed Worksheet</div>
        <p class="text-muted mb-2">Submit a photo or scan of a completed worksheet. The system reads the QR code to identify the worksheet, then analyzes checkbox marks using pixel detection. The image can be in any orientation.</p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
          <!-- Flatbed Scanner Card -->
          <div class="card" style="margin:0">
            <div class="card-title" style="margin-bottom:12px">
              <div style="font-size:2rem;margin-bottom:8px">📠</div>
              Flatbed Scanner
            </div>
            <p class="text-muted" style="font-size:0.9rem;margin-bottom:16px">Upload a high-quality flatbed scan (recommended for best results)</p>
            <div class="scanner-area" id="drop-zone-flatbed">
              <p>Drop scan here or click to upload</p>
              <p style="font-size:0.8rem">(JPG, PNG, TIFF, BMP)</p>
              <input type="file" id="scan-file-flatbed" accept="image/*" style="display:none">
            </div>
          </div>

          <!-- Smartphone Photo Card -->
          <div class="card" style="margin:0">
            <div class="card-title" style="margin-bottom:12px">
              <div style="font-size:2rem;margin-bottom:8px">📷</div>
              Smartphone Photo
            </div>
            <p class="text-muted" style="font-size:0.9rem;margin-bottom:16px">Take or upload a photo of the completed worksheet</p>
            <div class="scanner-area" id="drop-zone-photo">
              <p>Drop photo here or click to upload</p>
              <p style="font-size:0.8rem">(JPG, PNG)</p>
              <input type="file" id="scan-file-photo" accept="image/*" capture="environment" style="display:none">
            </div>
          </div>
        </div>

        <div id="scan-preview-area" class="hidden">
          <img id="scan-preview" class="scan-preview">
        </div>

        <div id="photo-crop-overlay" class="hidden" style="margin-bottom:20px;border:1px solid #ddd;padding:16px;border-radius:var(--radius)">
          <h3 style="margin-top:0">Align &amp; Confirm Photo</h3>
          <div style="position:relative;max-width:100%;max-height:400px;overflow:auto;margin-bottom:12px;border:2px dashed #999;display:flex;align-items:center;justify-content:center;background:#f5f5f5">
            <img id="photo-crop-image" style="max-width:100%;max-height:400px;object-fit:contain">
          </div>
          <p class="text-muted" style="font-size:0.85rem;margin-bottom:12px">Adjust alignment if needed. The dashed rectangle shows where the worksheet edges should align.</p>
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <button class="btn btn-outline btn-sm" id="btn-rotate-ccw">Rotate Left</button>
            <button class="btn btn-outline btn-sm" id="btn-rotate-cw">Rotate Right</button>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary" id="btn-confirm-crop">Confirm &amp; Process</button>
            <button class="btn btn-outline" id="btn-cancel-crop">Cancel</button>
          </div>
        </div>

        <div id="ocr-progress-area" class="hidden">
          <div class="ocr-progress">
            <p>Processing scan... <span id="ocr-percent">0</span>%</p>
            <div class="progress-bar">
              <div class="progress-fill" id="ocr-bar" style="width:0%"></div>
            </div>
          </div>
        </div>

        <div id="ocr-results-area" class="hidden"></div>
      </div>

      <div class="card">
        <div class="card-title">Manual Form ID Lookup</div>
        <div class="flex gap-1 items-center">
          <input type="text" class="form-control" id="manual-serial" placeholder="Form ID (e.g., WSH-DYL-2026-W12-A3F7)" style="max-width:320px">
          <button class="btn btn-primary btn-sm" id="btn-lookup">Look Up</button>
        </div>
        <div id="lookup-result" class="mt-2"></div>
      </div>
    `;

    // File upload - Flatbed Scanner
    const dropZoneFlatbed = $('#drop-zone-flatbed');
    const fileInputFlatbed = $('#scan-file-flatbed');

    dropZoneFlatbed.addEventListener('click', () => fileInputFlatbed.click());
    dropZoneFlatbed.addEventListener('dragover', (e) => { e.preventDefault(); dropZoneFlatbed.classList.add('dragover'); });
    dropZoneFlatbed.addEventListener('dragleave', () => dropZoneFlatbed.classList.remove('dragover'));
    dropZoneFlatbed.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZoneFlatbed.classList.remove('dragover');
      if (e.dataTransfer.files.length) processFile(e.dataTransfer.files[0], family, 'flatbed');
    });
    fileInputFlatbed.addEventListener('change', () => {
      if (fileInputFlatbed.files.length) processFile(fileInputFlatbed.files[0], family, 'flatbed');
    });

    // File upload - Smartphone Photo
    const dropZonePhoto = $('#drop-zone-photo');
    const fileInputPhoto = $('#scan-file-photo');

    dropZonePhoto.addEventListener('click', () => fileInputPhoto.click());
    dropZonePhoto.addEventListener('dragover', (e) => { e.preventDefault(); dropZonePhoto.classList.add('dragover'); });
    dropZonePhoto.addEventListener('dragleave', () => dropZonePhoto.classList.remove('dragover'));
    dropZonePhoto.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZonePhoto.classList.remove('dragover');
      if (e.dataTransfer.files.length) showPhotoCropOverlay(e.dataTransfer.files[0], family);
    });
    fileInputPhoto.addEventListener('change', () => {
      if (fileInputPhoto.files.length) showPhotoCropOverlay(fileInputPhoto.files[0], family);
    });

    // Manual lookup
    $('#btn-lookup').addEventListener('click', async () => {
      const serial = $('#manual-serial').value.trim();
      if (!serial) return;
      const ws = await Store.getWorksheetBySerial(serial);
      if (ws) {
        $('#lookup-result').innerHTML = html`
          <div class="alert alert-success">
            Found: ${ws.childName}, Week ${ws.weekNumber} ${ws.year}
            <button class="btn btn-sm btn-primary ml-2" onclick="App.enterResults('${ws.id}')" style="margin-left:12px">Enter Results</button>
          </div>
        `;
      } else {
        $('#lookup-result').innerHTML = '<div class="alert alert-danger">No worksheet found with that Form ID.</div>';
      }
    });
  }

  async function processFile(file, family, captureMethod = 'flatbed') {
    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      $('#scan-preview').src = e.target.result;
      $('#scan-preview-area').classList.remove('hidden');
    };
    reader.readAsDataURL(file);

    // Start scan processing
    $('#ocr-progress-area').classList.remove('hidden');
    $('#ocr-results-area').classList.add('hidden');

    // Phase 1: Detect QR / Form ID (no worksheet context yet)
    const result = await OCRProcessor.processImage(file, null, (pct) => {
      $('#ocr-percent').textContent = pct;
      $('#ocr-bar').style.width = pct + '%';
    });

    if (!result.success) {
      $('#ocr-progress-area').classList.add('hidden');
      showAlert($main(), `Scan processing failed: ${result.error}`);
      return;
    }

    // Try to find worksheet by detected Form ID
    let worksheet = null;
    if (result.serialNumber) {
      worksheet = await Store.getWorksheetBySerial(result.serialNumber);
    }

    const resultsArea = $('#ocr-results-area');

    if (worksheet) {
      // Check submission date validation
      const now = new Date();
      const weekStartDate = new Date(worksheet.weekStartDate);
      const lastDayOfWeek = new Date(weekStartDate);
      lastDayOfWeek.setDate(lastDayOfWeek.getDate() + 6);

      if (now < lastDayOfWeek) {
        $('#ocr-progress-area').classList.add('hidden');
        resultsArea.classList.remove('hidden');
        const lastDayStr = lastDayOfWeek.toLocaleDateString();
        resultsArea.innerHTML = html`
          <div class="alert alert-warning">
            <strong>Cannot Submit Yet</strong><br>
            This worksheet's week ends on ${lastDayStr}. Worksheets cannot be submitted before the last day to ensure complete data.
          </div>
        `;
        return;
      }

      // Phase 2: Re-run with worksheet context for checkbox analysis
      const detailedResult = await OCRProcessor.processImage(file, worksheet, (pct) => {
        $('#ocr-percent').textContent = pct;
        $('#ocr-bar').style.width = pct + '%';
      });

      $('#ocr-progress-area').classList.add('hidden');
      resultsArea.classList.remove('hidden');

      // Apply rotation to preview image
      if (detailedResult.rotation) {
        const previewImg = $('#scan-preview');
        if (previewImg) {
          previewImg.style.transform = `rotate(${detailedResult.rotation}deg)`;
        }
      }

      const detectionMethod = result.qrDetected ? 'QR code' : 'text recognition';
      const rotationNote = detailedResult.rotation ? ` (rotated ${detailedResult.rotation}&deg;)` : '';
      const regMarkNote = detailedResult.regMarksFound >= 3 ? 'perspective-corrected' : 'estimated alignment';
      const itemCount = detailedResult.items ? detailedResult.items.length : 0;

      resultsArea.innerHTML = html`
        <div class="alert alert-success">
          <strong>Worksheet matched!</strong> ${worksheet.childName}, Week ${worksheet.weekNumber} ${worksheet.year}
          <br><small>Form ID: ${worksheet.serialNumber} &mdash; ${detectionMethod}${rotationNote}, ${regMarkNote}, ${detailedResult.regMarksFound || 0}/4 reg marks</small>
        </div>
        <p class="text-muted mb-2">
          Detected <strong>parent confirmation</strong> checkboxes for ${itemCount} task(s).
          ${detailedResult.threshold ? `Ink threshold: ${(detailedResult.threshold * 100).toFixed(0)}%.` : ''}
          <br><strong>Please review and correct</strong> the results below, then save.
        </p>
        <button class="btn btn-primary" id="btn-goto-results">Review &amp; Edit Results</button>
      `;

      // Save preliminary OCR results
      if (detailedResult.items && detailedResult.items.length > 0) {
        await Store.saveOCRResults(worksheet.id, detailedResult, Store.getCurrentUser().displayName);
      }

      // Archive image
      try {
        if (typeof ImageStore !== 'undefined') {
          await ImageStore.init();
          await ImageStore.saveImage(worksheet.id, file, {
            captureMethod,
            capturedBy: Store.getCurrentUser().displayName,
            rotation: detailedResult.rotation || 0,
            originalFilename: file.name,
            mimeType: file.type
          });
        }
      } catch (err) {
        console.warn('Image archiving failed:', err);
      }

      $('#btn-goto-results').addEventListener('click', () => {
        App.enterResults(worksheet.id);
      });
    } else {
      $('#ocr-progress-area').classList.add('hidden');
      resultsArea.classList.remove('hidden');

      resultsArea.innerHTML = html`
        <div class="alert alert-info">
          ${result.serialNumber
            ? `Form ID detected: <strong>${result.serialNumber}</strong>, but no matching worksheet was found in the database.`
            : 'Could not detect a Form ID from the QR code or text. Try the manual lookup below, or make sure the image is clear and well-lit.'}
        </div>
        <p class="text-muted" style="font-size:0.85rem">
          Tips: Make sure the QR code is visible and the image is not too blurry. The scanner supports photos taken at any rotation.
        </p>
      `;
    }
  }

  // ============================================================
  // ANALYTICS VIEW
  // ============================================================
  async function renderAnalytics(family, childId) {
    const children = await Store.getChildren(family.id);

    $main().innerHTML = html`
      <div class="page-header">
        <h1 class="page-title">Analytics</h1>
      </div>

      <div class="card">
        <div class="worksheet-controls">
          <div class="form-group" style="margin-bottom:0">
            <label>Child</label>
            <select class="form-control" id="analytics-child" style="min-width:160px">
              <option value="">All Children</option>
              ${children.map(c => `<option value="${c.id}" ${c.id === childId ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label>From</label>
            <input type="date" class="form-control" id="analytics-from" style="width:160px">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label>To</label>
            <input type="date" class="form-control" id="analytics-to" style="width:160px">
          </div>
          <div class="form-group" style="margin-bottom:0;align-self:flex-end">
            <button class="btn btn-primary btn-sm" id="btn-refresh-analytics">Refresh</button>
          </div>
        </div>
      </div>

      <div id="analytics-content">
        <div class="loading-screen">
          <div class="spinner"></div>
          <p>Loading analytics...</p>
        </div>
      </div>
    `;

    // Set default date range (last 3 months)
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    $('#analytics-from').value = Store.formatDate(threeMonthsAgo);
    $('#analytics-to').value = Store.formatDate(now);

    async function loadAnalytics() {
      const selChild = $('#analytics-child').value || null;
      const from = $('#analytics-from').value || null;
      const to = $('#analytics-to').value || null;

      const data = await Store.getAnalyticsData(family.id, selChild, from, to);
      renderAnalyticsData(data, children, selChild);
    }

    $('#btn-refresh-analytics').addEventListener('click', loadAnalytics);
    $('#analytics-child').addEventListener('change', loadAnalytics);

    await loadAnalytics();
  }

  function renderAnalyticsData(worksheets, children, selectedChildId) {
    const container = $('#analytics-content');

    if (worksheets.length === 0) {
      container.innerHTML = html`
        <div class="empty-state">
          <div class="empty-icon">&#128200;</div>
          <p>No completed worksheets found for the selected period. Complete and scan some worksheets to see analytics!</p>
        </div>
      `;
      return;
    }

    // Calculate stats
    const stats = calculateStats(worksheets);

    container.innerHTML = html`
      <div class="stat-cards">
        <div class="stat-card">
          <div class="stat-value">${stats.totalTasks}</div>
          <div class="stat-label">Total Task-Days</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.completedTasks}</div>
          <div class="stat-label">Completed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.completionRate}%</div>
          <div class="stat-label">Completion Rate</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.totalWeeks}</div>
          <div class="stat-label">Weeks Tracked</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Completion Rate Over Time</div>
        <div class="chart-container">
          <canvas id="chart-completion"></canvas>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Completion by Category</div>
        <div class="chart-container">
          <canvas id="chart-categories"></canvas>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Completion by Day of Week</div>
        <div class="chart-container">
          <canvas id="chart-days"></canvas>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Detailed Breakdown by Category</div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Total</th>
              <th>Completed</th>
              <th>Rate</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(stats.byCategory).map(([cat, data]) => html`
              <tr>
                <td>${cat}</td>
                <td>${data.total}</td>
                <td>${data.completed}</td>
                <td><strong>${data.rate}%</strong></td>
                <td>${data.trend > 0 ? '&#9650; Improving' : data.trend < 0 ? '&#9660; Declining' : '&#8594; Steady'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Render charts
    renderCompletionChart(stats);
    renderCategoryChart(stats);
    renderDayChart(stats);
  }

  function calculateStats(worksheets) {
    let totalTasks = 0;
    let completedTasks = 0;
    const byCategory = {};
    const byDay = {};
    const byWeek = {};

    APP_CONFIG.daysShort.forEach(d => { byDay[d] = { total: 0, completed: 0 }; });

    worksheets.forEach(ws => {
      const weekKey = `W${ws.weekNumber} ${ws.year}`;
      if (!byWeek[weekKey]) byWeek[weekKey] = { total: 0, completed: 0, label: weekKey };

      ws.items.forEach(item => {
        const cat = item.category || 'Other';
        if (!byCategory[cat]) byCategory[cat] = { total: 0, completed: 0, weeklyRates: [] };

        APP_CONFIG.daysShort.forEach(day => {
          if (item.results && item.results[day]) {
            totalTasks++;
            byCategory[cat].total++;
            byDay[day].total++;
            byWeek[weekKey].total++;

            if (item.results[day].completed) {
              completedTasks++;
              byCategory[cat].completed++;
              byDay[day].completed++;
              byWeek[weekKey].completed++;
            }
          }
        });
      });
    });

    // Compute rates and trends
    Object.values(byCategory).forEach(cat => {
      cat.rate = cat.total > 0 ? Math.round(cat.completed / cat.total * 100) : 0;
      cat.trend = 0; // simplified
    });

    // Calculate trend per category using first half vs second half
    if (worksheets.length >= 2) {
      const mid = Math.floor(worksheets.length / 2);
      const firstHalf = worksheets.slice(0, mid);
      const secondHalf = worksheets.slice(mid);

      Object.keys(byCategory).forEach(cat => {
        let firstCompleted = 0, firstTotal = 0;
        let secondCompleted = 0, secondTotal = 0;

        firstHalf.forEach(ws => {
          ws.items.filter(i => (i.category || 'Other') === cat).forEach(item => {
            APP_CONFIG.daysShort.forEach(d => {
              if (item.results && item.results[d]) {
                firstTotal++;
                if (item.results[d].completed) firstCompleted++;
              }
            });
          });
        });

        secondHalf.forEach(ws => {
          ws.items.filter(i => (i.category || 'Other') === cat).forEach(item => {
            APP_CONFIG.daysShort.forEach(d => {
              if (item.results && item.results[d]) {
                secondTotal++;
                if (item.results[d].completed) secondCompleted++;
              }
            });
          });
        });

        const firstRate = firstTotal > 0 ? firstCompleted / firstTotal : 0;
        const secondRate = secondTotal > 0 ? secondCompleted / secondTotal : 0;
        byCategory[cat].trend = secondRate - firstRate > 0.05 ? 1 : secondRate - firstRate < -0.05 ? -1 : 0;
      });
    }

    const weeklyRates = Object.values(byWeek).map(w => ({
      label: w.label,
      rate: w.total > 0 ? Math.round(w.completed / w.total * 100) : 0
    }));

    return {
      totalTasks,
      completedTasks,
      completionRate: totalTasks > 0 ? Math.round(completedTasks / totalTasks * 100) : 0,
      totalWeeks: worksheets.length,
      byCategory,
      byDay,
      weeklyRates
    };
  }

  function renderCompletionChart(stats) {
    const ctx = document.getElementById('chart-completion');
    if (!ctx) return;
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: stats.weeklyRates.map(w => w.label),
        datasets: [{
          label: 'Completion Rate %',
          data: stats.weeklyRates.map(w => w.rate),
          borderColor: '#4a6cf7',
          backgroundColor: 'rgba(74, 108, 247, 0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  function renderCategoryChart(stats) {
    const ctx = document.getElementById('chart-categories');
    if (!ctx) return;
    const cats = Object.entries(stats.byCategory);
    const colors = ['#4a6cf7', '#28a745', '#ffc107', '#dc3545', '#6c757d', '#17a2b8', '#fd7e14', '#6610f2'];
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: cats.map(([c]) => c),
        datasets: [{
          label: 'Completion Rate %',
          data: cats.map(([, d]) => d.rate),
          backgroundColor: cats.map((_, i) => colors[i % colors.length] + '99'),
          borderColor: cats.map((_, i) => colors[i % colors.length]),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  function renderDayChart(stats) {
    const ctx = document.getElementById('chart-days');
    if (!ctx) return;
    const days = APP_CONFIG.daysShort;
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: days,
        datasets: [{
          label: 'Completion Rate %',
          data: days.map(d => stats.byDay[d].total > 0 ? Math.round(stats.byDay[d].completed / stats.byDay[d].total * 100) : 0),
          backgroundColor: 'rgba(74, 108, 247, 0.6)',
          borderColor: '#4a6cf7',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  // ============================================================
  // SETTINGS VIEW (combined Children + Admin)
  // ============================================================
  async function renderSettings(family) {
    const children = await Store.getChildren(family.id);
    const members = await Store.getFamilyMembers(family.id);
    const currentUid = Store.getCurrentUser().uid;

    // Check if worksheets exist (for locking week start)
    let hasWorksheets = false;
    try {
      const allWs = await Store.getWorksheets(family.id);
      hasWorksheets = allWs && allWs.length > 0;
    } catch (e) {}
    family.hasWorksheets = hasWorksheets;

    $main().innerHTML = html`
      <div class="page-header">
        <h1 class="page-title">Settings</h1>
      </div>
      <div class="alert-slot"></div>

      <!-- Children -->
      <div class="card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>Children</span>
          <button class="btn btn-primary btn-sm" id="btn-add-child">+ Add Child</button>
        </div>
        ${children.length === 0 ? html`
          <div class="empty-state" style="margin:12px 0">
            <p class="text-muted">No children added yet. Add a child to get started.</p>
          </div>
        ` : html`
          <div class="card-grid">
            ${children.map(child => html`
              <div class="child-card" data-child-id="${child.id}">
                <div>
                  <div class="child-name">${child.name}</div>
                  <div class="child-age">Age ${Store.getChildAge(child)}</div>
                </div>
                <div class="child-actions">
                  <a href="#/checklist/${child.id}" class="btn btn-sm btn-primary">Checklist</a>
                  <button class="btn btn-sm btn-outline btn-edit-child" data-id="${child.id}" data-name="${child.name}" data-age="${Store.getChildAge(child)}" data-birthday="${child.birthday || ''}">Edit</button>
                  <button class="btn btn-sm btn-danger btn-delete-child" data-id="${child.id}" data-name="${child.name}">Remove</button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <!-- Parents -->
      <div class="card">
        <div class="card-title">Parents</div>
        <p class="text-muted mb-2" style="font-size:0.85rem">All parents are administrators and have full access to manage children, worksheets, and settings.</p>
        <table class="data-table" id="members-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${members.map(m => html`
              <tr data-uid="${m.uid}">
                <td>
                  <strong>${m.displayName}</strong>
                  ${m.uid === currentUid ? '<span class="badge badge-info" style="margin-left:6px">You</span>' : ''}
                </td>
                <td>${m.email}</td>
                <td>
                  <button class="btn btn-sm btn-outline btn-edit-member" data-uid="${m.uid}" data-name="${m.displayName}" data-email="${m.email}">Edit</button>
                  <button class="btn btn-sm btn-outline btn-reset-pw" data-uid="${m.uid}" data-name="${m.displayName}">Reset Password</button>
                  ${m.uid !== currentUid ? html`<button class="btn btn-sm btn-danger btn-remove-member" data-uid="${m.uid}" data-name="${m.displayName}">Remove</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Family Settings -->
      <div class="card">
        <div class="card-title">Family Settings</div>
        <div class="form-group">
          <label>Family Name</label>
          <div class="flex gap-1 items-center">
            <input type="text" class="form-control" id="admin-family-name" value="${family.name}" style="max-width:300px">
            <button class="btn btn-primary btn-sm" id="btn-save-family-name">Save</button>
          </div>
        </div>
        <div class="form-group">
          <label>Family Join Code</label>
          <div class="flex gap-1 items-center">
            <code style="background:var(--bg);padding:8px 14px;border-radius:var(--radius);font-size:0.95rem;font-weight:600">${family.id}</code>
            <button class="btn btn-outline btn-sm" id="btn-copy-code">Copy</button>
          </div>
          <p class="text-muted mt-1" style="font-size:0.8rem">Share this code with your co-parent so they can join the family account.</p>
        </div>
        <div class="form-group">
          <label>Week Start Day</label>
          <p class="text-muted mb-2" style="font-size:0.85rem">Choose which day your week starts</p>
          <div style="display:flex;flex-direction:column;gap:8px">
            <label style="display:flex;align-items:center;cursor:pointer">
              <input type="radio" name="week-start" value="monday" ${(family.weekStart || 'monday') === 'monday' ? 'checked' : ''} ${family.hasWorksheets ? 'disabled' : ''}>
              <span style="margin-left:8px">Monday → Sunday</span>
            </label>
            <label style="display:flex;align-items:center;cursor:pointer">
              <input type="radio" name="week-start" value="sunday" ${(family.weekStart || 'monday') === 'sunday' ? 'checked' : ''} ${family.hasWorksheets ? 'disabled' : ''}>
              <span style="margin-left:8px">Sunday → Saturday</span>
            </label>
          </div>
          ${family.hasWorksheets ? html`
            <p class="text-warning mt-2" style="font-size:0.85rem">
              <strong>Setting locked:</strong> Cannot be changed after worksheets are created
            </p>
          ` : ''}
          <button class="btn btn-primary btn-sm mt-2" id="btn-save-week-start" ${family.hasWorksheets ? 'disabled' : ''}>Save</button>
        </div>
      </div>

      <!-- My Profile -->
      <div class="card">
        <div class="card-title">My Profile</div>
        <form id="profile-form">
          <div class="form-group">
            <label>Display Name</label>
            <input type="text" class="form-control" id="profile-name" value="${Store.getCurrentUser().displayName || ''}" style="max-width:300px">
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" class="form-control" id="profile-email" value="${Store.getCurrentUser().email}" style="max-width:300px">
            <p class="text-muted mt-1" style="font-size:0.8rem">Used for login and password recovery.</p>
          </div>
          <button type="submit" class="btn btn-primary">Save Profile</button>
        </form>
      </div>

      <!-- Change My Password -->
      <div class="card">
        <div class="card-title">Change My Password</div>
        <form id="change-pw-form">
          <div class="form-group">
            <label>Current Password</label>
            <input type="password" class="form-control" id="pw-current" required style="max-width:300px">
          </div>
          <div class="form-group">
            <label>New Password</label>
            <input type="password" class="form-control" id="pw-new" required minlength="6" style="max-width:300px">
          </div>
          <div class="form-group">
            <label>Confirm New Password</label>
            <input type="password" class="form-control" id="pw-confirm" required style="max-width:300px">
          </div>
          <button type="submit" class="btn btn-primary">Change Password</button>
        </form>
      </div>

      <!-- Legal -->
      <div class="card">
        <div style="display:flex;gap:16px;font-size:0.85rem">
          <a href="privacy.html" target="_blank">Privacy Policy</a>
          <a href="terms.html" target="_blank">Terms of Use</a>
        </div>
      </div>

      ${Store.getCurrentUser().email === 'stevehau@stevehau.com' ? html`
      <!-- Developer Tools (Steve only) -->
      <div class="card" style="border:1px dashed #e74c3c">
        <div class="card-title" style="color:#e74c3c">Developer Tools</div>
        <p class="text-muted mb-2" style="font-size:0.85rem">Only visible to stevehau@stevehau.com</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" id="btn-load-demo">Load Demo Data</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-worksheets" style="color:#e74c3c;border-color:#e74c3c">Delete All Worksheets</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-data" style="color:#e74c3c;border-color:#e74c3c">Clear All Local Data</button>
        </div>
      </div>
      ` : ''}
    `;

    // ---- Event Handlers ----

    // Developer tools (Steve only)
    if ($('#btn-load-demo')) {
      $('#btn-load-demo').addEventListener('click', async () => {
        if (!confirm('Load demo data? This will replace existing data.')) return;
        window.location.href = 'seed-data.html';
      });
    }
    if ($('#btn-clear-worksheets')) {
      $('#btn-clear-worksheets').addEventListener('click', async () => {
        if (!confirm('Delete ALL worksheets for this family? This cannot be undone.')) return;
        if (!confirm('Are you sure? All worksheet data, scan results, and history will be permanently deleted.')) return;
        try {
          const allWs = await Store.getWorksheets(family.id);
          let deleted = 0;
          for (const ws of allWs) {
            try {
              // For Firebase: delete directly via Firestore
              if (!USE_LOCAL_STORAGE && firebase && firebase.firestore) {
                await firebase.firestore().collection('worksheets').doc(ws.id).delete();
              }
              deleted++;
            } catch (e) { console.warn('Failed to delete worksheet:', ws.id, e); }
          }
          showAlert($main(), `Deleted ${deleted} worksheets.`, 'success');
          setTimeout(() => renderSettings(family), 1500);
        } catch (err) {
          showAlert($main(), 'Failed: ' + err.message);
        }
      });
    }
    if ($('#btn-clear-data')) {
      $('#btn-clear-data').addEventListener('click', async () => {
        if (!confirm('Clear ALL local data? This cannot be undone.')) return;
        Object.keys(localStorage).forEach(k => { if (k.startsWith('fc_')) localStorage.removeItem(k); });
        window.location.reload();
      });
    }

    // Children management
    $('#btn-add-child').addEventListener('click', () => showChildModal());
    document.querySelectorAll('.btn-edit-child').forEach(btn => {
      btn.addEventListener('click', () => {
        showChildModal(btn.dataset.id, btn.dataset.name, btn.dataset.age, btn.dataset.birthday);
      });
    });
    document.querySelectorAll('.btn-delete-child').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm(`Remove ${btn.dataset.name}? This will not delete existing worksheets.`)) {
          await Store.deleteChild(btn.dataset.id);
          renderSettings(family);
        }
      });
    });

    // Save family name
    $('#btn-save-family-name').addEventListener('click', async () => {
      try {
        const name = $('#admin-family-name').value.trim();
        if (!name) throw new Error('Family name cannot be empty.');
        await Store.updateFamilyName(family.id, name);
        family.name = name;
        showAlert($main(), 'Family name updated.', 'success');
      } catch (err) { showAlert($main(), err.message); }
    });

    // Copy join code
    $('#btn-copy-code').addEventListener('click', () => {
      navigator.clipboard.writeText(family.id).then(() => {
        showAlert($main(), 'Join code copied to clipboard.', 'success');
      }).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = family.id;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        showAlert($main(), 'Join code copied.', 'success');
      });
    });

    // Save week start day
    const btnSaveWeekStart = $('#btn-save-week-start');
    if (btnSaveWeekStart && !family.hasWorksheets) {
      btnSaveWeekStart.addEventListener('click', async () => {
        const weekStart = document.querySelector('input[name="week-start"]:checked').value;
        try {
          await Store.setWeekStart(family.id, weekStart);
          showAlert($main(), 'Week start day updated.', 'success');
          await renderSettings(family);
        } catch (err) { showAlert($main(), err.message); }
      });
    }

    // Edit member
    document.querySelectorAll('.btn-edit-member').forEach(btn => {
      btn.addEventListener('click', () => {
        showEditMemberModal(btn.dataset.uid, btn.dataset.name, btn.dataset.email, async () => {
          await renderSettings(family);
        });
      });
    });

    // Reset password
    document.querySelectorAll('.btn-reset-pw').forEach(btn => {
      btn.addEventListener('click', () => {
        showResetPasswordModal(btn.dataset.uid, btn.dataset.name);
      });
    });

    // Remove member
    document.querySelectorAll('.btn-remove-member').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm(`Remove ${btn.dataset.name} from the family? They will lose access to all family data.`)) {
          try {
            await Store.removeFamilyMember(family.id, btn.dataset.uid);
            showAlert($main(), `${btn.dataset.name} has been removed.`, 'success');
            await renderSettings(family);
          } catch (err) { showAlert($main(), err.message); }
        }
      });
    });

    // Save profile
    $('#profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await Store.updateUserProfile(currentUid, {
          displayName: $('#profile-name').value.trim(),
          email: $('#profile-email').value.trim()
        });
        document.getElementById('nav-username').textContent = $('#profile-name').value.trim();
        showAlert($main(), 'Profile updated.', 'success');
      } catch (err) { showAlert($main(), err.message); }
    });

    // Change password
    $('#change-pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const curr = $('#pw-current').value;
      const newPw = $('#pw-new').value;
      const conf = $('#pw-confirm').value;

      if (newPw !== conf) {
        showAlert($main(), 'New passwords do not match.');
        return;
      }
      if (newPw.length < 6) {
        showAlert($main(), 'Password must be at least 6 characters.');
        return;
      }

      try {
        // Verify current password by attempting sign-in
        const user = Store.getCurrentUser();
        await Store.signIn(user.email, curr);
        await Store.adminResetPassword(currentUid, newPw);
        showAlert($main(), 'Password changed successfully.', 'success');
        $('#pw-current').value = '';
        $('#pw-new').value = '';
        $('#pw-confirm').value = '';
      } catch (err) {
        showAlert($main(), 'Current password is incorrect.');
      }
    });
  }

  function showEditMemberModal(uid, name, email, onSave) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = html`
      <div class="modal">
        <div class="modal-title">Edit Member: ${name}</div>
        <div class="alert-slot"></div>
        <form id="edit-member-form">
          <div class="form-group">
            <label>Display Name</label>
            <input type="text" class="form-control" id="em-name" value="${name}" required>
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" class="form-control" id="em-email" value="${email}" required>
            <p class="text-muted mt-1" style="font-size:0.8rem">Used for login and password recovery.</p>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline btn-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#edit-member-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await Store.updateUserProfile(uid, {
          displayName: overlay.querySelector('#em-name').value.trim(),
          email: overlay.querySelector('#em-email').value.trim()
        });
        overlay.remove();
        if (onSave) onSave();
      } catch (err) {
        showAlert(overlay.querySelector('.modal'), err.message);
      }
    });
  }

  function showResetPasswordModal(uid, name) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = html`
      <div class="modal">
        <div class="modal-title">Reset Password for ${name}</div>
        <div class="alert-slot"></div>
        <form id="reset-pw-form">
          <div class="form-group">
            <label>New Temporary Password</label>
            <input type="text" class="form-control" id="rp-new-pw" required minlength="6" placeholder="Enter a temporary password">
            <p class="text-muted mt-1" style="font-size:0.8rem">Set a temporary password, then share it with ${name} securely. They should change it after logging in via Admin > Change My Password.</p>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline btn-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Reset Password</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#reset-pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const newPw = overlay.querySelector('#rp-new-pw').value;
      if (newPw.length < 6) {
        showAlert(overlay.querySelector('.modal'), 'Password must be at least 6 characters.');
        return;
      }
      try {
        await Store.adminResetPassword(uid, newPw);
        overlay.remove();
        alert(`Password for ${name} has been reset to the temporary password you entered. Please share it with them securely.`);
      } catch (err) {
        showAlert(overlay.querySelector('.modal'), err.message);
      }
    });
  }

  // ============================================================
  // DRAFT EDITOR VIEW
  // ============================================================
  async function renderDraftEditor(family, worksheetId) {
    const worksheet = await Store.getWorksheet(worksheetId);
    if (!worksheet) {
      $main().innerHTML = '<div class="alert alert-danger">Worksheet not found.</div>';
      return;
    }

    const children = await Store.getChildren(family.id);
    const child = children.find(c => c.id === worksheet.childId);
    const tasks = await Store.getTaskTemplates(family.id, worksheet.childId);

    // Check if worksheet is locked
    const isLocked = ['published', 'printed', 'scanned', 'reviewed'].includes(worksheet.status);

    $main().innerHTML = html`
      <div class="page-header">
        <div>
          <h1 class="page-title">${isLocked ? '🔒' : ''} Worksheet Draft Editor</h1>
          <p class="text-muted">
            ${child?.name} - Week ${worksheet.weekNumber}, ${worksheet.year} (${worksheet.weekStartDate})
          </p>
          ${isLocked ? html`<p class="text-warning"><strong>This worksheet is locked and cannot be edited.</strong></p>` : ''}
          ${worksheet.lastEditedBy ? html`<p class="text-muted" style="font-size:0.85rem">Last edited by ${worksheet.lastEditedBy} on ${new Date(worksheet.lastEditedAt).toLocaleString()}</p>` : ''}
        </div>
        <a href="#/worksheet/${worksheet.childId}" class="btn btn-outline btn-sm">Back to Worksheets</a>
      </div>
      <div class="alert-slot"></div>

      <div class="card">
        <div class="card-title">Items in Draft</div>
        ${isLocked ? html`
          <div class="alert alert-warning">
            This worksheet has been published or printed and is now locked. You cannot make changes to it.
          </div>
        ` : html`
          <div class="draft-items-editor" id="draft-items-editor">
            ${worksheet.items && worksheet.items.length > 0 ? html`
              <div class="items-list">
                ${worksheet.items.map((item, idx) => html`
                  <div class="item-row" data-index="${idx}">
                    <div class="item-drag-handle">⋮⋮</div>
                    <div class="item-content">
                      <div class="item-text">${item.text}</div>
                      <div class="item-meta">
                        <span class="badge badge-outline">${item.category}</span>
                        <span class="badge badge-outline">Priority: ${item.priority}</span>
                      </div>
                    </div>
                    <button class="btn btn-sm btn-outline btn-remove-item" data-index="${idx}" data-tooltip="Remove item">Remove</button>
                  </div>
                `).join('')}
              </div>
            ` : html`
              <p class="text-muted">No items in this draft yet.</p>
            `}
          </div>
        `}
      </div>

      <div class="card">
        <div class="card-title">Available Tasks</div>
        <div class="tasks-selector">
          ${tasks.length === 0 ? html`
            <p class="text-muted">No checklist items available. <a href="#/checklist/${worksheet.childId}">Add items to the checklist first</a>.</p>
          ` : html`
            ${tasks.map(task => {
              const isInDraft = worksheet.items?.some(item => item.taskId === task.id);
              return html`
                <div class="task-card">
                  <div class="task-text">${task.text}</div>
                  <div class="task-meta">
                    <span class="badge badge-outline">${task.category}</span>
                    <span class="badge badge-outline">Priority: ${task.priority}</span>
                  </div>
                  ${isInDraft ? html`
                    <span class="text-success" style="font-size:0.85rem">✓ In draft</span>
                  ` : html`
                    <button class="btn btn-sm btn-primary btn-add-item" data-task-id="${task.id}" data-task-text="${task.text}" data-task-category="${task.category}" data-task-priority="${task.priority}" data-tooltip="Add to draft">Add</button>
                  `}
                </div>
              `;
            }).join('')}
          `}
        </div>
      </div>

      ${!isLocked ? html`
        <div class="card">
          <div class="form-actions">
            <button class="btn btn-secondary" id="btn-discard-draft" data-tooltip="Discard changes">Discard Draft</button>
            <button class="btn btn-primary" id="btn-save-draft" data-tooltip="Save draft changes">Save Draft</button>
            <button class="btn btn-success" id="btn-publish-draft" data-tooltip="Publish and lock this worksheet, then generate PDF">Publish & Print PDF</button>
          </div>
        </div>
      ` : ''}
    `;

    // Add item button handlers
    if (!isLocked) {
      document.querySelectorAll('.btn-add-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const taskId = btn.dataset.taskId;
          const taskText = btn.dataset.taskText;
          const taskCategory = btn.dataset.taskCategory;
          const taskPriority = btn.dataset.taskPriority;
          const newItem = { id: taskId, text: taskText, category: taskCategory, priority: taskPriority };
          worksheet.items.push(newItem);
          renderDraftEditor(family, worksheetId); // refresh
        });
      });

      // Remove item button handlers
      document.querySelectorAll('.btn-remove-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.index);
          worksheet.items.splice(idx, 1);
          renderDraftEditor(family, worksheetId); // refresh
        });
      });

      // Save draft button
      if ($('#btn-save-draft')) {
        $('#btn-save-draft').addEventListener('click', async () => {
          const btn = $('#btn-save-draft');
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner"></span> Saving...';

          try {
            await Store.saveDraftWorksheet(family.id, worksheet.childId, worksheet.childName, worksheet.year, worksheet.weekNumber, worksheet.items);
            showAlert($main(), 'Draft saved successfully!', 'success');
            setTimeout(() => renderDraftEditor(family, worksheetId), 1500);
          } catch (err) {
            showAlert($main(), err.message);
            btn.disabled = false;
            btn.textContent = 'Save Draft';
          }
        });
      }

      // Discard draft button
      if ($('#btn-discard-draft')) {
        $('#btn-discard-draft').addEventListener('click', () => {
          if (confirm('Are you sure you want to discard this draft? Changes will be lost.')) {
            window.location.hash = `#/worksheet/${worksheet.childId}`;
          }
        });
      }

      // Publish draft button
      if ($('#btn-publish-draft')) {
        $('#btn-publish-draft').addEventListener('click', async () => {
          if (!requireVerifiedEmail($main())) return;
          // Check if previous week's worksheet has been submitted
          const prevWeekNumber = worksheet.weekNumber === 1 ? 53 : worksheet.weekNumber - 1;
          const prevYear = worksheet.weekNumber === 1 ? worksheet.year - 1 : worksheet.year;
          const prevWs = await Store.getWorksheetByWeek(family.id, worksheet.childId, prevYear, prevWeekNumber);

          if (prevWs && prevWs.status !== 'scanned' && prevWs.status !== 'reviewed') {
            // Show warning modal
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.innerHTML = html`
              <div class="modal">
                <div class="modal-title">Previous Week Not Submitted</div>
                <p class="text-muted mb-3">Last week's worksheet hasn't been submitted yet. Submitting it first will include last week's results on this week's printout for better gamification.</p>
                <div style="display:flex;gap:8px">
                  <button class="btn btn-primary" id="modal-submit-last">Submit Last Week First</button>
                  <button class="btn btn-outline" id="modal-print-anyway">Print Anyway</button>
                </div>
              </div>
            `;
            document.body.appendChild(overlay);

            let shouldProceed = false;

            $('#modal-submit-last').addEventListener('click', () => {
              overlay.remove();
              window.location.hash = '#/submit';
            });

            $('#modal-print-anyway').addEventListener('click', () => {
              overlay.remove();
              proceedWithPublish();
            });

            return;
          }

          if (!confirm('Once published, this worksheet cannot be edited. Items will be locked. Continue?')) {
            return;
          }

          proceedWithPublish();

          async function proceedWithPublish() {
            const btn = $('#btn-publish-draft');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Publishing...';

            try {
              // Save draft first
              await Store.saveDraftWorksheet(family.id, worksheet.childId, worksheet.childName, worksheet.year, worksheet.weekNumber, worksheet.items);
              // Then publish
              const published = await Store.publishWorksheet(worksheetId);
              // Generate PDF
              const prevWs = await Store.getPreviousReviewedWorksheet(family.id, worksheet.childId, worksheetId);
              const weeklyHistory = await buildWeeklyHistory(family.id, worksheet.childId, published.year);
              await PDFGenerator.generateAndDownload(published, prevWs, weeklyHistory);
              // Mark as printed
              await Store.updateWorksheet(worksheetId, { status: 'printed' });
              showAlert($main(), `Worksheet published! Form ID: ${published.serialNumber}`, 'success');
              setTimeout(() => window.location.hash = `#/worksheet/${worksheet.childId}`, 2000);
            } catch (err) {
              showAlert($main(), err.message);
              btn.disabled = false;
              btn.textContent = 'Publish & Print PDF';
            }
          }
        });
      }
    }
  }

  // ---- Public API ----
  return {
    renderLogin,
    renderRegister,
    renderResetPassword,
    renderFamilySetup,
    renderDashboard,
    renderChildren,
    renderChecklist,
    renderWorksheet,
    renderDraftEditor,
    renderResultsEntry,
    renderScanner,
    renderAnalytics,
    renderAdmin: renderSettings,
    renderSettings
  };
})();
