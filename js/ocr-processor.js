// ============================================================
// Kid Tasker - OCR / Scan Processor v2
// Uses registration marks for perspective-corrected alignment
// Only scores PARENT checkboxes (blue border boxes)
// ============================================================

const OCRProcessor = (() => {

  // ---- Helpers ----

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

  function imageToCanvas(img, maxDim) {
    const canvas = document.createElement('canvas');
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
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

  function rotateCanvas(sourceCanvas, degrees) {
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    const dest = document.createElement('canvas');
    const dctx = dest.getContext('2d', { willReadFrequently: true });
    if (degrees === 90 || degrees === 270) {
      dest.width = sh; dest.height = sw;
    } else {
      dest.width = sw; dest.height = sh;
    }
    dctx.save();
    if (degrees === 90) dctx.translate(sh, 0);
    else if (degrees === 180) dctx.translate(sw, sh);
    else if (degrees === 270) dctx.translate(0, sw);
    dctx.rotate((degrees * Math.PI) / 180);
    dctx.drawImage(sourceCanvas, 0, 0);
    dctx.restore();
    return dest;
  }

  // ---- QR Code Detection (tries all 4 orientations) ----

  function detectQR(canvas) {
    const orientations = [0, 90, 180, 270];
    for (const deg of orientations) {
      const c = deg === 0 ? canvas : rotateCanvas(canvas, deg);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const imageData = ctx.getImageData(0, 0, c.width, c.height);
      if (typeof jsQR !== 'undefined') {
        const code = jsQR(imageData.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
        if (code && code.data) {
          const match = code.data.match(/WSH-[A-Z]{3}-\d{4}-W\d{1,2}-[A-Z0-9]{4}/);
          if (match) return { formId: match[0], rotation: deg, qrLocation: code.location };
        }
      }
    }
    return null;
  }

  // ---- Tesseract Fallback for Form ID ----

  async function ocrFormId(canvas, onProgress) {
    if (typeof Tesseract === 'undefined') return null;
    try {
      const orientations = [0, 90, 180, 270];
      for (const deg of orientations) {
        const c = deg === 0 ? canvas : rotateCanvas(canvas, deg);
        const w = c.width, h = c.height;
        const regionCanvas = document.createElement('canvas');
        const regionH = Math.round(h * 0.15);
        regionCanvas.width = w; regionCanvas.height = regionH;
        const rctx = regionCanvas.getContext('2d');
        rctx.drawImage(c, 0, 0, w, regionH, 0, 0, w, regionH);
        const worker = await Tesseract.createWorker('eng', 1, {
          logger: m => { if (onProgress && m.status === 'recognizing text') onProgress(Math.round(m.progress * 50 + deg / 270 * 20)); }
        });
        const { data } = await worker.recognize(regionCanvas);
        await worker.terminate();
        const match = data.text.match(/WSH-[A-Z]{3}-\d{4}-W\d{1,2}-[A-Z0-9]{4}/);
        if (match) return { formId: match[0], rotation: deg };
      }
    } catch (e) { console.warn('OCR Form ID detection failed:', e); }
    return null;
  }

  // ---- Deskew (straighten rotated scans) ----

  // Detect the dominant skew angle of a scanned page and rotate to correct it.
  // Uses edge detection + angle histogram (simplified Hough approach).
  // Returns { canvas, angle } where angle is the correction applied in degrees.
  function deskewCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width;
    const h = canvas.height;

    // Work on a downscaled version for speed
    const SCALE = Math.min(1, 800 / Math.max(w, h));
    const sw = Math.round(w * SCALE);
    const sh = Math.round(h * SCALE);
    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(canvas, 0, 0, sw, sh);

    const imageData = sctx.getImageData(0, 0, sw, sh);
    const data = imageData.data;

    // Convert to grayscale array
    const gray = new Uint8Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) {
      gray[i] = Math.round((data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3);
    }

    // Sobel edge detection (horizontal edges — good for detecting table rows)
    const edges = new Float32Array(sw * sh);
    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        // Sobel Y kernel (detects horizontal lines)
        const gy = -gray[(y - 1) * sw + (x - 1)] - 2 * gray[(y - 1) * sw + x] - gray[(y - 1) * sw + (x + 1)]
                  + gray[(y + 1) * sw + (x - 1)] + 2 * gray[(y + 1) * sw + x] + gray[(y + 1) * sw + (x + 1)];
        // Sobel X kernel (detects vertical lines)
        const gx = -gray[(y - 1) * sw + (x - 1)] + gray[(y - 1) * sw + (x + 1)]
                  - 2 * gray[y * sw + (x - 1)] + 2 * gray[y * sw + (x + 1)]
                  - gray[(y + 1) * sw + (x - 1)] + gray[(y + 1) * sw + (x + 1)];
        edges[y * sw + x] = Math.sqrt(gx * gx + gy * gy);
      }
    }

    // Find edge threshold (top 15% of edge magnitudes)
    const sorted = Array.from(edges).sort((a, b) => a - b);
    const edgeThreshold = sorted[Math.floor(sorted.length * 0.85)];
    if (edgeThreshold < 20) {
      console.log('[OCR Deskew] No strong edges found, skipping deskew');
      return { canvas, angle: 0 };
    }

    // Angle histogram: for each strong edge pixel, compute gradient direction
    // We only care about angles near 0° and 90° (i.e., near-horizontal/vertical lines)
    // Search range: -15° to +15° in 0.1° increments
    const BINS = 301; // -15.0 to +15.0 in 0.1 steps
    const histogram = new Float32Array(BINS);

    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        if (edges[y * sw + x] < edgeThreshold) continue;

        const gy = -gray[(y - 1) * sw + (x - 1)] - 2 * gray[(y - 1) * sw + x] - gray[(y - 1) * sw + (x + 1)]
                  + gray[(y + 1) * sw + (x - 1)] + 2 * gray[(y + 1) * sw + x] + gray[(y + 1) * sw + (x + 1)];
        const gx = -gray[(y - 1) * sw + (x - 1)] + gray[(y - 1) * sw + (x + 1)]
                  - 2 * gray[y * sw + (x - 1)] + 2 * gray[y * sw + (x + 1)]
                  - gray[(y + 1) * sw + (x - 1)] + gray[(y + 1) * sw + (x + 1)];

        // Angle of the edge (perpendicular to gradient direction)
        let angle = Math.atan2(gy, gx) * 180 / Math.PI;

        // Normalize to -15..+15 range (edges near horizontal = angle near 0 or 180)
        // Horizontal lines have gradient pointing up/down (angle ~90 or ~-90)
        // So the LINE angle = gradient angle - 90
        let lineAngle = angle - 90;
        // Wrap to -90..+90
        while (lineAngle > 90) lineAngle -= 180;
        while (lineAngle < -90) lineAngle += 180;

        // We only care about near-horizontal lines (angle near 0)
        if (lineAngle >= -15 && lineAngle <= 15) {
          const bin = Math.round((lineAngle + 15) * 10);
          if (bin >= 0 && bin < BINS) {
            histogram[bin] += edges[y * sw + x]; // weight by edge strength
          }
        }
      }
    }

    // Smooth the histogram
    const smoothed = new Float32Array(BINS);
    const KERNEL = 5;
    for (let i = 0; i < BINS; i++) {
      let sum = 0, count = 0;
      for (let k = -KERNEL; k <= KERNEL; k++) {
        const idx = i + k;
        if (idx >= 0 && idx < BINS) {
          sum += histogram[idx];
          count++;
        }
      }
      smoothed[i] = sum / count;
    }

    // Find peak
    let peakBin = 150; // default = 0°
    let peakVal = 0;
    for (let i = 0; i < BINS; i++) {
      if (smoothed[i] > peakVal) {
        peakVal = smoothed[i];
        peakBin = i;
      }
    }

    const skewAngle = (peakBin - 150) / 10; // convert bin to degrees

    console.log(`[OCR Deskew] Detected skew angle: ${skewAngle.toFixed(2)}°`);

    // Only correct if skew is significant (> 0.5°) but not too large (< 15°)
    if (Math.abs(skewAngle) < 0.5) {
      console.log('[OCR Deskew] Skew too small, no correction needed');
      return { canvas, angle: 0 };
    }

    // Rotate the full-resolution canvas to correct the skew
    const corrected = document.createElement('canvas');
    corrected.width = w;
    corrected.height = h;
    const cctx = corrected.getContext('2d', { willReadFrequently: true });

    // Rotate around center
    cctx.save();
    cctx.translate(w / 2, h / 2);
    cctx.rotate((-skewAngle * Math.PI) / 180);
    cctx.translate(-w / 2, -h / 2);
    // Fill with white background to avoid black edges
    cctx.fillStyle = '#FFFFFF';
    cctx.fillRect(0, 0, w, h);
    cctx.drawImage(canvas, 0, 0);
    cctx.restore();

    console.log(`[OCR Deskew] Applied ${(-skewAngle).toFixed(2)}° correction`);
    return { canvas: corrected, angle: skewAngle };
  }

  // ---- Registration Mark Detection ----

  // Scan a region of the image for an L-shaped corner mark
  // Returns the precise pixel coordinate of the mark's corner point
  function findLMark(ctx, searchX, searchY, searchW, searchH, imgW, imgH, cornerType) {
    // cornerType: 'TL' (top-left), 'TR', 'BL', 'BR'
    // Extract the search region
    const x0 = Math.max(0, Math.round(searchX));
    const y0 = Math.max(0, Math.round(searchY));
    const w = Math.min(Math.round(searchW), imgW - x0);
    const h = Math.min(Math.round(searchH), imgH - y0);
    if (w <= 0 || h <= 0) return null;

    const imageData = ctx.getImageData(x0, y0, w, h);
    const data = imageData.data;

    // Create binary dark pixel map
    const dark = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      dark[i] = ((r + g + b) / 3 < 100) ? 1 : 0;
    }

    // Scan for the densest cluster of dark pixels in a sliding window
    // The L-mark arm is about REG_MARK_SIZE mm ~ some pixels
    const markPxApprox = Math.round(w * 0.25); // approximate mark size in pixels
    const winSize = Math.max(4, Math.round(markPxApprox));
    let bestScore = 0, bestX = 0, bestY = 0;

    const stepSize = Math.max(1, Math.round(winSize / 4));
    for (let sy = 0; sy < h - winSize; sy += stepSize) {
      for (let sx = 0; sx < w - winSize; sx += stepSize) {
        let score = 0;
        for (let dy = 0; dy < winSize; dy++) {
          for (let dx = 0; dx < winSize; dx++) {
            score += dark[(sy + dy) * w + (sx + dx)];
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestX = sx;
          bestY = sy;
        }
      }
    }

    // Minimum threshold: at least 5% of the window should be dark
    if (bestScore < winSize * winSize * 0.05) return null;

    // Refine: find exact corner of the L-mark
    // For TL mark, the corner is at the top-left of the dark cluster
    // For TR mark, the corner is at the top-right, etc.
    let cornerX, cornerY;

    // Scan the found region more precisely
    const regionSize = winSize * 2;
    const rx0 = Math.max(0, bestX - winSize / 2);
    const ry0 = Math.max(0, bestY - winSize / 2);
    const rx1 = Math.min(w, bestX + regionSize);
    const ry1 = Math.min(h, bestY + regionSize);

    // Find the bounding box of dark pixels in this region
    let minDX = rx1, minDY = ry1, maxDX = rx0, maxDY = ry0;
    for (let dy = Math.round(ry0); dy < Math.round(ry1); dy++) {
      for (let dx = Math.round(rx0); dx < Math.round(rx1); dx++) {
        if (dark[dy * w + dx]) {
          minDX = Math.min(minDX, dx);
          minDY = Math.min(minDY, dy);
          maxDX = Math.max(maxDX, dx);
          maxDY = Math.max(maxDY, dy);
        }
      }
    }

    // The corner point depends on which corner we're looking for
    switch (cornerType) {
      case 'TL': cornerX = minDX; cornerY = minDY; break;
      case 'TR': cornerX = maxDX; cornerY = minDY; break;
      case 'BL': cornerX = minDX; cornerY = maxDY; break;
      case 'BR': cornerX = maxDX; cornerY = maxDY; break;
    }

    return { x: x0 + cornerX, y: y0 + cornerY };
  }

  // Find all 4 registration marks in the image
  function findRegistrationMarks(ctx, imgW, imgH) {
    // Search in corner regions (20% of each dimension)
    const searchFrac = 0.20;
    const sw = Math.round(imgW * searchFrac);
    const sh = Math.round(imgH * searchFrac);

    const tl = findLMark(ctx, 0, 0, sw, sh, imgW, imgH, 'TL');
    const tr = findLMark(ctx, imgW - sw, 0, sw, sh, imgW, imgH, 'TR');
    const bl = findLMark(ctx, 0, imgH - sh, sw, sh, imgW, imgH, 'BL');
    const br = findLMark(ctx, imgW - sw, imgH - sh, sw, sh, imgW, imgH, 'BR');

    const found = [tl, tr, bl, br].filter(m => m !== null).length;
    console.log(`[OCR] Registration marks found: ${found}/4`, { tl, tr, bl, br });

    return { tl, tr, bl, br, count: found };
  }

  // ---- Perspective Transform ----

  // Given 4 source points (in image pixels) and 4 destination points (in mm),
  // compute a bilinear mapping from mm -> pixels
  function createPerspectiveMapper(srcPoints, dstPoints) {
    // srcPoints: { tl, tr, bl, br } in pixel coordinates
    // dstPoints: { tl, tr, bl, br } in mm coordinates
    // Returns a function that maps (mmX, mmY) -> { px, py }

    const src = srcPoints;
    const dst = dstPoints;

    // Compute the normalized position (u, v) in [0,1] from mm coordinates
    // Then bilinearly interpolate the pixel coordinates
    const dstW = dst.tr.x - dst.tl.x;
    const dstH = dst.bl.y - dst.tl.y;

    return function mapMmToPixel(mmX, mmY) {
      // Normalize to [0,1] based on the registration mark positions
      const u = (mmX - dst.tl.x) / dstW;
      const v = (mmY - dst.tl.y) / dstH;

      // Bilinear interpolation of pixel coordinates
      const topX = src.tl.x + (src.tr.x - src.tl.x) * u;
      const topY = src.tl.y + (src.tr.y - src.tl.y) * u;
      const botX = src.bl.x + (src.br.x - src.bl.x) * u;
      const botY = src.bl.y + (src.br.y - src.bl.y) * u;

      return {
        x: Math.round(topX + (botX - topX) * v),
        y: Math.round(topY + (botY - topY) * v)
      };
    };
  }

  // Simple mm-to-pixel mapping (no perspective correction, used as fallback)
  function createSimpleMapper(imgW, imgH, pageW, pageH) {
    const scaleX = imgW / pageW;
    const scaleY = imgH / pageH;
    return function mapMmToPixel(mmX, mmY) {
      return { x: Math.round(mmX * scaleX), y: Math.round(mmY * scaleY) };
    };
  }

  // ---- Checkbox Detection ----

  function measureDarknessAtPx(ctx, cx, cy, radiusPx, imgW, imgH) {
    // Sample a square region around center point
    const r = Math.max(2, Math.round(radiusPx));
    const x0 = Math.max(0, cx - r);
    const y0 = Math.max(0, cy - r);
    const x1 = Math.min(imgW, cx + r);
    const y1 = Math.min(imgH, cy + r);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return 0;

    try {
      const imageData = ctx.getImageData(x0, y0, w, h);
      const data = imageData.data;
      let darkPixels = 0;
      const total = w * h;
      for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (brightness < 130) darkPixels++;
      }
      return darkPixels / total;
    } catch (e) { return 0; }
  }

  // ---- Main Checkbox Analysis ----

  function analyzeCheckboxes(ctx, imgW, imgH, worksheet, mapper) {
    const L = PDFGenerator.layout;
    const items = worksheet.items || [];
    const days = APP_CONFIG.daysShort;

    // We need to know where the table data starts
    // Estimate header end from PDF layout (same logic as pdf-generator)
    const barH = 9, infoH = 9, qrSize = 13, statsH = 15;
    const infoY = L.MARGIN + barH + 0.5;
    const qrY = infoY + infoH + 0.5;
    const statsY = qrY;
    const headerEnd = Math.max(statsY + statsH + 1, qrY + qrSize + 1);
    const tableHeaderH = 9;
    const footerReserve = 8;
    const dataStartY = headerEnd + tableHeaderH;
    const availableH = L.PAGE_H - L.MARGIN - footerReserve - (headerEnd - L.MARGIN) - tableHeaderH;
    const rowH = Math.min(Math.max(availableH / L.TOTAL_ROWS, 5.5), 11);

    // Also try to detect the blue header bar for better alignment
    const blueBar = findBlueHeaderBar(ctx, imgW, imgH, mapper);
    let actualDataStartY = dataStartY;
    let actualRowH = rowH;

    if (blueBar) {
      actualDataStartY = blueBar.bottomMm;
      const actualAvailableH = L.PAGE_H - L.MARGIN - footerReserve - blueBar.bottomMm;
      actualRowH = Math.min(Math.max(actualAvailableH / L.TOTAL_ROWS, 5.5), 11);
      console.log(`[OCR] Blue bar at ${blueBar.topMm.toFixed(1)}-${blueBar.bottomMm.toFixed(1)}mm, rowH=${actualRowH.toFixed(1)}`);
    }

    // Compute pixel size of checkbox inner region for sampling
    // Parent checkbox is CB_P mm, sample inner 55%
    const sampleSizeMm = L.CB_P * 0.55;
    // Map to get approximate pixel size
    const p1 = mapper(0, 0);
    const p2 = mapper(sampleSizeMm, 0);
    const sampleRadiusPx = Math.abs(p2.x - p1.x) / 2;

    const darknessValues = [];
    const results = [];

    // First pass: measure darkness at each PARENT checkbox center
    for (let row = 0; row < items.length; row++) {
      const item = items[row];
      const applicableDays = item.daysApplicable || days;
      const rowY = actualDataStartY + row * actualRowH;
      const midY = rowY + actualRowH / 2;

      for (let d = 0; d < 7; d++) {
        const dayName = days[d];
        if (!applicableDays.includes(dayName)) continue;

        const dayX = L.MARGIN + L.COL.dayStart + d * L.COL.dayW;
        const halfW = L.COL.dayW / 2;

        // Parent checkbox center (right half of day column)
        const parentCenterMmX = dayX + halfW + halfW / 2;
        const parentCenterMmY = midY;

        const parentPx = mapper(parentCenterMmX, parentCenterMmY);
        const parentDark = measureDarknessAtPx(ctx, parentPx.x, parentPx.y, sampleRadiusPx, imgW, imgH);
        darknessValues.push({ row, day: d, type: 'parent', value: parentDark, px: parentPx });

        // Also measure child checkbox for display (left half)
        const childCenterMmX = dayX + halfW / 2;
        const childPx = mapper(childCenterMmX, parentCenterMmY);
        const childDark = measureDarknessAtPx(ctx, childPx.x, childPx.y, sampleRadiusPx, imgW, imgH);
        darknessValues.push({ row, day: d, type: 'child', value: childDark, px: childPx });
      }
    }

    // Adaptive threshold using Otsu-like approach on PARENT values only
    const parentValues = darknessValues.filter(v => v.type === 'parent').map(v => v.value).sort((a, b) => a - b);
    let threshold = 0.12;

    if (parentValues.length > 4) {
      // Find best split using between-class variance
      let bestThresh = 0.12, bestVariance = 0;
      for (let t = 0.05; t <= 0.50; t += 0.01) {
        const below = parentValues.filter(v => v <= t);
        const above = parentValues.filter(v => v > t);
        if (below.length === 0 || above.length === 0) continue;
        const meanBelow = below.reduce((s, v) => s + v, 0) / below.length;
        const meanAbove = above.reduce((s, v) => s + v, 0) / above.length;
        const variance = below.length * above.length * Math.pow(meanAbove - meanBelow, 2);
        if (variance > bestVariance) {
          bestVariance = variance;
          bestThresh = t;
        }
      }
      threshold = bestThresh;
      // Ensure reasonable range
      threshold = Math.max(0.08, Math.min(threshold, 0.40));
    }

    console.log('[OCR] Parent checkbox darkness stats:', {
      min: parentValues[0]?.toFixed(3),
      q25: parentValues[Math.floor(parentValues.length * 0.25)]?.toFixed(3),
      median: parentValues[Math.floor(parentValues.length / 2)]?.toFixed(3),
      q75: parentValues[Math.floor(parentValues.length * 0.75)]?.toFixed(3),
      max: parentValues[parentValues.length - 1]?.toFixed(3),
      threshold: threshold.toFixed(3),
      count: parentValues.length
    });

    // Second pass: classify
    for (let row = 0; row < items.length; row++) {
      const item = items[row];
      const applicableDays = item.daysApplicable || days;
      const rowResults = {};

      for (let d = 0; d < 7; d++) {
        const dayName = days[d];
        if (!applicableDays.includes(dayName)) continue;

        const parentEntry = darknessValues.find(v => v.row === row && v.day === d && v.type === 'parent');
        const childEntry = darknessValues.find(v => v.row === row && v.day === d && v.type === 'child');

        // Only parent checkbox determines the score
        const parentChecked = parentEntry && parentEntry.value > threshold;

        rowResults[dayName] = {
          completed: parentChecked || false,
          confirmed: parentChecked || false,
          parentDarkness: parentEntry ? parentEntry.value : 0,
          childDarkness: childEntry ? childEntry.value : 0,
        };
      }

      results.push({ index: row, text: item.text, results: rowResults });
    }

    return { results, threshold, darknessValues };
  }

  // ---- Blue Header Bar Detection (improved with mapper) ----

  function findBlueHeaderBar(ctx, imgW, imgH, mapper) {
    // Use the mapper to convert expected blue bar position to pixels
    const L = PDFGenerator.layout;
    const barH = 9, infoH = 9, qrSize = 13, statsH = 15;
    const infoY = L.MARGIN + barH + 0.5;
    const expectedBarTopMm = Math.max(infoY + infoH + 0.5 + statsH + 1, infoY + infoH + 0.5 + qrSize + 1);

    // Search in a range around the expected position
    const searchStartMm = expectedBarTopMm - 5;
    const searchEndMm = expectedBarTopMm + 10;

    const startPx = mapper ? mapper(L.MARGIN, searchStartMm) : { y: Math.round(searchStartMm / L.PAGE_H * imgH) };
    const endPx = mapper ? mapper(L.MARGIN, searchEndMm) : { y: Math.round(searchEndMm / L.PAGE_H * imgH) };

    for (let row = startPx.y; row < Math.min(endPx.y, imgH - 1); row += 2) {
      let blueCount = 0;
      const sampleCols = 20;
      for (let c = 0; c < sampleCols; c++) {
        const x = Math.round((c + 0.5) / sampleCols * imgW * 0.8 + imgW * 0.1);
        if (x >= imgW) continue;
        const pixel = ctx.getImageData(x, row, 1, 1).data;
        const r = pixel[0], g = pixel[1], b = pixel[2];
        if (b > 150 && b > r * 1.3 && b > g * 1.1) blueCount++;
      }
      if (blueCount > sampleCols * 0.6) {
        let barBottom = row;
        for (let r2 = row; r2 < Math.min(row + Math.round(imgH * 0.08), imgH); r2++) {
          let stillBlue = 0;
          for (let c = 0; c < 10; c++) {
            const x = Math.round((c + 0.5) / 10 * imgW * 0.6 + imgW * 0.2);
            if (x >= imgW) continue;
            const pixel = ctx.getImageData(x, r2, 1, 1).data;
            if (pixel[2] > 150 && pixel[2] > pixel[0] * 1.3) stillBlue++;
          }
          if (stillBlue > 5) barBottom = r2;
          else break;
        }
        const topMm = (row / imgH) * L.PAGE_H;
        const bottomMm = (barBottom / imgH) * L.PAGE_H;
        return { topMm, bottomMm, topPx: row, bottomPx: barBottom };
      }
    }
    return null;
  }

  // ---- Public API ----

  return {
    async processImage(imageFile, worksheet, onProgress) {
      try {
        if (onProgress) onProgress(5);
        const L = PDFGenerator.layout;

        // Step 1: Load image
        const img = await loadImage(imageFile);
        let { canvas } = imageToCanvas(img, 3000);
        if (onProgress) onProgress(10);

        // Step 2: Detect QR code (tries all 4 orientations)
        let qrResult = detectQR(canvas);
        if (onProgress) onProgress(25);

        // Step 3: Determine orientation and rotate
        const rotation = qrResult ? qrResult.rotation : (canvas.height > canvas.width * 1.1 ? 90 : 0);
        if (rotation !== 0) {
          canvas = rotateCanvas(canvas, rotation);
        }
        if (onProgress) onProgress(30);

        // Step 3b: Deskew — straighten small rotational skew (up to ±15°)
        const deskewResult = deskewCanvas(canvas);
        canvas = deskewResult.canvas;
        if (onProgress) onProgress(35);

        // Step 4: Try Tesseract if no QR
        let formId = qrResult ? qrResult.formId : null;
        if (!formId) {
          const ocrResult = await ocrFormId(canvas, onProgress);
          if (ocrResult) formId = ocrResult.formId;
        }
        if (onProgress) onProgress(50);

        // Step 5: Find registration marks for perspective correction
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const imgW = canvas.width;
        const imgH = canvas.height;

        const regMarks = findRegistrationMarks(ctx, imgW, imgH);
        if (onProgress) onProgress(60);

        // Step 6: Create coordinate mapper
        let mapper;
        if (regMarks.count >= 3) {
          // Fill in any missing mark by estimating from the others
          const marks = { ...regMarks };
          if (!marks.tl && marks.tr && marks.bl) {
            marks.tl = { x: marks.bl.x, y: marks.tr.y };
          } else if (!marks.tr && marks.tl && marks.br) {
            marks.tr = { x: marks.br.x, y: marks.tl.y };
          } else if (!marks.bl && marks.tl && marks.br) {
            marks.bl = { x: marks.tl.x, y: marks.br.y };
          } else if (!marks.br && marks.tr && marks.bl) {
            marks.br = { x: marks.tr.x, y: marks.bl.y };
          }

          if (marks.tl && marks.tr && marks.bl && marks.br) {
            const srcPoints = { tl: marks.tl, tr: marks.tr, bl: marks.bl, br: marks.br };
            const dstPoints = {
              tl: { x: L.REG_MARKS.topLeft.x, y: L.REG_MARKS.topLeft.y },
              tr: { x: L.REG_MARKS.topRight.x + L.REG_MARK_SIZE, y: L.REG_MARKS.topRight.y },
              bl: { x: L.REG_MARKS.bottomLeft.x, y: L.REG_MARKS.bottomLeft.y + L.REG_MARK_SIZE },
              br: { x: L.REG_MARKS.bottomRight.x + L.REG_MARK_SIZE, y: L.REG_MARKS.bottomRight.y + L.REG_MARK_SIZE },
            };
            mapper = createPerspectiveMapper(srcPoints, dstPoints);
            console.log('[OCR] Using perspective-corrected mapping from registration marks');
          } else {
            mapper = createSimpleMapper(imgW, imgH, L.PAGE_W, L.PAGE_H);
            console.log('[OCR] Falling back to simple coordinate mapping');
          }
        } else {
          mapper = createSimpleMapper(imgW, imgH, L.PAGE_W, L.PAGE_H);
          console.log('[OCR] No registration marks found, using simple mapping');
        }

        // Step 7: Analyze checkboxes
        let checkboxResults = null;
        if (worksheet && worksheet.items && worksheet.items.length > 0) {
          if (onProgress) onProgress(70);
          checkboxResults = analyzeCheckboxes(ctx, imgW, imgH, worksheet, mapper);
          if (onProgress) onProgress(90);
        }

        if (onProgress) onProgress(100);

        return {
          success: true,
          serialNumber: formId,
          rotation: rotation,
          skewCorrected: deskewResult.angle,
          qrDetected: !!qrResult,
          regMarksFound: regMarks.count,
          items: checkboxResults ? checkboxResults.results : [],
          threshold: checkboxResults ? checkboxResults.threshold : null,
          rawDarkness: checkboxResults ? checkboxResults.darknessValues : [],
          canvasWidth: imgW,
          canvasHeight: imgH,
        };

      } catch (error) {
        console.error('[OCR] Processing error:', error);
        return { success: false, error: error.message };
      }
    },

    createManualResults(worksheet, dayResults) {
      const items = worksheet.items.map((item, idx) => ({
        index: idx, text: item.text, results: {}
      }));
      Object.keys(dayResults).forEach(day => {
        Object.keys(dayResults[day]).forEach(itemIdx => {
          const i = parseInt(itemIdx);
          if (items[i]) {
            items[i].results[day] = { completed: dayResults[day][itemIdx], confirmed: false };
          }
        });
      });
      return { items };
    }
  };
})();
