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

  // ---- Registration Mark Detection (v2 — targeted search) ----

  // Search for an L-shaped corner mark near an EXPECTED pixel position.
  // v1 scanned the entire 20% corner quadrant and picked the densest dark cluster,
  // which often landed on the QR code or text content instead of the thin L-mark.
  // v2 uses the known form geometry to estimate where each mark should be, then
  // searches a focused area around that estimate, with a mark-sized window.
  function findLMark(ctx, expectedPx, searchRadius, imgW, imgH, cornerType, markSizePx) {
    const x0 = Math.max(0, Math.round(expectedPx.x - searchRadius));
    const y0 = Math.max(0, Math.round(expectedPx.y - searchRadius));
    const x1 = Math.min(imgW, Math.round(expectedPx.x + searchRadius));
    const y1 = Math.min(imgH, Math.round(expectedPx.y + searchRadius));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 4 || h <= 4) return null;

    const imageData = ctx.getImageData(x0, y0, w, h);
    const data = imageData.data;

    // Binary dark pixel map — threshold 130 for robustness with scanned docs
    const dark = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      dark[i] = ((r + g + b) / 3 < 130) ? 1 : 0;
    }

    // Sliding window sized to the ACTUAL mark (not 25% of search region!)
    // The L-mark is ~5mm with 1.2mm thick arms — its bounding box is markSizePx square
    const winSize = Math.max(6, Math.round(markSizePx * 1.3));
    const step = Math.max(1, Math.round(winSize / 5));

    let bestScore = 0, bestX = 0, bestY = 0;
    for (let sy = 0; sy <= h - winSize; sy += step) {
      for (let sx = 0; sx <= w - winSize; sx += step) {
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

    // Minimum threshold: at least 4% of window should be dark
    if (bestScore < winSize * winSize * 0.04) return null;

    // Refine: find bounding box of dark pixels near the best cluster
    const pad = Math.round(winSize * 0.3);
    const rx0 = Math.max(0, bestX - pad);
    const ry0 = Math.max(0, bestY - pad);
    const rx1 = Math.min(w, bestX + winSize + pad);
    const ry1 = Math.min(h, bestY + winSize + pad);

    let minDX = rx1, minDY = ry1, maxDX = rx0, maxDY = ry0;
    for (let dy = ry0; dy < ry1; dy++) {
      for (let dx = rx0; dx < rx1; dx++) {
        if (dark[dy * w + dx]) {
          minDX = Math.min(minDX, dx);
          minDY = Math.min(minDY, dy);
          maxDX = Math.max(maxDX, dx);
          maxDY = Math.max(maxDY, dy);
        }
      }
    }

    // The corner point depends on which corner we're detecting
    let cornerX, cornerY;
    switch (cornerType) {
      case 'TL': cornerX = minDX; cornerY = minDY; break;
      case 'TR': cornerX = maxDX; cornerY = minDY; break;
      case 'BL': cornerX = minDX; cornerY = maxDY; break;
      case 'BR': cornerX = maxDX; cornerY = maxDY; break;
    }

    return {
      x: x0 + cornerX,
      y: y0 + cornerY,
      bbox: { x: x0 + minDX, y: y0 + minDY, w: maxDX - minDX, h: maxDY - minDY }
    };
  }

  // Find all 4 registration marks using targeted search around expected positions
  function findRegistrationMarks(ctx, imgW, imgH) {
    const L = PDFGenerator.layout;
    const scaleX = imgW / L.PAGE_W;
    const scaleY = imgH / L.PAGE_H;

    // Physical corner points of each L-mark in mm
    // These are the OUTER corners of the L-shapes (matching the dst points in the mapper)
    // TL: top-left of bounding box = (REG_INSET, REG_INSET)
    // TR: top-right of bounding box = (topRight.x + MARK_SIZE, REG_INSET)
    // BL: bottom-left = (REG_INSET, bottomLeft.y + MARK_SIZE)
    // BR: bottom-right = (bottomRight.x + MARK_SIZE, bottomRight.y + MARK_SIZE)
    const dstCornersMm = {
      tl: { x: L.REG_MARKS.topLeft.x, y: L.REG_MARKS.topLeft.y },
      tr: { x: L.REG_MARKS.topRight.x + L.REG_MARK_SIZE, y: L.REG_MARKS.topRight.y },
      bl: { x: L.REG_MARKS.bottomLeft.x, y: L.REG_MARKS.bottomLeft.y + L.REG_MARK_SIZE },
      br: { x: L.REG_MARKS.bottomRight.x + L.REG_MARK_SIZE, y: L.REG_MARKS.bottomRight.y + L.REG_MARK_SIZE },
    };

    // Estimated pixel positions (may be off due to print scaling/margins)
    const expected = {};
    for (const k of ['tl', 'tr', 'bl', 'br']) {
      expected[k] = { x: Math.round(dstCornersMm[k].x * scaleX), y: Math.round(dstCornersMm[k].y * scaleY) };
    }

    // Mark size in pixels
    const markSizePx = Math.round(L.REG_MARK_SIZE * Math.min(scaleX, scaleY));
    // Search radius: 6% of image max dimension — covers up to ~10% print scaling
    const searchRadius = Math.round(Math.max(imgW, imgH) * 0.06);

    console.log(`[OCR v5] Expected mark positions (px):`, expected);
    console.log(`[OCR v5] Mark size: ${markSizePx}px, search radius: ${searchRadius}px`);

    const tl = findLMark(ctx, expected.tl, searchRadius, imgW, imgH, 'TL', markSizePx);
    const tr = findLMark(ctx, expected.tr, searchRadius, imgW, imgH, 'TR', markSizePx);
    const bl = findLMark(ctx, expected.bl, searchRadius, imgW, imgH, 'BL', markSizePx);
    const br = findLMark(ctx, expected.br, searchRadius, imgW, imgH, 'BR', markSizePx);

    const found = [tl, tr, bl, br].filter(m => m !== null).length;
    console.log(`[OCR v5] Registration marks found: ${found}/4`, { tl, tr, bl, br });

    return { tl, tr, bl, br, count: found, expected, dstCornersMm };
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

  // ---- Checkbox Detection v3 ----
  // Center-focused sampling with contrast ratio and debug overlay

  // Measure average brightness in a small square region
  function avgBrightness(ctx, cx, cy, halfSize, imgW, imgH) {
    const r = Math.max(1, Math.round(halfSize));
    const x0 = Math.max(0, cx - r);
    const y0 = Math.max(0, cy - r);
    const x1 = Math.min(imgW, cx + r);
    const y1 = Math.min(imgH, cy + r);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return 255;
    try {
      const imageData = ctx.getImageData(x0, y0, w, h);
      const data = imageData.data;
      let sum = 0;
      const total = w * h;
      for (let i = 0; i < data.length; i += 4) {
        sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      }
      return sum / total;
    } catch (e) { return 255; }
  }

  // Detect diagonal strokes (checkmarks) — sample along both diagonals of the checkbox
  // Returns max ink density found along either diagonal
  function diagonalInk(ctx, cx, cy, halfSize, imgW, imgH, darkThresh) {
    const r = Math.max(2, Math.round(halfSize));
    const steps = Math.max(5, r); // number of sample points along each diagonal
    let maxInk = 0;

    // For each diagonal direction: top-left→bottom-right (\) and top-right→bottom-left (/)
    for (const dir of [1, -1]) {
      let darkCount = 0;
      let totalCount = 0;
      for (let i = 0; i < steps; i++) {
        const t = (i / (steps - 1)) * 2 - 1; // -1 to 1
        const sx = Math.round(cx + t * r);
        const sy = Math.round(cy + t * dir * r);
        if (sx < 0 || sx >= imgW || sy < 0 || sy >= imgH) continue;

        // Sample a small cross at each point (3x3) for robustness
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const px = sx + dx;
            const py = sy + dy;
            if (px < 0 || px >= imgW || py < 0 || py >= imgH) continue;
            const pixel = ctx.getImageData(px, py, 1, 1).data;
            if (isHandwrittenInk(pixel[0], pixel[1], pixel[2], darkThresh)) darkCount++;
            totalCount++;
          }
        }
      }
      if (totalCount > 0) {
        maxInk = Math.max(maxInk, darkCount / totalCount);
      }
    }
    return maxInk;
  }

  // Check if a pixel is handwritten ink (not a printed checkbox border).
  // The PDF now uses very light borders (brightness ~210-220) so any pen/pencil
  // mark (brightness < 160) is clearly distinguishable. We also reject any pixel
  // that looks like a scanned version of the light blue/gray borders.
  function isHandwrittenInk(r, g, b, darkThresh) {
    const brightness = (r + g + b) / 3;
    if (brightness >= darkThresh) return false; // too light to be ink
    // Exclude scanned blue border remnants: high blue relative to red
    if (b > 140 && b > r * 1.2 && brightness > 120) return false;
    // Exclude scanned gray border remnants: all channels similar and not very dark
    if (brightness > 150 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20) return false;
    return true; // genuinely dark mark = pen/pencil ink
  }

  // Count ink-density: fraction of pixels that are handwritten ink (not blue borders)
  function inkDensity(ctx, cx, cy, halfSize, imgW, imgH, darkThresh) {
    const r = Math.max(1, Math.round(halfSize));
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
      let darkCount = 0;
      const total = w * h;
      for (let i = 0; i < data.length; i += 4) {
        if (isHandwrittenInk(data[i], data[i + 1], data[i + 2], darkThresh)) darkCount++;
      }
      return darkCount / total;
    } catch (e) { return 0; }
  }

  // ---- Main Checkbox Analysis v3 ----
  // Strategy: For each parent checkbox, compute its exact mm position from PDF layout,
  // map to pixel coordinates, then:
  //   1. Sample a TIGHT center region (25% of checkbox size) — avoids borders
  //   2. Sample a SURROUND ring just outside the checkbox — establishes baseline
  //   3. Use contrast ratio (surround brightness - center brightness) for detection
  //   4. Build debug overlay showing exactly where we're sampling

  function analyzeCheckboxes(ctx, imgW, imgH, worksheet, mapper, regMarks) {
    const L = PDFGenerator.layout;
    const items = worksheet.items || [];
    const days = APP_CONFIG.daysShort;

    // Use exported constants from PDF generator (exact values, not estimates)
    const barH = 9, infoH = 9, qrSize = 13, statsH = 15;
    const infoY = L.MARGIN + barH + 0.5;
    const qrY = infoY + infoH + 0.5;
    const statsY = qrY;
    const headerEnd = Math.max(statsY + statsH + 1, qrY + qrSize + 1);
    const tableHeaderH = L.TABLE_HEADER_H || 10;
    const footerReserve = L.FOOTER_RESERVE || 8;

    // Detect the blue table header bar for precise vertical alignment
    const blueBar = findBlueHeaderBar(ctx, imgW, imgH, mapper);
    let dataStartMmY;
    let rowH;

    if (blueBar) {
      // Blue bar bottom edge = exact start of data rows
      dataStartMmY = blueBar.bottomMm;
      // Match PDF generator's EXACT row height calculation:
      // PDF uses: availableH = PAGE_H - MARGIN - footerReserve - (headerEnd - MARGIN) - 9
      // where headerEnd = blueBar top, and 9 is the tableHeaderH used in the PDF calc
      // (Note: actual table header drawn is 10mm, but PDF uses 9 in its height formula)
      const pdfHeaderEnd = dataStartMmY - 10; // blue bar is 10mm tall
      const pdfTableHeaderCalc = 9; // PDF generator's internal value
      const availableH = L.PAGE_H - L.MARGIN - footerReserve - (pdfHeaderEnd - L.MARGIN) - pdfTableHeaderCalc;
      rowH = Math.min(Math.max(availableH / L.TOTAL_ROWS, 5.5), 11);
      console.log(`[OCR v4] Blue bar detected: ${blueBar.topMm.toFixed(1)}-${blueBar.bottomMm.toFixed(1)}mm, dataStart=${dataStartMmY.toFixed(1)}mm, rowH=${rowH.toFixed(2)}mm`);
    } else {
      dataStartMmY = headerEnd + tableHeaderH;
      const availableH = L.PAGE_H - L.MARGIN - footerReserve - (headerEnd - L.MARGIN) - tableHeaderH;
      rowH = Math.min(Math.max(availableH / L.TOTAL_ROWS, 5.5), 11);
      console.log(`[OCR v4] No blue bar, estimated dataStart=${dataStartMmY.toFixed(1)}mm, rowH=${rowH.toFixed(2)}mm`);
    }

    // Compute pixel sizes for sampling regions
    // Parent checkbox is CB_P mm (4.5mm). We sample the center 50% — catches handwritten strokes
    // that don't pass through exact center, while still avoiding borders
    const centerSizeMm = L.CB_P * 0.50;
    const surroundSizeMm = L.CB_P * 0.8; // slightly larger than the checkbox for surround
    const p1 = mapper(0, 0);
    const p2 = mapper(centerSizeMm, 0);
    const centerHalfPx = Math.max(3, Math.abs(p2.x - p1.x));
    const p3 = mapper(surroundSizeMm, 0);
    const surroundHalfPx = Math.max(5, Math.abs(p3.x - p1.x));

    // Compute diagonal sampling size (45% of checkbox, for stroke detection)
    const diagSizeMm = L.CB_P * 0.45;
    const pDiag = mapper(diagSizeMm, 0);
    const diagHalfPx = Math.max(3, Math.abs(pDiag.x - p1.x));

    // Build debug overlay canvas (copy of scanned image with annotations)
    const debugCanvas = document.createElement('canvas');
    debugCanvas.width = imgW;
    debugCanvas.height = imgH;
    const dbg = debugCanvas.getContext('2d');
    dbg.drawImage(ctx.canvas, 0, 0);

    // ---- Draw registration marks + QR code on debug overlay ----
    const debugFontSize = Math.max(12, Math.round(imgW / 200));
    const debugFontSmall = Math.max(10, Math.round(imgW / 250));

    if (regMarks) {
      // Draw DETECTED mark positions (green circles + bounding boxes)
      for (const key of ['tl', 'tr', 'bl', 'br']) {
        const mark = regMarks[key];
        if (mark) {
          dbg.strokeStyle = '#00ff00';
          dbg.lineWidth = 3;
          dbg.beginPath();
          dbg.arc(mark.x, mark.y, 15, 0, Math.PI * 2);
          dbg.stroke();
          dbg.fillStyle = '#00ff00';
          dbg.font = `bold ${debugFontSize}px monospace`;
          dbg.fillText(`${key.toUpperCase()} det`, mark.x + 20, mark.y + 5);
          if (mark.bbox) {
            dbg.strokeStyle = 'rgba(0,255,0,0.5)';
            dbg.lineWidth = 1;
            dbg.strokeRect(mark.bbox.x, mark.bbox.y, mark.bbox.w, mark.bbox.h);
          }
        }
      }
      // Draw EXPECTED mark positions (yellow circles + lines to detected)
      if (regMarks.expected) {
        for (const key of ['tl', 'tr', 'bl', 'br']) {
          const pos = regMarks.expected[key];
          if (!pos) continue;
          dbg.strokeStyle = '#ffff00';
          dbg.lineWidth = 2;
          dbg.beginPath();
          dbg.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
          dbg.stroke();
          dbg.fillStyle = '#ffff00';
          dbg.font = `${debugFontSmall}px monospace`;
          dbg.fillText(`${key.toUpperCase()} exp`, pos.x + 20, pos.y - 8);
          // Line from expected to detected
          const det = regMarks[key];
          if (det) {
            dbg.strokeStyle = 'rgba(255,255,0,0.4)';
            dbg.lineWidth = 1;
            dbg.setLineDash([4, 4]);
            dbg.beginPath();
            dbg.moveTo(pos.x, pos.y);
            dbg.lineTo(det.x, det.y);
            dbg.stroke();
            dbg.setLineDash([]);
            // Show pixel offset
            const dx = det.x - pos.x, dy = det.y - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            dbg.fillStyle = '#ffff00';
            dbg.font = `${debugFontSmall}px monospace`;
            dbg.fillText(`Δ${dist.toFixed(0)}px`, (pos.x + det.x) / 2 + 5, (pos.y + det.y) / 2 - 5);
          }
        }
      }
    }

    // Draw QR code expected position on debug overlay
    if (mapper) {
      const qrSizeMm = 13;
      const qrXMm = L.MARGIN + L.CONTENT_W - qrSizeMm - 1;
      const qrYMm = L.MARGIN + 9 + 0.5 + 9 + 0.5; // title bar + info strip
      const qrTL = mapper(qrXMm, qrYMm);
      const qrBR = mapper(qrXMm + qrSizeMm, qrYMm + qrSizeMm);
      dbg.strokeStyle = '#00ffff';
      dbg.lineWidth = 2;
      dbg.strokeRect(qrTL.x, qrTL.y, qrBR.x - qrTL.x, qrBR.y - qrTL.y);
      dbg.fillStyle = '#00ffff';
      dbg.font = `bold ${debugFontSmall}px monospace`;
      dbg.fillText('QR', qrTL.x + 3, qrTL.y - 5);
    }

    // Draw table column grid on debug overlay for visual alignment verification
    if (mapper) {
      dbg.strokeStyle = 'rgba(255,0,255,0.15)';
      dbg.lineWidth = 1;
      for (let d = 0; d <= 7; d++) {
        const colX = L.MARGIN + L.COL.dayStart + d * L.COL.dayW;
        const top = mapper(colX, L.MARGIN);
        const bot = mapper(colX, L.PAGE_H - L.MARGIN);
        dbg.beginPath();
        dbg.moveTo(top.x, top.y);
        dbg.lineTo(bot.x, bot.y);
        dbg.stroke();
        // Day column midlines (child|parent separator)
        if (d < 7) {
          const midX = colX + L.COL.dayW / 2;
          const midTop = mapper(midX, L.MARGIN);
          const midBot = mapper(midX, L.PAGE_H - L.MARGIN);
          dbg.strokeStyle = 'rgba(255,0,255,0.08)';
          dbg.beginPath();
          dbg.moveTo(midTop.x, midTop.y);
          dbg.lineTo(midBot.x, midBot.y);
          dbg.stroke();
          dbg.strokeStyle = 'rgba(255,0,255,0.15)';
        }
      }
    }

    const measurements = [];

    // Measure each parent checkbox
    for (let row = 0; row < items.length; row++) {
      const item = items[row];
      const applicableDays = item.daysApplicable || days;
      const rowY = dataStartMmY + row * rowH;
      const midY = rowY + rowH / 2;

      for (let d = 0; d < 7; d++) {
        const dayName = days[d];
        if (!applicableDays.includes(dayName)) continue;

        const dayX = L.MARGIN + L.COL.dayStart + d * L.COL.dayW;
        const halfW = L.COL.dayW / 2;

        // Parent checkbox center — exact formula from pdf-generator:
        //   parentCbX = dayX + halfW + (halfW - CB_P) / 2
        //   parentCbY = midY - CB_P / 2
        //   center = parentCbX + CB_P/2, parentCbY + CB_P/2
        const parentCenterMmX = dayX + halfW + (halfW - L.CB_P) / 2 + L.CB_P / 2;
        const parentCenterMmY = midY;

        const parentPx = mapper(parentCenterMmX, parentCenterMmY);

        // 1. Center brightness (inner region, 40% of checkbox to catch handwritten strokes)
        const centerBright = avgBrightness(ctx, parentPx.x, parentPx.y, centerHalfPx, imgW, imgH);

        // 2. Ink density in center region (threshold 160 = catches pen/pencil, ignores light borders)
        const centerInk = inkDensity(ctx, parentPx.x, parentPx.y, centerHalfPx, imgW, imgH, 160);

        // 3. Diagonal stroke detection — catches checkmarks that are lines, not fills
        const diagInk = diagonalInk(ctx, parentPx.x, parentPx.y, diagHalfPx, imgW, imgH, 160);

        // 4. Surround brightness (area around the checkbox for baseline)
        // Sample 4 points outside the checkbox (above, below, left, right)
        const offset = surroundHalfPx;
        const sAbove = avgBrightness(ctx, parentPx.x, parentPx.y - offset, centerHalfPx, imgW, imgH);
        const sBelow = avgBrightness(ctx, parentPx.x, parentPx.y + offset, centerHalfPx, imgW, imgH);
        const sLeft  = avgBrightness(ctx, parentPx.x - offset, parentPx.y, centerHalfPx, imgW, imgH);
        const sRight = avgBrightness(ctx, parentPx.x + offset, parentPx.y, centerHalfPx, imgW, imgH);
        const surroundBright = (sAbove + sBelow + sLeft + sRight) / 4;

        // 5. Contrast: how much darker is the center vs the surround?
        //    Positive = center is darker = likely has ink
        const contrastDrop = surroundBright - centerBright;
        // Normalized contrast (0..1 scale)
        const contrastRatio = Math.max(0, contrastDrop) / Math.max(surroundBright, 1);

        // Combined ink score: max of center fill and diagonal stroke detection
        const combinedInk = Math.max(centerInk, diagInk);

        measurements.push({
          row, day: d, type: 'parent',
          px: parentPx,
          centerBright, surroundBright, contrastDrop, contrastRatio,
          centerInk, diagInk, combinedInk,
          mmX: parentCenterMmX, mmY: parentCenterMmY,
        });

        // Also measure child checkbox for informational display
        const childCenterMmX = dayX + (halfW - L.CB) / 2 + L.CB / 2;
        const childPx = mapper(childCenterMmX, midY);
        const childCenterBright = avgBrightness(ctx, childPx.x, childPx.y, centerHalfPx, imgW, imgH);
        const childInk = inkDensity(ctx, childPx.x, childPx.y, centerHalfPx, imgW, imgH, 150);
        measurements.push({
          row, day: d, type: 'child',
          px: childPx,
          centerBright: childCenterBright, centerInk: childInk,
        });
      }
    }

    // ---- Simple "any ink = checked" detection ----
    // An empty checkbox center is white paper with near-zero ink.
    // Any intentional mark (pen, pencil, marker) will produce measurable ink.
    // We use a very low fixed threshold to catch even light marks,
    // just above scanner noise floor (~2% ink from paper texture/noise).
    const parentMeasurements = measurements.filter(m => m.type === 'parent');

    // Fixed thresholds — deliberately low to catch any intentional mark
    const INK_THRESHOLD = 0.03;      // 3% ink density = any mark at all
    const CONTRAST_THRESHOLD = 0.02; // 2% contrast = slightly darker than surroundings

    // Log all measurements for debugging
    console.log('[OCR v4] Detection mode: ANY INK = CHECKED');
    console.log('[OCR v4] Fixed thresholds: ink >= 3%, contrast >= 2%');
    console.log('[OCR v4] Per-checkbox measurements:');
    parentMeasurements.forEach(m => {
      const hasInk = m.combinedInk > INK_THRESHOLD || m.contrastRatio > CONTRAST_THRESHOLD;
      console.log(`  R${m.row}D${m.day}: ${hasInk ? 'CHECKED' : 'empty  '} | contrast=${(m.contrastRatio*100).toFixed(1)}% center=${(m.centerInk*100).toFixed(1)}% diag=${(m.diagInk*100).toFixed(1)}% combined=${(m.combinedInk*100).toFixed(1)}% | bright: center=${m.centerBright.toFixed(0)} surround=${m.surroundBright.toFixed(0)}`);
    });

    // ---- Classify and draw debug overlay ----
    const results = [];
    const darknessValues = []; // backward compat

    for (let row = 0; row < items.length; row++) {
      const item = items[row];
      const applicableDays = item.daysApplicable || days;
      const rowResults = {};

      for (let d = 0; d < 7; d++) {
        const dayName = days[d];
        if (!applicableDays.includes(dayName)) continue;

        const pm = parentMeasurements.find(m => m.row === row && m.day === d);
        const cm = measurements.find(m => m.row === row && m.day === d && m.type === 'child');
        if (!pm) continue;

        // Any ink in the checkbox = checked. Simple and decisive.
        const hasInk = pm.combinedInk > INK_THRESHOLD;
        const hasContrast = pm.contrastRatio > CONTRAST_THRESHOLD;
        const parentChecked = hasInk || hasContrast;

        rowResults[dayName] = {
          completed: parentChecked,
          confirmed: parentChecked,
          parentDarkness: pm.combinedInk,
          childDarkness: cm ? cm.centerInk : 0,
          contrastRatio: pm.contrastRatio,
          centerInk: pm.centerInk,
          diagInk: pm.diagInk,
          combinedInk: pm.combinedInk,
          centerBright: pm.centerBright,
          surroundBright: pm.surroundBright,
        };

        // backward compat
        darknessValues.push({ row, day: d, type: 'parent', value: pm.combinedInk, px: pm.px });
        if (cm) darknessValues.push({ row, day: d, type: 'child', value: cm.centerInk, px: cm.px });

        // ---- Draw debug markers on overlay ----
        const px = pm.px;
        // Draw center sample zone
        dbg.strokeStyle = parentChecked ? '#00ff00' : '#ff0000';
        dbg.lineWidth = 2;
        dbg.strokeRect(px.x - centerHalfPx, px.y - centerHalfPx, centerHalfPx * 2, centerHalfPx * 2);
        // Draw crosshair
        dbg.beginPath();
        dbg.moveTo(px.x - centerHalfPx - 2, px.y);
        dbg.lineTo(px.x + centerHalfPx + 2, px.y);
        dbg.moveTo(px.x, px.y - centerHalfPx - 2);
        dbg.lineTo(px.x, px.y + centerHalfPx + 2);
        dbg.stroke();
        // Draw diagonal sample lines on debug overlay
        dbg.strokeStyle = parentChecked ? 'rgba(0,255,0,0.3)' : 'rgba(255,0,0,0.2)';
        dbg.lineWidth = 1;
        dbg.beginPath();
        dbg.moveTo(px.x - diagHalfPx, px.y - diagHalfPx);
        dbg.lineTo(px.x + diagHalfPx, px.y + diagHalfPx);
        dbg.moveTo(px.x + diagHalfPx, px.y - diagHalfPx);
        dbg.lineTo(px.x - diagHalfPx, px.y + diagHalfPx);
        dbg.stroke();
        // Label with contrast/center/diag values
        dbg.font = `${Math.max(8, Math.round(imgW / 300))}px monospace`;
        dbg.fillStyle = parentChecked ? '#00ff00' : '#ff0000';
        dbg.fillText(
          `c${(pm.contrastRatio * 100).toFixed(0)} i${(pm.centerInk * 100).toFixed(0)} d${(pm.diagInk * 100).toFixed(0)}`,
          px.x + centerHalfPx + 3,
          px.y - 2
        );

        // Draw child checkbox marker (dimmer)
        if (cm) {
          dbg.strokeStyle = 'rgba(255,165,0,0.5)';
          dbg.lineWidth = 1;
          dbg.strokeRect(cm.px.x - centerHalfPx, cm.px.y - centerHalfPx, centerHalfPx * 2, centerHalfPx * 2);
        }
      }

      results.push({ index: row, text: item.text, results: rowResults });
    }

    return {
      results, threshold: { contrast: CONTRAST_THRESHOLD, ink: INK_THRESHOLD },
      darknessValues, debugCanvas,
    };
  }

  // ---- Blue Header Bar Detection (improved with mapper) ----

  // Inverse mapper: given a pixel Y coordinate, find the mm Y that maps to it.
  // Uses binary search since the forward mapper (mm → px) is monotonic in Y.
  function inverseMapperY(mapper, targetPxY, mmX, searchMinMm, searchMaxMm) {
    let lo = searchMinMm, hi = searchMaxMm;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const px = mapper(mmX, mid);
      if (Math.abs(px.y - targetPxY) < 0.5) return mid;
      if (px.y < targetPxY) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

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

        // Convert pixel positions to mm using the INVERSE of the perspective mapper
        // (not a simple linear scale, which ignores print scaling)
        let topMm, bottomMm;
        if (mapper) {
          const pageCenterX = L.PAGE_W / 2;
          topMm = inverseMapperY(mapper, row, pageCenterX, 0, L.PAGE_H);
          bottomMm = inverseMapperY(mapper, barBottom, pageCenterX, 0, L.PAGE_H);
          console.log(`[OCR] Blue bar px-to-mm via inverse mapper: top=${topMm.toFixed(1)}mm, bottom=${bottomMm.toFixed(1)}mm (was linear: ${((row / imgH) * L.PAGE_H).toFixed(1)}mm, ${((barBottom / imgH) * L.PAGE_H).toFixed(1)}mm)`);
        } else {
          topMm = (row / imgH) * L.PAGE_H;
          bottomMm = (barBottom / imgH) * L.PAGE_H;
        }
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
            const dstPoints = regMarks.dstCornersMm || {
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
          checkboxResults = analyzeCheckboxes(ctx, imgW, imgH, worksheet, mapper, regMarks);
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
          debugCanvas: checkboxResults ? checkboxResults.debugCanvas : null,
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
            const isChecked = dayResults[day][itemIdx];
            items[i].results[day] = { completed: isChecked, confirmed: isChecked };
          }
        });
      });
      return { items };
    }
  };
})();
