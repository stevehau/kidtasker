# Family Checklist - Setup Guide

## Quick Start (Local Demo Mode)

The app runs entirely in the browser using localStorage — no server needed.

1. **Serve the files locally** (required for JavaScript modules):
   ```bash
   cd family-checklist
   python3 -m http.server 8080
   # OR
   npx serve .
   ```

2. **Open** `http://localhost:8080` in your browser.

3. **Load demo data** (optional): Visit `http://localhost:8080/seed-data.html` and click **"Load Demo Data"**. This creates:
   - Two parent accounts: `steve@family.com` / `password123` and `clare@family.com` / `password123`
   - Three children: Dylan (10), Ethan (7), Jordan (5)
   - 10 pre-configured checklist items for Dylan
   - 4 weeks of sample worksheet results for the analytics demo

4. **Sign in** and start using the app!

---

## Deploy to GitHub Pages

1. Create a GitHub repo (e.g., `family-checklist`)
2. Push the `family-checklist` folder contents to the repo
3. Go to **Settings > Pages** and set source to `main` branch, root folder
4. Your app will be live at `https://yourusername.github.io/family-checklist/`

---

## Upgrade to Firebase (for Multi-Device Collaborative Use)

Local demo mode stores data in one browser only. For real family collaboration:

1. Go to [Firebase Console](https://console.firebase.google.com) and create a project
2. **Add a Web App** in Project Settings and copy the config
3. Enable **Authentication > Email/Password**
4. Create a **Firestore Database** (start in test mode)
5. Edit `js/config.js`:
   - Replace the `FIREBASE_CONFIG` values with your project's config
   - Set `USE_LOCAL_STORAGE = false`
6. Redeploy to GitHub Pages
7. Add Firestore security rules (see below)

### Recommended Firestore Rules
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /families/{familyId} {
      allow read, write: if request.auth != null
        && request.auth.uid in resource.data.members;
    }
    match /children/{childId} {
      allow read, write: if request.auth != null;
    }
    match /taskTemplates/{taskId} {
      allow read, write: if request.auth != null;
    }
    match /worksheets/{wsId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

---

## How It Works

### Workflow
1. **Add Children** — Go to Children tab, add names and ages
2. **Create Checklist** — From Dashboard, click "Edit Checklist" for a child
3. **Generate Worksheet** — Click "Worksheet" to generate and print a PDF
4. **Use During the Week** — Child checks boxes, circles priorities daily
5. **Scan at Week's End** — Use Scanner tab to upload scanned image (OCR)
6. **Review Results** — Edit/confirm OCR results or enter manually
7. **View Analytics** — Track completion rates, trends by category

### Worksheet Serial Numbers
Each printed worksheet has a unique serial number (e.g., `WSH-DYL-2026-W12-A3F7`) printed in the header and footer. This lets the scanner match a scanned sheet to its database record.

### OCR Notes
- Works best with high-quality flatbed scans (300 DPI recommended)
- The OCR attempts to detect the serial number automatically
- Checkbox detection is heuristic-based — always review OCR results manually
- If OCR doesn't match, use the manual serial lookup to enter results by hand

### Analytics
- **Completion Rate** — % of task-days completed across all tracked weeks
- **By Category** — See which types of tasks have highest/lowest completion
- **By Day of Week** — Identify which days tend to have lower compliance
- **Trends** — Compares first half vs. second half of selected period
