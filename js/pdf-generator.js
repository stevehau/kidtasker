// ============================================================
// Kid Tasker - PDF Worksheet Generator (Landscape Single Page)
// ============================================================

const PDFGenerator = (() => {
  const { jsPDF } = window.jspdf;

  // Landscape letter dimensions
  const MARGIN = 10;
  const PAGE_W = 279.4;
  const PAGE_H = 215.9;
  const CONTENT_W = PAGE_W - 2 * MARGIN;
  const CB = 3.8; // checkbox size (larger for visibility)
  const CB_P = 3.4; // parent OK checkbox (slightly smaller, blue)
  const TOTAL_ROWS = 10; // always print exactly 10 rows
  const BLUE = [74, 108, 247];
  const GOLD = [243, 156, 18];

  // Column layout
  const COL = {
    num:      { x: 0,   w: 5   },
    text:     { x: 5,   w: 50  },
    dayStart: 55,
    dayW:     24,
    priStart: 223,
    priW:     36.4,
  };

  // Generate QR code data URL
  function generateQR(text, cellSize) {
    if (typeof qrcode === 'undefined') return null;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const size = qr.getModuleCount();
      const px = cellSize || 2;
      const canvas = document.createElement('canvas');
      canvas.width = size * px;
      canvas.height = size * px;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          if (qr.isDark(row, col)) {
            ctx.fillRect(col * px, row * px, px, px);
          }
        }
      }
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('QR generation failed:', e);
      return null;
    }
  }

  // Load an image from a path and return a data URL via canvas
  function loadImageAsDataUrl(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // Calculate last week's stats from a previous worksheet
  function calcLastWeekStats(lastWorksheet) {
    if (!lastWorksheet || !lastWorksheet.items) return null;
    const stats = { A: { ok: 0, total: 0 }, B: { ok: 0, total: 0 }, C: { ok: 0, total: 0 }, all: { ok: 0, total: 0 } };
    const days = APP_CONFIG.daysShort;

    for (const item of lastWorksheet.items) {
      const pri = (item.priority || 'B').toUpperCase();
      const applicable = item.daysApplicable || days;
      for (const d of applicable) {
        const r = item.results && item.results[d];
        if (r) {
          stats[pri].total++;
          stats.all.total++;
          if (r.confirmed) {
            stats[pri].ok++;
            stats.all.ok++;
          }
        }
      }
    }
    stats.pctA = stats.A.total ? Math.round(100 * stats.A.ok / stats.A.total) : null;
    stats.pctB = stats.B.total ? Math.round(100 * stats.B.ok / stats.B.total) : null;
    stats.pctC = stats.C.total ? Math.round(100 * stats.C.ok / stats.C.total) : null;
    stats.pctAll = stats.all.total ? Math.round(100 * stats.all.ok / stats.all.total) : 0;
    return stats;
  }

  // Draw the compact header with Kid Tasker branding
  function drawHeader(doc, worksheet, lastWeekStats, rewardImg, startedImg, weeklyHistory) {
    const y = MARGIN;
    const formId = worksheet.serialNumber;
    const barH = 9;

    // ---- Title bar ----
    doc.setFillColor(...BLUE);
    doc.rect(MARGIN, y, CONTENT_W, barH, 'F');

    // "Kid Tasker" brand on left
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Kid Tasker', MARGIN + 3, y + 6.2);

    // "WEEKLY CHECKLIST" centered
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('WEEKLY CHECKLIST', MARGIN + CONTENT_W / 2, y + 6.2, { align: 'center' });

    // Form ID on right of title bar
    doc.setFontSize(5.5);
    doc.text(formId, MARGIN + CONTENT_W - 3, y + 6.2, { align: 'right' });

    // ---- Info strip ----
    const infoY = y + barH + 0.5;
    const infoH = 9;
    doc.setFillColor(240, 243, 255);
    doc.rect(MARGIN, infoY, CONTENT_W, infoH, 'F');

    doc.setTextColor(40, 40, 40);

    // Child name (large, bold, left — vertically centered)
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(worksheet.childName, MARGIN + 3, infoY + 6.5);

    // Date info (centered group)
    const weekStart = new Date(worksheet.weekStartDate + 'T00:00:00');
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const dateRange = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} \u2013 ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    const infoStr = `Week ${worksheet.weekNumber}  |  ${worksheet.month} ${worksheet.year}  |  ${dateRange}`;
    doc.text(infoStr, MARGIN + CONTENT_W / 2, infoY + 6, { align: 'center' });

    // Form ID text for OCR (right)
    doc.setFontSize(6);
    doc.setFont('courier', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(`Form ID: ${formId}`, MARGIN + CONTENT_W - 3, infoY + 6, { align: 'right' });

    // ---- QR code (right side, below info) ----
    const qrDataUrl = generateQR(formId, 3);
    const qrSize = 13;
    const qrX = MARGIN + CONTENT_W - qrSize - 1;
    const qrY = infoY + infoH + 0.5;
    if (qrDataUrl) {
      doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
    }

    // ---- Last week stats / gamification badge (left of QR) ----
    const statsY = infoY + infoH + 0.5;
    const statsH = 15; // height for stats banner

    if (lastWeekStats && lastWeekStats.all.total > 0) {
      const badgeW = CONTENT_W - qrSize - 4;

      // Light background for stats area
      doc.setFillColor(255, 250, 235);
      doc.setDrawColor(243, 156, 18);
      doc.setLineWidth(0.3);
      doc.roundedRect(MARGIN, statsY, badgeW, statsH, 1.5, 1.5, 'FD');

      // Reward image on the left (banner shape ~2.25:1 aspect ratio)
      const imgH = statsH - 2;
      const imgW = imgH * 2.25;
      if (rewardImg) {
        try {
          doc.addImage(rewardImg, 'PNG', MARGIN + 1.5, statsY + 1, imgW, imgH);
        } catch (e) { /* skip if image fails */ }
      }

      const textStartX = MARGIN + (rewardImg ? imgW + 4 : 3);

      // "Last Week's Score" title
      doc.setTextColor(180, 120, 0);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'bold');
      doc.text('Last Week\'s Score', textStartX, statsY + 3.5);

      // Overall percentage (big)
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(40, 40, 40);
      const pctStr = `${lastWeekStats.pctAll}%`;
      doc.text(pctStr, textStartX, statsY + 11);

      // Per-priority breakdown (to the right of the big %)
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      const breakdownX = textStartX + 22;
      const lineH = 3.5;
      const bStartY = statsY + 4;

      if (lastWeekStats.pctA !== null) {
        doc.setFillColor(74, 108, 247);
        doc.rect(breakdownX, bStartY - 2, 2, 2, 'F');
        doc.setTextColor(40, 40, 40);
        doc.text(`Priority A: ${lastWeekStats.pctA}%`, breakdownX + 3.5, bStartY);
      }
      if (lastWeekStats.pctB !== null) {
        doc.setFillColor(100, 180, 100);
        doc.rect(breakdownX, bStartY + lineH - 2, 2, 2, 'F');
        doc.setTextColor(40, 40, 40);
        doc.text(`Priority B: ${lastWeekStats.pctB}%`, breakdownX + 3.5, bStartY + lineH);
      }
      if (lastWeekStats.pctC !== null) {
        doc.setFillColor(180, 180, 180);
        doc.rect(breakdownX, bStartY + lineH * 2 - 2, 2, 2, 'F');
        doc.setTextColor(40, 40, 40);
        doc.text(`Priority C: ${lastWeekStats.pctC}%`, breakdownX + 3.5, bStartY + lineH * 2);
      }

      // Draw 52-week column chart to the right of the priority breakdown
      if (weeklyHistory && weeklyHistory.length > 0) {
        const chartStartX = breakdownX + 45;
        const chartEndX = badgeW - 2;
        const chartW = chartEndX - chartStartX;

        if (chartW > 10) {
          const totalWeeks = weeklyHistory.length;
          const barSpacing = chartW / totalWeeks;
          const barW = Math.max(0.4, barSpacing * 0.7);
          const chartH = statsH - 5.5;
          const baselineY = statsY + statsH - 3;
          const currentWeekNum = worksheet.weekNumber;

          // Title
          doc.setTextColor(140, 140, 140);
          doc.setFontSize(4);
          doc.setFont('helvetica', 'bold');
          doc.text('Weekly Scores', chartStartX + chartW / 2, statsY + 2.5, { align: 'center' });

          // Draw individual tick line and bar for each week
          for (let w = 0; w < totalWeeks; w++) {
            const data = weeklyHistory[w];
            const cx = chartStartX + w * barSpacing + barSpacing / 2;
            const barX = cx - barW / 2;

            // Tick line for every week
            doc.setDrawColor(210, 210, 210);
            doc.setLineWidth(0.08);
            doc.line(cx, baselineY, cx, baselineY + 0.6);

            // Week number label (show every 4th week + week 1 + last week)
            const weekNum = data.week || (w + 1);
            if (weekNum === 1 || weekNum === totalWeeks || weekNum % 4 === 0) {
              doc.setTextColor(160, 160, 160);
              doc.setFontSize(2.8);
              doc.setFont('helvetica', 'normal');
              doc.text(`${weekNum}`, cx, baselineY + 2.5, { align: 'center' });
            }

            if (data.pct > 0) {
              // Filled bar for weeks with data
              const h = (data.pct / 100) * chartH;
              const barY = baselineY - h;

              // Current worksheet week = gold, others = blue
              if (weekNum === currentWeekNum) {
                doc.setFillColor(...GOLD);
              } else {
                doc.setFillColor(100, 140, 250);
              }
              doc.rect(barX, barY, barW, h, 'F');
            } else {
              // Empty placeholder box at 10% height for weeks without data
              const placeholderH = (10 / 100) * chartH;
              const placeholderY = baselineY - placeholderH;

              if (weekNum <= currentWeekNum) {
                // Past/current weeks without data: blue outline
                doc.setDrawColor(100, 140, 250);
              } else {
                // Future weeks: grey outline
                doc.setDrawColor(190, 190, 190);
              }
              doc.setLineWidth(0.1);
              doc.rect(barX, placeholderY, barW, placeholderH, 'D');
            }
          }
        }
      }

      // QR code sits to the right of the stats banner
      return Math.max(statsY + statsH + 1, qrY + qrSize + 1);
    }

    // No last week data - show "Getting Started" banner instead
    const badgeW = CONTENT_W - qrSize - 4;
    doc.setFillColor(200, 240, 255);
    doc.setDrawColor(74, 180, 200);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, statsY, badgeW, statsH, 1.5, 1.5, 'FD');

    // Started image on the left
    const imgH = statsH - 2;
    const imgW = imgH * 2.25;
    if (startedImg) {
      try {
        doc.addImage(startedImg, 'PNG', MARGIN + 1.5, statsY + 1, imgW, imgH);
      } catch (e) { /* skip if image fails */ }
    }

    const textStartX = MARGIN + (startedImg ? imgW + 4 : 3);

    // Welcome message
    doc.setTextColor(50, 120, 150);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('Welcome to Kid Tasker!', textStartX, statsY + 4);

    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(70, 70, 70);
    doc.text('Complete your tasks this week!', textStartX, statsY + 10);

    return Math.max(statsY + statsH + 1, qrY + qrSize + 1);
  }

  function drawTableHeader(doc, startY, weekStart, childName) {
    const y = startY;
    const rowH = 10;
    const days = APP_CONFIG.daysShort;
    const x0 = MARGIN;

    doc.setFillColor(...BLUE);
    doc.rect(x0, y, CONTENT_W, rowH, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');

    doc.text('#', x0 + COL.num.x + COL.num.w / 2, y + 6, { align: 'center' });
    doc.text('Task', x0 + COL.text.x + 2, y + 6);

    for (let d = 0; d < 7; d++) {
      const dayX = x0 + COL.dayStart + d * COL.dayW;
      const cx = dayX + COL.dayW / 2;
      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + d);
      const dateStr = `${dayDate.getMonth() + 1}/${dayDate.getDate()}`;

      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.text(`${days[d]} ${dateStr}`, cx, y + 4, { align: 'center' });

      doc.setFontSize(5.5);
      doc.setFont('helvetica', 'normal');
      const halfW = COL.dayW / 2;
      doc.text(childName || 'Child', dayX + halfW / 2, y + 8.2, { align: 'center' });
      doc.text('Parent', dayX + halfW + halfW / 2, y + 8.2, { align: 'center' });

      doc.setDrawColor(255, 255, 255);
      doc.setLineWidth(0.1);
      doc.line(dayX + halfW, y + 5, dayX + halfW, y + rowH);
    }

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.text('Priority', x0 + COL.priStart + COL.priW / 2, y + 6, { align: 'center' });

    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.15);
    [COL.text.x, COL.dayStart].forEach(sx => {
      doc.line(x0 + sx, y, x0 + sx, y + rowH);
    });
    for (let d = 1; d <= 7; d++) {
      doc.line(x0 + COL.dayStart + d * COL.dayW, y, x0 + COL.dayStart + d * COL.dayW, y + rowH);
    }
    doc.line(x0 + COL.priStart, y, x0 + COL.priStart, y + rowH);

    return y + rowH;
  }

  function drawItemRow(doc, num, text, priority, daysApplicable, y, isBlank, rowH) {
    const x0 = MARGIN;
    const midY = y + rowH / 2;
    const textY = midY + 1.2;

    if (num % 2 === 0) {
      doc.setFillColor(247, 249, 255);
      doc.rect(x0, y, CONTENT_W, rowH, 'F');
    }

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.15);
    doc.line(x0, y + rowH, x0 + CONTENT_W, y + rowH);

    doc.setDrawColor(235, 235, 235);
    doc.setLineWidth(0.1);
    doc.line(x0 + COL.text.x, y, x0 + COL.text.x, y + rowH);
    doc.line(x0 + COL.dayStart, y, x0 + COL.dayStart, y + rowH);
    for (let d = 1; d <= 7; d++) {
      doc.line(x0 + COL.dayStart + d * COL.dayW, y, x0 + COL.dayStart + d * COL.dayW, y + rowH);
    }
    doc.line(x0 + COL.priStart, y, x0 + COL.priStart, y + rowH);

    doc.setDrawColor(240, 240, 240);
    doc.setLineWidth(0.08);
    for (let d = 0; d < 7; d++) {
      const dayX = x0 + COL.dayStart + d * COL.dayW;
      doc.line(dayX + COL.dayW / 2, y, dayX + COL.dayW / 2, y + rowH);
    }

    doc.setTextColor(140, 140, 140);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(`${num}`, x0 + COL.num.x + COL.num.w / 2, textY, { align: 'center' });

    doc.setTextColor(30, 30, 30);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    if (isBlank) {
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.line(x0 + COL.text.x + 2, textY + 0.5, x0 + COL.text.x + COL.text.w - 2, textY + 0.5);
    } else {
      let displayText = text;
      const maxW = COL.text.w - 3;
      while (doc.getTextWidth(displayText) > maxW && displayText.length > 0) {
        displayText = displayText.slice(0, -1);
      }
      if (displayText.length < text.length) displayText = displayText.slice(0, -1) + '\u2026';
      doc.text(displayText, x0 + COL.text.x + 1.5, textY);
    }

    const dayNames = APP_CONFIG.daysShort;
    const applicableDays = daysApplicable || dayNames;
    for (let d = 0; d < 7; d++) {
      const dayX = x0 + COL.dayStart + d * COL.dayW;
      const halfW = COL.dayW / 2;
      const isApplicable = applicableDays.includes(dayNames[d]);

      if (isApplicable) {
        const childCbX = dayX + (halfW - CB) / 2;
        const childCbY = midY - CB / 2;
        doc.setDrawColor(160, 160, 160);
        doc.setLineWidth(0.25);
        doc.rect(childCbX, childCbY, CB, CB);

        const parentCbX = dayX + halfW + (halfW - CB_P) / 2;
        const parentCbY = midY - CB_P / 2;
        doc.setDrawColor(...BLUE);
        doc.setLineWidth(0.3);
        doc.rect(parentCbX, parentCbY, CB_P, CB_P);
      } else {
        doc.setFillColor(230, 230, 230);
        doc.rect(dayX + 0.3, y + 0.3, COL.dayW - 0.6, rowH - 0.6, 'F');
      }
    }

    const priLetters = ['A', 'B', 'C'];
    const priSpacing = 9;
    const priStartX = x0 + COL.priStart + (COL.priW - (priLetters.length - 1) * priSpacing) / 2;
    const priR = 3.0;

    priLetters.forEach((letter, i) => {
      const cx = priStartX + i * priSpacing;
      const isSelected = priority && priority.toUpperCase() === letter;

      if (isSelected) {
        doc.setFillColor(...BLUE);
        doc.setDrawColor(...BLUE);
        doc.setLineWidth(0.3);
        doc.circle(cx, midY, priR, 'FD');
      } else {
        doc.setDrawColor(160, 160, 160);
        doc.setLineWidth(0.3);
        doc.circle(cx, midY, priR);
      }

      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(isSelected ? 255 : 100, isSelected ? 255 : 100, isSelected ? 255 : 100);
      const letterH = 1.8;
      doc.text(letter, cx, midY + letterH, { align: 'center' });
    });
  }

  function drawFooter(doc, worksheet) {
    const y = PAGE_H - MARGIN + 1;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y - 3, MARGIN + CONTENT_W, y - 3);

    doc.setTextColor(140, 140, 140);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(`Form ID: ${worksheet.serialNumber}`, MARGIN, y);
    doc.text('Kid Tasker', MARGIN + CONTENT_W / 2, y, { align: 'center' });
    doc.text(`${worksheet.childName} | Week ${worksheet.weekNumber}, ${worksheet.year}`, MARGIN + CONTENT_W, y, { align: 'right' });
  }

  function drawTableBorder(doc, startY, endY) {
    doc.setDrawColor(...BLUE);
    doc.setLineWidth(0.4);
    doc.rect(MARGIN, startY, CONTENT_W, endY - startY);
  }

  return {
    // Compute stats from previous worksheet (exposed for use by views)
    calcLastWeekStats,

    async generate(worksheet, lastWorksheet, weeklyHistory) {
      const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape' });
      const items = worksheet.items || [];
      const blankRows = Math.max(0, TOTAL_ROWS - items.length);
      const weekStart = new Date(worksheet.weekStartDate + 'T00:00:00');

      // Calculate last week stats
      const lastWeekStats = calcLastWeekStats(lastWorksheet);

      // Load reward image based on score, or started image if first week
      let rewardImg = null;
      let startedImg = null;
      if (lastWeekStats && lastWeekStats.all.total > 0) {
        const pct = lastWeekStats.pctAll;
        let imgPath;
        if (pct >= 90) imgPath = 'img/reward-awesome.png';
        else if (pct >= 80) imgPath = 'img/reward-great.png';
        else if (pct >= 70) imgPath = 'img/reward-good.png';
        else if (pct >= 60) imgPath = 'img/reward-ok.png';
        else if (pct >= 40) imgPath = 'img/reward-improve.png';
        else imgPath = 'img/reward-needs.png';
        rewardImg = await loadImageAsDataUrl(imgPath);
      } else {
        // First week - load the started image
        startedImg = await loadImageAsDataUrl('img/reward-started.png');
      }

      // Draw header (with QR code and last week stats or welcome banner)
      const headerEnd = drawHeader(doc, worksheet, lastWeekStats, rewardImg, startedImg, weeklyHistory);

      // Calculate row height to fit on one page
      const tableHeaderH = 9;
      const footerReserve = 8;
      const availableH = PAGE_H - MARGIN - footerReserve - (headerEnd - MARGIN) - tableHeaderH;
      const totalRows = TOTAL_ROWS;
      const rowH = Math.min(Math.max(availableH / totalRows, 5.5), 11);

      // Draw table
      const tableTop = headerEnd;
      const tableDataStart = drawTableHeader(doc, tableTop, weekStart, worksheet.childName);

      let y = tableDataStart;
      items.forEach((item, idx) => {
        drawItemRow(doc, idx + 1, item.text, item.priority, item.daysApplicable, y, false, rowH);
        y += rowH;
      });

      for (let b = 0; b < blankRows; b++) {
        drawItemRow(doc, items.length + b + 1, '', 'B', null, y, true, rowH);
        y += rowH;
      }

      drawTableBorder(doc, tableTop, y);
      drawFooter(doc, worksheet);

      return doc;
    },

    async generateAndDownload(worksheet, lastWorksheet, weeklyHistory) {
      const doc = await this.generate(worksheet, lastWorksheet, weeklyHistory);
      const filename = `kidtasker_${worksheet.childName}_W${worksheet.weekNumber}_${worksheet.year}.pdf`;
      doc.save(filename);
      return filename;
    },

    async generateBlob(worksheet, lastWorksheet, weeklyHistory) {
      const doc = await this.generate(worksheet, lastWorksheet, weeklyHistory);
      return doc.output('blob');
    }
  };
})();
