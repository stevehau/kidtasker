// ============================================================
// Data Store - Abstracts Firebase/localStorage
// ============================================================

const Store = (() => {
  let db = null;
  let auth = null;
  let currentUser = null;
  let onAuthChange = null;

  // ---- Utility ----
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  function getMondayOfWeek(year, weekNum) {
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
    return monday;
  }

  function getSundayOfWeek(year, weekNum) {
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const sunday = new Date(jan4);
    sunday.setDate(jan4.getDate() - dayOfWeek + (weekNum - 1) * 7);
    return sunday;
  }

  function formatDate(date) {
    return date.toISOString().split('T')[0];
  }

  function generateSerial(childName, year, weekNum) {
    const hash = Math.random().toString(36).slice(2, 6).toUpperCase();
    const initials = childName.slice(0, 3).toUpperCase();
    return `WSH-${initials}-${year}-W${String(weekNum).padStart(2, '0')}-${hash}`;
  }

  // ---- LocalStorage Backend ----
  const LocalBackend = {
    _get(key) {
      try {
        return JSON.parse(localStorage.getItem(`fc_${key}`) || 'null');
      } catch { return null; }
    },
    _set(key, val) {
      localStorage.setItem(`fc_${key}`, JSON.stringify(val));
    },
    _getCollection(name) {
      return this._get(name) || [];
    },
    _saveCollection(name, data) {
      this._set(name, data);
    },

    // Auth
    async signUp(email, password, displayName) {
      const users = this._getCollection('users');
      if (users.find(u => u.email === email)) {
        throw new Error('An account with this email already exists.');
      }
      const user = {
        uid: generateId(),
        email,
        password: btoa(password), // simple obfuscation, not real security
        displayName,
        createdAt: new Date().toISOString()
      };
      users.push(user);
      this._saveCollection('users', users);
      currentUser = { uid: user.uid, email: user.email, displayName: user.displayName };
      this._set('currentUser', currentUser);
      if (onAuthChange) onAuthChange(currentUser);
      return currentUser;
    },

    async signIn(email, password) {
      const users = this._getCollection('users');
      const user = users.find(u => u.email === email && u.password === btoa(password));
      if (!user) throw new Error('Invalid email or password.');
      currentUser = { uid: user.uid, email: user.email, displayName: user.displayName };
      this._set('currentUser', currentUser);
      if (onAuthChange) onAuthChange(currentUser);
      return currentUser;
    },

    async signOut() {
      currentUser = null;
      localStorage.removeItem('fc_currentUser');
      if (onAuthChange) onAuthChange(null);
    },

    async resetPassword(email) {
      const users = this._getCollection('users');
      if (!users.find(u => u.email === email)) {
        throw new Error('No account found with that email.');
      }
      // In local mode, just show a message
      alert('In local demo mode, password reset is not functional.\nFor Firebase mode, a reset email would be sent.');
    },

    getCurrentUser() {
      if (currentUser) return currentUser;
      currentUser = this._get('currentUser');
      return currentUser;
    },

    // Family
    async getFamily(userId) {
      const families = this._getCollection('families');
      const membership = families.find(f => f.members.includes(userId));
      return membership || null;
    },

    async createFamily(name, userId) {
      const families = this._getCollection('families');
      const family = {
        id: generateId(),
        name,
        members: [userId],
        weekStart: 'monday',
        createdAt: new Date().toISOString()
      };
      families.push(family);
      this._saveCollection('families', families);
      return family;
    },

    async joinFamily(familyId, userId) {
      const families = this._getCollection('families');
      const fam = families.find(f => f.id === familyId);
      if (!fam) throw new Error('Family not found.');
      if (!fam.members.includes(userId)) fam.members.push(userId);
      this._saveCollection('families', families);
      return fam;
    },

    async getFamilyByCode(code) {
      const families = this._getCollection('families');
      return families.find(f => f.id === code) || null;
    },

    async setWeekStart(familyId, weekStart) {
      if (!['monday', 'sunday'].includes(weekStart)) {
        throw new Error('Week start must be "monday" or "sunday".');
      }
      
      const families = this._getCollection('families');
      const familyIdx = families.findIndex(f => f.id === familyId);
      if (familyIdx < 0) throw new Error('Family not found.');
      
      // Check if any worksheets exist for this family
      const worksheets = this._getCollection('worksheets');
      const hasWorksheets = worksheets.some(w => w.familyId === familyId);
      if (hasWorksheets) {
        throw new Error('Week start day cannot be changed after worksheets have been created');
      }
      
      families[familyIdx].weekStart = weekStart;
      this._saveCollection('families', families);
      return families[familyIdx];
    },

    // Children
    async getChildren(familyId) {
      const children = this._getCollection('children');
      return children.filter(c => c.familyId === familyId).sort((a, b) => a.name.localeCompare(b.name));
    },

    async addChild(familyId, name, age, birthday) {
      const children = this._getCollection('children');
      const child = {
        id: generateId(),
        familyId,
        name,
        age: birthday ? Store.calcAge(birthday) : parseInt(age),
        birthday: birthday || null,
        createdAt: new Date().toISOString()
      };
      children.push(child);
      this._saveCollection('children', children);

      // Auto-populate default tasks
      if (APP_CONFIG.defaultTasks && APP_CONFIG.defaultTasks.length > 0) {
        const templates = this._getCollection('taskTemplates');
        for (const dt of APP_CONFIG.defaultTasks) {
          templates.push({
            id: generateId(),
            familyId,
            childId: child.id,
            text: dt.text,
            category: dt.category || 'Other',
            priority: dt.priority || 'B',
            daysApplicable: dt.daysApplicable || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
            isActive: true,
            createdAt: new Date().toISOString()
          });
        }
        this._saveCollection('taskTemplates', templates);
      }

      return child;
    },

    async updateChild(childId, updates) {
      const children = this._getCollection('children');
      const idx = children.findIndex(c => c.id === childId);
      if (idx >= 0) {
        Object.assign(children[idx], updates);
        this._saveCollection('children', children);
      }
      return children[idx];
    },

    async deleteChild(childId) {
      let children = this._getCollection('children');
      children = children.filter(c => c.id !== childId);
      this._saveCollection('children', children);
    },

    // Task Templates
    async getTaskTemplates(familyId, childId) {
      const templates = this._getCollection('taskTemplates');
      return templates.filter(t => t.familyId === familyId && t.childId === childId);
    },

    async addTaskTemplate(familyId, childId, text, category, priority, daysApplicable) {
      const templates = this._getCollection('taskTemplates');
      const task = {
        id: generateId(),
        familyId,
        childId,
        text,
        category: category || 'Other',
        priority: priority || 'B',
        daysApplicable: daysApplicable || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
        isActive: true,
        createdAt: new Date().toISOString()
      };
      templates.push(task);
      this._saveCollection('taskTemplates', templates);
      return task;
    },

    async updateTaskTemplate(taskId, updates) {
      const templates = this._getCollection('taskTemplates');
      const idx = templates.findIndex(t => t.id === taskId);
      if (idx >= 0) {
        Object.assign(templates[idx], updates);
        this._saveCollection('taskTemplates', templates);
      }
      return templates[idx];
    },

    async deleteTaskTemplate(taskId) {
      let templates = this._getCollection('taskTemplates');
      templates = templates.filter(t => t.id !== taskId);
      this._saveCollection('taskTemplates', templates);
    },

    // Worksheets
    async getWorksheet(worksheetId) {
      const worksheets = this._getCollection('worksheets');
      return worksheets.find(w => w.id === worksheetId) || null;
    },

    async getWorksheetBySerial(serial) {
      const worksheets = this._getCollection('worksheets');
      return worksheets.find(w => w.serialNumber === serial) || null;
    },

    async getWorksheets(familyId, childId, year, weekNum) {
      const worksheets = this._getCollection('worksheets');
      return worksheets.filter(w => {
        let match = w.familyId === familyId;
        if (childId) match = match && w.childId === childId;
        if (year) match = match && w.year === year;
        if (weekNum) match = match && w.weekNumber === weekNum;
        return match;
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async getChildWorksheets(childId) {
      const worksheets = this._getCollection('worksheets');
      return worksheets.filter(w => w.childId === childId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async createWorksheet(familyId, childId, childName, year, weekNum, items) {
      const worksheets = this._getCollection('worksheets');
      const families = this._getCollection('families');
      const family = families.find(f => f.id === familyId);
      const weekStart = family ? family.weekStart || 'monday' : 'monday';
      
      const weekStartDate = weekStart === 'sunday' ? getSundayOfWeek(year, weekNum) : getMondayOfWeek(year, weekNum);
      const serial = generateSerial(childName, year, weekNum);

      const worksheet = {
        id: generateId(),
        serialNumber: serial,
        familyId,
        childId,
        childName,
        year,
        month: weekStartDate.toLocaleString('default', { month: 'long' }),
        weekNumber: weekNum,
        weekStartDate: formatDate(weekStartDate),
        items: items.map((item, i) => ({
          index: i,
          taskId: item.id || null,
          text: item.text,
          category: item.category || 'Other',
          priority: item.priority || 'B',
          daysApplicable: item.daysApplicable || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
          results: {} // { Mon: { completed: false, confirmed: false }, ... }
        })),
        status: 'draft', // draft, printed, scanned, reviewed
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      worksheets.push(worksheet);
      this._saveCollection('worksheets', worksheets);
      return worksheet;
    },

    async updateWorksheet(worksheetId, updates) {
      const worksheets = this._getCollection('worksheets');
      const idx = worksheets.findIndex(w => w.id === worksheetId);
      if (idx >= 0) {
        const ws = worksheets[idx];
        // If worksheet is locked, only allow status transitions (not item edits)
        const locked = ['published', 'printed', 'scanned', 'reviewed'].includes(ws.status);
        if (locked && updates.items) {
          throw new Error('This worksheet is locked and its items cannot be edited.');
        }
        Object.assign(ws, updates, { updatedAt: new Date().toISOString() });
        this._saveCollection('worksheets', worksheets);
      }
      return worksheets[idx];
    },

    async getDraftWorksheet(familyId, childId, year, weekNum) {
      const worksheets = this._getCollection('worksheets');
      return worksheets.find(w =>
        w.familyId === familyId &&
        w.childId === childId &&
        w.year === year &&
        w.weekNumber === weekNum &&
        w.status === 'draft'
      ) || null;
    },

    async saveDraftWorksheet(familyId, childId, childName, year, weekNum, items) {
      const worksheets = this._getCollection('worksheets');
      const currentUser = this.getCurrentUser();
      const now = new Date().toISOString();

      // Look for existing draft
      const existingIdx = worksheets.findIndex(w =>
        w.familyId === familyId &&
        w.childId === childId &&
        w.year === year &&
        w.weekNumber === weekNum &&
        w.status === 'draft'
      );

      if (existingIdx >= 0) {
        // Update existing draft
        const ws = worksheets[existingIdx];
        ws.items = items.map((item, i) => ({
          index: i,
          taskId: item.id || item.taskId || null,
          text: item.text,
          category: item.category || 'Other',
          priority: item.priority || 'B',
          daysApplicable: item.daysApplicable || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
          results: item.results || {}
        }));
        ws.lastEditedBy = currentUser?.displayName || 'Unknown';
        ws.lastEditedAt = now;
        ws.updatedAt = now;
        this._saveCollection('worksheets', worksheets);
        return ws;
      } else {
        // Create new draft
        const families = this._getCollection('families');
        const family = families.find(f => f.id === familyId);
        const weekStart = family ? family.weekStart || 'monday' : 'monday';
        
        const weekStartDate = weekStart === 'sunday' ? getSundayOfWeek(year, weekNum) : getMondayOfWeek(year, weekNum);
        const serial = generateSerial(childName, year, weekNum);
        const worksheet = {
          id: generateId(),
          serialNumber: serial,
          familyId,
          childId,
          childName,
          year,
          month: weekStartDate.toLocaleString('default', { month: 'long' }),
          weekNumber: weekNum,
          weekStartDate: formatDate(weekStartDate),
          items: items.map((item, i) => ({
            index: i,
            taskId: item.id || item.taskId || null,
            text: item.text,
            category: item.category || 'Other',
            priority: item.priority || 'B',
            daysApplicable: item.daysApplicable || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
            results: item.results || {}
          })),
          status: 'draft',
          lastEditedBy: currentUser?.displayName || 'Unknown',
          lastEditedAt: now,
          createdAt: now,
          updatedAt: now
        };
        worksheets.push(worksheet);
        this._saveCollection('worksheets', worksheets);
        return worksheet;
      }
    },

    async publishWorksheet(worksheetId) {
      const worksheets = this._getCollection('worksheets');
      const idx = worksheets.findIndex(w => w.id === worksheetId);
      if (idx < 0) throw new Error('Worksheet not found');

      const ws = worksheets[idx];
      if (ws.status !== 'draft') {
        throw new Error('Only draft worksheets can be published.');
      }

      // Deep copy items to freeze them
      ws.items = JSON.parse(JSON.stringify(ws.items));
      ws.status = 'published';
      ws.publishedAt = new Date().toISOString();
      ws.updatedAt = new Date().toISOString();

      this._saveCollection('worksheets', worksheets);
      return ws;
    },

    async saveOCRResults(worksheetId, ocrResults, reviewedBy) {
      const worksheets = this._getCollection('worksheets');
      const idx = worksheets.findIndex(w => w.id === worksheetId);
      if (idx < 0) throw new Error('Worksheet not found');

      const ws = worksheets[idx];
      // Merge OCR results into items
      if (ocrResults.items) {
        ocrResults.items.forEach(ocrItem => {
          const wsItem = ws.items[ocrItem.index];
          if (wsItem) {
            wsItem.results = ocrItem.results || wsItem.results;
          }
        });
      }
      ws.status = 'scanned';
      ws.scanDate = new Date().toISOString();
      ws.scanReviewedBy = reviewedBy;
      ws.updatedAt = new Date().toISOString();

      this._saveCollection('worksheets', worksheets);
      return ws;
    },

    // Get the most recent worksheet for a child to copy tasks from
    async getLastWorksheet(familyId, childId) {
      const worksheets = this._getCollection('worksheets');
      const childSheets = worksheets
        .filter(w => w.familyId === familyId && w.childId === childId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return childSheets[0] || null;
    },

    // Get the most recent reviewed/scanned worksheet (for gamification stats)
    async getPreviousReviewedWorksheet(familyId, childId, excludeId) {
      const worksheets = this._getCollection('worksheets');
      const childSheets = worksheets
        .filter(w => w.familyId === familyId && w.childId === childId && w.id !== excludeId && (w.status === 'reviewed' || w.status === 'scanned'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return childSheets[0] || null;
    },

    // Analytics helpers
    async getAnalyticsData(familyId, childId, startDate, endDate) {
      const worksheets = this._getCollection('worksheets');
      return worksheets.filter(w => {
        let match = w.familyId === familyId;
        if (childId) match = match && w.childId === childId;
        if (startDate) match = match && w.weekStartDate >= startDate;
        if (endDate) match = match && w.weekStartDate <= endDate;
        return match && (w.status === 'scanned' || w.status === 'reviewed');
      }).sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
    },

    // ---- Admin / User Management ----
    async getFamilyMembers(familyId) {
      const families = this._getCollection('families');
      const fam = families.find(f => f.id === familyId);
      if (!fam) return [];
      const users = this._getCollection('users');
      return fam.members.map(uid => {
        const u = users.find(usr => usr.uid === uid);
        return u ? { uid: u.uid, email: u.email, displayName: u.displayName, realEmail: u.realEmail || '' } : { uid, email: 'Unknown', displayName: 'Unknown', realEmail: '' };
      });
    },

    async updateUserProfile(uid, updates) {
      const users = this._getCollection('users');
      const idx = users.findIndex(u => u.uid === uid);
      if (idx < 0) throw new Error('User not found.');
      if (updates.displayName) users[idx].displayName = updates.displayName;
      if (updates.realEmail !== undefined) users[idx].realEmail = updates.realEmail;
      if (updates.email) {
        // Check email uniqueness
        if (users.find((u, i) => i !== idx && u.email === updates.email)) {
          throw new Error('That login email is already in use.');
        }
        users[idx].email = updates.email;
      }
      this._saveCollection('users', users);
      // Update currentUser if it's the logged-in user
      if (currentUser && currentUser.uid === uid) {
        currentUser.displayName = users[idx].displayName;
        currentUser.email = users[idx].email;
        this._set('currentUser', currentUser);
      }
      return { uid: users[idx].uid, email: users[idx].email, displayName: users[idx].displayName, realEmail: users[idx].realEmail || '' };
    },

    async adminResetPassword(uid, newPassword) {
      const users = this._getCollection('users');
      const idx = users.findIndex(u => u.uid === uid);
      if (idx < 0) throw new Error('User not found.');
      users[idx].password = btoa(newPassword);
      this._saveCollection('users', users);
    },

    async updateFamilyName(familyId, name) {
      const families = this._getCollection('families');
      const idx = families.findIndex(f => f.id === familyId);
      if (idx < 0) throw new Error('Family not found.');
      families[idx].name = name;
      this._saveCollection('families', families);
      return families[idx];
    },

    async removeFamilyMember(familyId, uid) {
      const families = this._getCollection('families');
      const fam = families.find(f => f.id === familyId);
      if (!fam) throw new Error('Family not found.');
      if (fam.members.length <= 1) throw new Error('Cannot remove the last member.');
      fam.members = fam.members.filter(m => m !== uid);
      this._saveCollection('families', families);
      return fam;
    }
  };

  // ---- Firebase Backend ----
  const FirebaseBackend = {
    async signUp(email, password, displayName) {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName });
      currentUser = { uid: cred.user.uid, email: cred.user.email, displayName };
      return currentUser;
    },

    async signIn(email, password) {
      const cred = await auth.signInWithEmailAndPassword(email, password);
      currentUser = {
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName
      };
      return currentUser;
    },

    async signOut() {
      await auth.signOut();
      currentUser = null;
    },

    async resetPassword(email) {
      await auth.sendPasswordResetEmail(email);
    },

    getCurrentUser() {
      const u = auth.currentUser;
      if (u) {
        currentUser = { uid: u.uid, email: u.email, displayName: u.displayName };
      }
      return currentUser;
    },

    async getFamily(userId) {
      const snap = await db.collection('families').where('members', 'array-contains', userId).limit(1).get();
      if (snap.empty) return null;
      return { id: snap.docs[0].id, ...snap.docs[0].data() };
    },

    async createFamily(name, userId) {
      const ref = await db.collection('families').add({
        name, members: [userId], weekStart: 'monday', createdAt: new Date().toISOString()
      });
      return { id: ref.id, name, members: [userId], weekStart: 'monday' };
    },

    async joinFamily(familyId, userId) {
      await db.collection('families').doc(familyId).update({
        members: firebase.firestore.FieldValue.arrayUnion(userId)
      });
      const doc = await db.collection('families').doc(familyId).get();
      return { id: doc.id, ...doc.data() };
    },

    async getFamilyByCode(code) {
      const doc = await db.collection('families').doc(code).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    },

    async setWeekStart(familyId, weekStart) {
      if (!['monday', 'sunday'].includes(weekStart)) {
        throw new Error('Week start must be "monday" or "sunday".');
      }
      
      const famDoc = await db.collection('families').doc(familyId).get();
      if (!famDoc.exists) throw new Error('Family not found.');
      
      // Check if any worksheets exist for this family
      const worksheetSnap = await db.collection('worksheets')
        .where('familyId', '==', familyId).limit(1).get();
      if (!worksheetSnap.empty) {
        throw new Error('Week start day cannot be changed after worksheets have been created');
      }
      
      await db.collection('families').doc(familyId).update({ weekStart });
      const doc = await db.collection('families').doc(familyId).get();
      return { id: doc.id, ...doc.data() };
    },

    async getChildren(familyId) {
      const snap = await db.collection('children').where('familyId', '==', familyId).orderBy('name').get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async addChild(familyId, name, age, birthday) {
      const data = {
        familyId, name,
        age: birthday ? Store.calcAge(birthday) : parseInt(age),
        birthday: birthday || null,
        createdAt: new Date().toISOString()
      };
      const ref = await db.collection('children').add(data);
      const child = { id: ref.id, ...data };

      // Auto-populate default tasks
      if (APP_CONFIG.defaultTasks && APP_CONFIG.defaultTasks.length > 0) {
        const batch = db.batch();
        for (const dt of APP_CONFIG.defaultTasks) {
          const taskRef = db.collection('taskTemplates').doc();
          batch.set(taskRef, {
            familyId,
            childId: child.id,
            text: dt.text,
            category: dt.category || 'Other',
            priority: dt.priority || 'B',
            daysApplicable: dt.daysApplicable || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
            isActive: true,
            createdAt: new Date().toISOString()
          });
        }
        await batch.commit();
      }

      return child;
    },

    async updateChild(childId, updates) {
      await db.collection('children').doc(childId).update(updates);
      const doc = await db.collection('children').doc(childId).get();
      return { id: doc.id, ...doc.data() };
    },

    async deleteChild(childId) {
      await db.collection('children').doc(childId).delete();
    },

    async getTaskTemplates(familyId, childId) {
      const snap = await db.collection('taskTemplates')
        .where('familyId', '==', familyId)
        .where('childId', '==', childId).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async addTaskTemplate(familyId, childId, text, category, priority, daysApplicable) {
      const data = {
        familyId, childId, text, category: category || 'Other',
        priority: priority || 'B',
        daysApplicable: daysApplicable || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
        isActive: true, createdAt: new Date().toISOString()
      };
      const ref = await db.collection('taskTemplates').add(data);
      return { id: ref.id, ...data };
    },

    async updateTaskTemplate(taskId, updates) {
      await db.collection('taskTemplates').doc(taskId).update(updates);
      const doc = await db.collection('taskTemplates').doc(taskId).get();
      return { id: doc.id, ...doc.data() };
    },

    async deleteTaskTemplate(taskId) {
      await db.collection('taskTemplates').doc(taskId).delete();
    },

    async getWorksheet(worksheetId) {
      const doc = await db.collection('worksheets').doc(worksheetId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    },

    async getWorksheetBySerial(serial) {
      const snap = await db.collection('worksheets')
        .where('serialNumber', '==', serial).limit(1).get();
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    },

    async getWorksheets(familyId, childId, year, weekNum) {
      let q = db.collection('worksheets').where('familyId', '==', familyId);
      if (childId) q = q.where('childId', '==', childId);
      if (year) q = q.where('year', '==', year);
      if (weekNum) q = q.where('weekNumber', '==', weekNum);
      const snap = await q.orderBy('createdAt', 'desc').get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async getChildWorksheets(childId) {
      const snap = await db.collection('worksheets')
        .where('childId', '==', childId)
        .orderBy('createdAt', 'desc').get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async createWorksheet(familyId, childId, childName, year, weekNum, items) {
      const famDoc = await db.collection('families').doc(familyId).get();
      const family = famDoc.exists ? famDoc.data() : {};
      const weekStart = family.weekStart || 'monday';
      
      const weekStartDate = weekStart === 'sunday' ? getSundayOfWeek(year, weekNum) : getMondayOfWeek(year, weekNum);
      const serial = generateSerial(childName, year, weekNum);
      const data = {
        serialNumber: serial, familyId, childId, childName, year,
        month: weekStartDate.toLocaleString('default', { month: 'long' }),
        weekNumber: weekNum, weekStartDate: formatDate(weekStartDate),
        items: items.map((item, i) => ({
          index: i, taskId: item.id || null, text: item.text,
          category: item.category || 'Other', priority: item.priority || 'B',
          daysApplicable: item.daysApplicable || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
          results: {}
        })),
        status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      const ref = await db.collection('worksheets').add(data);
      return { id: ref.id, ...data };
    },

    async updateWorksheet(worksheetId, updates) {
      const doc = await db.collection('worksheets').doc(worksheetId).get();
      if (!doc.exists) throw new Error('Worksheet not found');
      const ws = doc.data();
      // If worksheet is locked, only allow status transitions (not item edits)
      const locked = ['published', 'printed', 'scanned', 'reviewed'].includes(ws.status);
      if (locked && updates.items) {
        throw new Error('This worksheet is locked and its items cannot be edited.');
      }
      updates.updatedAt = new Date().toISOString();
      await db.collection('worksheets').doc(worksheetId).update(updates);
      const updatedDoc = await db.collection('worksheets').doc(worksheetId).get();
      return { id: updatedDoc.id, ...updatedDoc.data() };
    },

    async getDraftWorksheet(familyId, childId, year, weekNum) {
      const snap = await db.collection('worksheets')
        .where('familyId', '==', familyId)
        .where('childId', '==', childId)
        .where('year', '==', year)
        .where('weekNumber', '==', weekNum)
        .where('status', '==', 'draft')
        .limit(1).get();
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    },

    async saveDraftWorksheet(familyId, childId, childName, year, weekNum, items) {
      const currentUser = this.getCurrentUser();
      const now = new Date().toISOString();

      // Look for existing draft
      const snap = await db.collection('worksheets')
        .where('familyId', '==', familyId)
        .where('childId', '==', childId)
        .where('year', '==', year)
        .where('weekNumber', '==', weekNum)
        .where('status', '==', 'draft')
        .limit(1).get();

      const itemsData = items.map((item, i) => ({
        index: i,
        taskId: item.id || item.taskId || null,
        text: item.text,
        category: item.category || 'Other',
        priority: item.priority || 'B',
        daysApplicable: item.daysApplicable || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
        results: item.results || {}
      }));

      if (!snap.empty) {
        // Update existing draft
        const docId = snap.docs[0].id;
        await db.collection('worksheets').doc(docId).update({
          items: itemsData,
          lastEditedBy: currentUser?.displayName || 'Unknown',
          lastEditedAt: now,
          updatedAt: now
        });
        const doc = await db.collection('worksheets').doc(docId).get();
        return { id: doc.id, ...doc.data() };
      } else {
        // Create new draft
        const famDoc = await db.collection('families').doc(familyId).get();
        const family = famDoc.exists ? famDoc.data() : {};
        const weekStart = family.weekStart || 'monday';
        
        const weekStartDate = weekStart === 'sunday' ? getSundayOfWeek(year, weekNum) : getMondayOfWeek(year, weekNum);
        const serial = generateSerial(childName, year, weekNum);
        const data = {
          serialNumber: serial, familyId, childId, childName, year,
          month: weekStartDate.toLocaleString('default', { month: 'long' }),
          weekNumber: weekNum, weekStartDate: formatDate(weekStartDate),
          items: itemsData,
          status: 'draft',
          lastEditedBy: currentUser?.displayName || 'Unknown',
          lastEditedAt: now,
          createdAt: now, updatedAt: now
        };
        const ref = await db.collection('worksheets').add(data);
        return { id: ref.id, ...data };
      }
    },

    async publishWorksheet(worksheetId) {
      const doc = await db.collection('worksheets').doc(worksheetId).get();
      if (!doc.exists) throw new Error('Worksheet not found');

      const ws = doc.data();
      if (ws.status !== 'draft') {
        throw new Error('Only draft worksheets can be published.');
      }

      // Deep copy items to freeze them
      const updates = {
        items: JSON.parse(JSON.stringify(ws.items)),
        status: 'published',
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await db.collection('worksheets').doc(worksheetId).update(updates);
      const updatedDoc = await db.collection('worksheets').doc(worksheetId).get();
      return { id: updatedDoc.id, ...updatedDoc.data() };
    },

    async saveOCRResults(worksheetId, ocrResults, reviewedBy) {
      const doc = await db.collection('worksheets').doc(worksheetId).get();
      if (!doc.exists) throw new Error('Worksheet not found');
      const ws = doc.data();
      if (ocrResults.items) {
        ocrResults.items.forEach(ocrItem => {
          const wsItem = ws.items[ocrItem.index];
          if (wsItem) wsItem.results = ocrItem.results || wsItem.results;
        });
      }
      ws.status = 'scanned';
      ws.scanDate = new Date().toISOString();
      ws.scanReviewedBy = reviewedBy;
      ws.updatedAt = new Date().toISOString();
      await db.collection('worksheets').doc(worksheetId).update(ws);
      return { id: worksheetId, ...ws };
    },

    async getLastWorksheet(familyId, childId) {
      const snap = await db.collection('worksheets')
        .where('familyId', '==', familyId)
        .where('childId', '==', childId)
        .orderBy('createdAt', 'desc').limit(1).get();
      return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    },

    async getPreviousReviewedWorksheet(familyId, childId, excludeId) {
      const snap = await db.collection('worksheets')
        .where('familyId', '==', familyId)
        .where('childId', '==', childId)
        .where('status', 'in', ['reviewed', 'scanned'])
        .orderBy('createdAt', 'desc').limit(5).get();
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return docs.find(d => d.id !== excludeId) || null;
    },

    async getAnalyticsData(familyId, childId, startDate, endDate) {
      let q = db.collection('worksheets').where('familyId', '==', familyId);
      if (childId) q = q.where('childId', '==', childId);
      const snap = await q.orderBy('weekStartDate').get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(w => {
        let ok = w.status === 'scanned' || w.status === 'reviewed';
        if (startDate) ok = ok && w.weekStartDate >= startDate;
        if (endDate) ok = ok && w.weekStartDate <= endDate;
        return ok;
      });
    },

    // Admin stubs for Firebase mode (user management handled by Firebase Auth)
    async getFamilyMembers(familyId) {
      const famDoc = await db.collection('families').doc(familyId).get();
      if (!famDoc.exists) return [];
      const fam = famDoc.data();
      // In Firebase mode, we store user profiles in a 'users' collection
      const members = [];
      for (const uid of fam.members) {
        const userDoc = await db.collection('users').doc(uid).get();
        members.push(userDoc.exists
          ? { uid, ...userDoc.data() }
          : { uid, email: 'Unknown', displayName: 'Unknown', realEmail: '' });
      }
      return members;
    },

    async updateUserProfile(uid, updates) {
      await db.collection('users').doc(uid).set(updates, { merge: true });
      if (currentUser && currentUser.uid === uid) {
        if (updates.displayName) currentUser.displayName = updates.displayName;
        if (updates.email) currentUser.email = updates.email;
      }
      const doc = await db.collection('users').doc(uid).get();
      return { uid, ...doc.data() };
    },

    async adminResetPassword(uid, newPassword) {
      // Firebase Admin SDK needed server-side; in client mode, instruct user to use password reset email
      throw new Error('In Firebase mode, use the "Forgot Password" flow. Admin reset requires a server-side function.');
    },

    async updateFamilyName(familyId, name) {
      await db.collection('families').doc(familyId).update({ name });
      const doc = await db.collection('families').doc(familyId).get();
      return { id: doc.id, ...doc.data() };
    },

    async removeFamilyMember(familyId, uid) {
      await db.collection('families').doc(familyId).update({
        members: firebase.firestore.FieldValue.arrayRemove(uid)
      });
      const doc = await db.collection('families').doc(familyId).get();
      return { id: doc.id, ...doc.data() };
    }
  };

  // ---- Public API ----
  return {
    generateId,
    getWeekNumber,
    getMondayOfWeek,
    getSundayOfWeek,
    formatDate,
    generateSerial,

    // Calculate age from birthday string (YYYY-MM-DD)
    calcAge(birthday) {
      const bdate = new Date(birthday + 'T00:00:00');
      const today = new Date();
      let age = today.getFullYear() - bdate.getFullYear();
      const monthDiff = today.getMonth() - bdate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < bdate.getDate())) {
        age--;
      }
      return age;
    },

    // Get display age — auto-calculate from birthday if present, else use stored age
    getChildAge(child) {
      if (child.birthday) {
        return this.calcAge(child.birthday);
      }
      return child.age;
    },

    init(authCallback) {
      onAuthChange = authCallback;
      if (!USE_LOCAL_STORAGE && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY') {
        firebase.initializeApp(FIREBASE_CONFIG);
        auth = firebase.auth();
        db = firebase.firestore();
        auth.onAuthStateChanged(user => {
          if (user) {
            currentUser = { uid: user.uid, email: user.email, displayName: user.displayName };
          } else {
            currentUser = null;
          }
          if (onAuthChange) onAuthChange(currentUser);
        });
        // Proxy to Firebase backend
        Object.keys(FirebaseBackend).forEach(k => { this[k] = FirebaseBackend[k].bind(FirebaseBackend); });
      } else {
        // Use localStorage backend
        Object.keys(LocalBackend).forEach(k => { this[k] = LocalBackend[k].bind(LocalBackend); });
        // Check for saved session
        const saved = LocalBackend.getCurrentUser();
        if (saved && onAuthChange) {
          setTimeout(() => onAuthChange(saved), 50);
        } else if (onAuthChange) {
          setTimeout(() => onAuthChange(null), 50);
        }
      }
    }
  };
})();
