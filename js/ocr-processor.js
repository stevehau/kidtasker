// ============================================================
// Kid Tasker - OCR / Scan Processor
// Uses QR detection + pixel-based checkbox analysis
// ============================================================

const OCRProcessor = (() => {

  // ---- PDF layout constants (must match pdf-generator.js) ----
  // All values in mm, for landscape letter (279.4 x 215.9)
  const PDF = {
    PAGE_W: 279.4,
    PAGE_H: 215.9,
    MARGIN: 10,
    CONTENT_W: 259.4,
    COL: {
      num:      { x: 0,   w: 5   },
      text:     { x: 5,   w: 50  },
      dayStart: 55,
      dayW:     24,
      priStart: 223,
      priW:     36.4,
    },
    CB: 3.8,      // child checkbox size
    CB_P: 3.4,    // parent checkbox size
    TOTAL_ROWS: 10,
  };

  // ---- Helpers ----

  // Load image file into an HTMLImageElement
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      if (file instanceof File || file instanceof Blob) {
        const url = URL.createObjectURL(file);
        img.src = url;
      } else if (typeof file === 'string') {
        img.src = file;
      } else {
        reject(new Error('Unsupported file type'));
      }
    });
  }

  // Draw image to canvas and return context + image data
  function imageToCanvas(img, maxDim) {
    const canvas = document.createElement('canvas');
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;

    // Scale down very large images to avoid memory issues
    if (maxDim && (w > maxDim || h > maxDim)) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas, ctx, width: w, height: h };
  }

  // Rotate canvas by 90, 180, or 270 degrees
  function rotateCanvas(sourceCanvas, degrees) {
    const src = sourceCanvas.getContext('2d');
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    const dest = document.createElement('canvas');
    const dctx = dest.getContext('2d', { willReadFrequently: true });

    if (degrees === 90 || degrees === 270) {
      dest.width = sh;
      dest.height = sw;
    } else {
      dest.width = sw;
      dest.height = sh;
    }

    dctx.save();
    if (degrees === 90) {
      dctx.translate(sh, 0);
    } else if (degrees === 180) {
      dctx.translate(sw, sh);
    } else if (degrees === 270) {
      dctx.translate(0, sw);
    }
    dctx.rotate((degrees * Math.PI) / 180);
    dctx.drawImage(sourceCanvas, 0, 0);
    dctx.restore();

    return dest;
  }

  // ---- QR Code Detection ----

  // Scan for QR code in the image (tries multiple orientations)
  function detectQR(canvas) {
    const orientations = [0, 90, 180, 270];
    for (const deg of orientations) {
      const c = deg === 0 ? canvas : rotateCanvas(canvas, deg);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const imageData = ctx.getImageData(0, 0, c.width, c.height);

      if (typeof jsQR !== 'undefined') {
        const code = jsQR(imageData.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
        if (code && code.data) {
          // Check if the data matches our Form ID pattern
          const match = code.data.match(/WSH-[A-Z]{3}-\d{4}-W\d{1,2}-[A-Z0-9]{4}/);
          if (match) {
            return { formId: match[0], rotation: deg, qrLocation: code.location };
          }
        }
      }
    }
    return null;
  }

  // ---- Tesseract Fallback for Form ID ----

  async function ocrFormId(canvas, onProgress) {
    if (typeof Tesseract === 'undefined') return null;

    try {
      // Only OCR a small region where the Form ID text would be
      // Try different orientations
      const orientations = [0, 90, 180, 270];
      for (const deg of orientations) {
        const c = deg === 0 ? canvas : rotateCanvas(canvas, deg);
        const w = c.width;
        const h = c.height;

        // The Form ID appears in the top-right area and bottom-left of the PDF
        // Sample a strip from the top 15% of the image
        const regionCanvas = document.createElement('canvas');
        const regionH = Math.round(h * 0.15);
        regionCanvas.width = w;
        regionCanvas.height = regionH;
        const rctx = regionCanvas.getContext('2d');
        rctx.drawImage(c, 0, 0, w, regionH, 0, 0, w, regionH);

        const worker = await Tesseract.createWorker('eng', 1, {
          logger: m => {
            if (onProgress && m.status === 'recognizing text') {
              onProgress(Math.round(m.progress * 50 + deg / 270 * 20));
            }
          }
        });
        const { data } = await worker.recognize(regionCanvas);
        await worker.terminate();

        const match = data.text.match(/WSH-[A-Z]{3}-\d{4}-W\d{1,2}-[A-Z0-9]{4}/);
        if (match) {
          return { formId: match[0], rotation: deg };
        }
      }
    } catch (e) {
      console.warn('OCR Form ID detection failed:', e);
    }
    return null;
  }

  // ---- Orientation & Alignment ----

  // Determine if the scanned image is landscape or portrait
  // and what rotation is needed to match the PDF layout
  function detectOrientation(canvas, qrResult) {
    const w = canvas.width;
    const h = canvas.height;

    if (qrResult && qrResult.rotation !== undefined) {
      return qrResult.rotation;
    }

    // The PDF is landscape (wider than tall)
    // If the scan is portrait (taller than wide), it's likely rotated 90 or 270
    if (h > w * 1.1) {
      // Portrait scan of landscape doc — most likely rotated 90° CW
      return 90;
    }
    return 0;
  }

  // ---- Checkbox Detection via Pixel Analysis ----

  // Convert mm position in the PDF to pixel position in the scanned image
  function mmToPixel(mmX, mmY, imgW, imgH) {
    const scaleX = imgW / PDF.PAGE_W;
    const scaleY = imgH / PDF.PAGE_H;
    return {
      x: Math.round(mmX * scaleX),
      y: Math.round(mmY * scaleY)
    };
  }

  // Measure the "darkness" of a rectangular region (0 = white, 1 = black)
  function measureDarkness(ctx, x, y, w, h, imgW, imgH) {
    // Clamp to image bounds
    const x0 = Math.max(0, Math.min(Math.round(x), imgW - 1));
    const y0 = Math.max(0, Math.min(Math.round(y), imgH - 1));
    const x1 = Math.max(0, Math.min(Math.round(x + w), imgW));
    const y1 = Math.max(0, Math.min(Math.round(y + h), imgH));
    const rw = x1 - x0;
    const rh = y1 - y0;
    if (rw <= 0 || rh <= 0) return 0;

    try {
      const imageData = ctx.getImageData(x0, y0, rw, rh);
      const data = imageData.data;
      let darkPixels = 0;
      const totalPixels = rw * rh;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const brightness = (r + g + b) / 3;
        // A dark pixel (pen mark) — threshold ~140
        if (brightness < 140) {
          darkPixels++;
        }
      }
      return darkPixels / totalPixels;
    } catch (e) {
      return 0;
    }
  }

  // Measure darkness inside a checkbox region, shrinking slightly to avoid the border
  function measureCheckbox(ctx, centerXmm, centerYmm, sizeMm, imgW, imgH) {
    // Shrink the sample region to the inner ~60% of the checkbox to avoid border ink
    const innerSize = sizeMm * 0.55;
    const topLeftMm = {
      x: centerXmm - innerSize / 2,
      y: centerYmm - innerSize / 2
    };
    const topLeftPx = mmToPixel(topLeftMm.x, topLeftMm.y, imgW, imgH);
    const sizePx = mmToPixel(innerSize, innerSize, imgW, imgH);

    return measureDarkness(ctx, topLeftPx.x, topLeftPx.y, sizePx.x, sizePx.y, imgW, imgH);
  }

  // ---- Main Analysis: locate checkboxes and read them ----

  function analyzeCheckboxes(canvas, worksheet, headerEndMm, rowHMm) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgW = canvas.width;
    const imgH = canvas.height;
    const items = worksheet.items || [];
    const days = APP_CONFIG.daysShort;
    const totalRows = PDF.TOTAL_ROWS;

    // Table header is 10mm tall (from drawTableHeader)
    const tableHeaderH = 10;
    const dataStartY = headerEndMm + tableHeaderH;

    const results = [];
    const darknessValues = []; // collect all values for adaptive thresholding

    // First pass: measure all checkbox darkness values
    for (let row = 0; row < items.length; row++) {
      const item = items[row];
      const applicableDays = item.daysApplicable || days;
      const rowY = dataStartY + row * rowHMm;
      const midY = rowY + rowHMm / 2;

      for (let d = 0; d < 7; d++) {
        const dayName = days[d];
        if (!applicableDays.includes(dayName)) continue;

        const dayX = PDF.MARGIN + PDF.COL.dayStart + d * PDF.COL.dayW;
        const halfW = PDF.COL.dayW / 2;

        // Child checkbox center
        const childCX = dayX + halfW / 2;
        const childDark = measureCheckbox(ctx, childCX, midY, PDF.CB, imgW, imgH);
        darknessValues.push({ row, day: d, type: 'child', value: childDark });

        // Parent checkbox center
        const parentCX = dayX + halfW + halfW / 2;
        const parentDark = measureCheckbox(ctx, parentCX, midY, PDF.CB_P, imgW, imgH);
        darknessValues.push({ row, day: d, type: 'parent', value: parentDark });
      }
    }

    // Adaptive threshold: use the distribution of darkness values
    // Empty checkboxes should be ~0.02-0.08 (just border bleed)
    // Checked checkboxes should be ~0.15-0.60+ (pen marks)
    const values = darknessValues.map(v => v.value).sort((a, b) => a - b);
    let threshold = 0.12; // default

    if (values.length > 4) {
      // Use Otsu-like approach: find the best split point
      const median = values[Math.floor(values.length / 2)];
      const q25 = values[Math.floor(values.length * 0.25)];
      const q75 = values[Math.floor(values.length * 0.75)];

      // If there's a clear bimodal split, use midpoint
      if (q75 > q25 * 2.5 && q75 > 0.1) {
        threshold = (q25 + q75) / 2;
      } else {
        // Otherwise use a fixed threshold slightly above noise
        threshold = Math.max(0.10, q25 * 2.0);
      }
      // Clamp threshold to reasonable range
      threshold = Math.max(0.08, Math.min(threshold, 0.35));
    }

    console.log('[OCR] Checkbox darkness stats:', {
      min: values[0]?.toFixed(3),
      q25: values[Math.floor(values.length * 0.25)]?.toFixed(3),
      median: values[Math.floor(values.length / 2)]?.toFixed(3),
      q75: values[Math.floor(values.length * 0.75)]?.toFixed(3),
      max: values[values.length - 1]?.toFixed(3),
      threshold: threshold.toFixed(3),
      count: values.length
    });

    // Second pass: classify each checkbox
    for (let row = 0; row < items.length; row++) {
      const item = items[row];
      const applicableDays = item.daysApplicable || days;
      const rowResults = {};

      for (let d = 0; d < 7; d++) {
        const dayName = days[d];
        if (!applicableDays.includes(dayName)) continue;

        const childEntry = darknessValues.find(v => v.row === row && v.day === d && v.type === 'child');
        const parentEntry = darknessValues.find(v => v.row === row && v.day === d && v.type === 'parent');

        const childChecked = childEntry && childEntry.value > threshold;
        const parentChecked = parentEntry && parentEntry.value > threshold;

        rowResults[dayName] = {
          completed: childChecked || false,
          confirmed: parentChecked || false,
          childDarkness: childEntry ? childEntry.value : 0,
          parentDarkness: parentEntry ? parentEntry.value : 0,
        };
      }

      results.push({
        index: row,
        text: item.text,
        results: rowResults
      });
    }

    return { results, threshold, darknessValues };
  }

  // ---- Estimate header end position ----
  // This depends on whether gamification stats are shown.
  // We can estimate based on the PDF layout:
  // - Title bar: 9mm
  // - Info strip: 9mm + 0.5 gap
  // - QR code area: 13mm + gaps
  // - Stats banner (if present): ~15mm
  // Without stats: headerEnd ≈ 10 + 9 + 0.5 + 9 + 0.5 + 13 + 1 = ~43mm
  // With stats:    headerEnd ≈ 10 + 9 + 0.5 + 9 + 0.5 + 15 + 1 = ~45mm
  // We'll estimate based on available space

  function estimateLayout(worksheet) {
    // Replicate the header end calculation from pdf-generator
    const MARGIN = PDF.MARGIN;
    const barH = 9;
    const infoH = 9;
    const qrSize = 13;

    const infoY = MARGIN + barH + 0.5;
    const qrY = infoY + infoH + 0.5;
    const statsY = qrY; // stats starts at same Y as QR

    // Check if there would be stats (we don't know for sure, but estimate)
    // If the worksheet has been printed from a state with previous data, stats are likely
    const statsH = 15;
    const hasStats = true; // assume stats are present (worst case we're a bit off)

    const headerEnd = hasStats
      ? Math.max(statsY + statsH + 1, qrY + qrSize + 1)
      : qrY + qrSize + 1;

    // Calculate row height
    const tableHeaderH = 10; // matches drawTableHeader rowH
    const footerReserve = 8;
    const availableH = PDF.PAGE_H - MARGIN - footerReserve - (headerEnd - MARGIN) - tableHeaderH;
    const rowH = Math.min(Math.max(availableH / PDF.TOTAL_ROWS, 5.5), 11);

    return { headerEnd, rowH, tableHeaderH };
  }

  // ---- Find the blue header bar to precisely locate the table ----

  function findBlueHeaderBar(ctx, imgW, imgH) {
    // Scan from ~15% to ~35% from top looking for a horizontal blue bar
    // The table header is a solid blue (#4A6CF7 = rgb(74,108,247)) bar
    const startRow = Math.round(imgH * 0.12);
    const endRow = Math.round(imgH * 0.45);
    const sampleCols = 20; // sample across the width

    for (let row = startRow; row < endRow; row += 2) {
      let blueCount = 0;
      for (let c = 0; c < sampleCols; c++) {
        const x = Math.round((c + 0.5) / sampleCols * imgW * 0.8 + imgW * 0.1);
        const pixel = ctx.getImageData(x, row, 1, 1).data;
        const r = pixel[0], g = pixel[1], b = pixel[2];
        // Detect blue-ish pixels (the header bar is a strong blue)
        if (b > 150 && b > r * 1.3 && b > g * 1.1) {
          blueCount++;
        }
      }
      // If most sample points are blue, we found the header bar
      if (blueCount > sampleCols * 0.6) {
        // Find the bottom edge of this blue bar
        let barBottom = row;
        for (let r2 = row; r2 < Math.min(row + Math.round(imgH * 0.08), imgH); r2++) {
          let stillBlue = 0;
          for (let c = 0; c < 10; c++) {
            const x = Math.round((c + 0.5) / 10 * imgW * 0.6 + imgW * 0.2);
            const pixel = ctx.getImageData(x, r2, 1, 1).data;
            if (pixel[2] > 150 && pixel[2] > pixel[0] * 1.3) stillBlue++;
          }
          if (stillBlue > 5) {
            barBottom = r2;
          } else {
            break;
          }
        }
        // Convert pixel Y to mm
        const barTopMm = (row / imgH) * PDF.PAGE_H;
        const barBottomMm = (barBottom / imgH) * PDF.PAGE_H;
        return { topMm: barTopMm, bottomMm: barBottomMm, topPx: row, bottomPx: barBottom };
      }
    }
    return null;
  }

  // ---- Public API ----

  return {
    async processImage(imageFile, worksheet, onProgress) {
      try {
        if (onProgress) onProgress(5);

        // Step 1: Load image
        const img = await loadImage(imageFile);
        let { canvas } = imageToCanvas(img, 3000); // cap at 3000px max dimension

        if (onProgress) onProgress(10);

        // Step 2: Detect QR code (tries all 4 orientations)
        let qrResult = detectQR(canvas);
        if (onProgress) onProgress(25);

        // Step 3: Determine orientation and rotate if needed
        const rotation = detectOrientation(canvas, qrResult);
        if (rotation !== 0) {
          canvas = rotateCanvas(canvas, rotation);
        }

        // If QR was found in a different orientation, re-detect in corrected canvas
        // (to get proper location coordinates)
        if (rotation !== 0 && qrResult && qrResult.rotation !== rotation) {
          // QR was found, rotation applied; re-detect not needed since we have the Form ID
        }

        if (onProgress) onProgress(30);

        // Step 4: If no QR found, try Tesseract OCR on small region
        let formId = qrResult ? qrResult.formId : null;
        if (!formId) {
          const ocrResult = await ocrFormId(canvas, onProgress);
          if (ocrResult) {
            formId = ocrResult.formId;
          }
        }

        if (onProgress) onProgress(50);

        // Step 5: If we have a worksheet, analyze checkboxes
        let checkboxResults = null;
        if (worksheet && worksheet.items && worksheet.items.length > 0) {
          if (onProgress) onProgress(60);

          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          const imgW = canvas.width;
          const imgH = canvas.height;

          // Try to find the blue table header bar for precise alignment
          const blueBar = findBlueHeaderBar(ctx, imgW, imgH);

          let headerEndMm, rowH;
          if (blueBar) {
            // The blue bar IS the table header; data starts right after it
            headerEndMm = blueBar.topMm; // this is where drawTableHeader starts
            const tableHeaderH = blueBar.bottomMm - blueBar.topMm;
            const footerReserve = 8;
            const availableH = PDF.PAGE_H - PDF.MARGIN - footerReserve - (headerEndMm - PDF.MARGIN) - tableHeaderH;
            rowH = Math.min(Math.max(availableH / PDF.TOTAL_ROWS, 5.5), 11);

            // Adjust headerEndMm to be the top of the table (before the header row)
            // since analyzeCheckboxes adds tableHeaderH internally
            console.log('[OCR] Blue bar detected at', blueBar.topMm.toFixed(1), '-', blueBar.bottomMm.toFixed(1), 'mm, rowH=', rowH.toFixed(1));
          } else {
            // Fall back to estimated layout
            const layout = estimateLayout(worksheet);
            headerEndMm = layout.headerEnd;
            rowH = layout.rowH;
            console.log('[OCR] Using estimated layout: headerEnd=', headerEndMm.toFixed(1), 'mm, rowH=', rowH.toFixed(1));
          }

          if (onProgress) onProgress(70);

          checkboxResults = analyzeCheckboxes(canvas, worksheet, headerEndMm, rowH);

          if (onProgress) onProgress(90);
        }

        if (onProgress) onProgress(100);

        return {
          success: true,
          serialNumber: formId,
          rotation: rotation,
          qrDetected: !!qrResult,
          items: checkboxResults ? checkboxResults.results : [],
          threshold: checkboxResults ? checkboxResults.threshold : null,
          rawDarkness: checkboxResults ? checkboxResults.darknessValues : [],
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
        };

      } catch (error) {
        console.error('[OCR] Processing error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },

    // Manual entry helper - creates results structure for a worksheet
    createManualResults(worksheet, dayResults) {
      const items = worksheet.items.map((item, idx) => ({
        index: idx,
        text: item.text,
        results: {}
      }));

      Object.keys(dayResults).forEach(day => {
        Object.keys(dayResults[day]).forEach(itemIdx => {
          const i = parseInt(itemIdx);
          if (items[i]) {
            items[i].results[day] = {
              completed: dayResults[day][itemIdx],
              confirmed: false
            };
          }
        });
      });

      return { items };
    }
  };
})();
