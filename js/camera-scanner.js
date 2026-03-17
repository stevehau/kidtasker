// ============================================================
// Kid Tasker - Camera Scanner (Beta)
// Uses getUserMedia to capture worksheet photos via smartphone
// ============================================================

const CameraScanner = (() => {
  let stream = null;
  let videoEl = null;
  let canvasEl = null;
  let overlayEl = null;
  let onCapture = null;
  let facingMode = 'environment'; // rear camera

  // Check if camera is available
  function isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // Create the full-screen camera UI
  function createUI() {
    // Remove existing if any
    destroy();

    overlayEl = document.createElement('div');
    overlayEl.id = 'camera-scanner-overlay';
    overlayEl.innerHTML = `
      <div class="camera-scanner-container">
        <div class="camera-scanner-header">
          <button id="camera-close-btn" class="camera-btn camera-btn-close" aria-label="Close">&times;</button>
          <span class="camera-header-title">Scan Worksheet</span>
          <button id="camera-flip-btn" class="camera-btn camera-btn-flip" aria-label="Flip camera">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M4 4l17 17"/>
            </svg>
          </button>
        </div>
        <div class="camera-scanner-viewfinder">
          <video id="camera-video" autoplay playsinline muted></video>
          <div class="camera-guide-overlay">
            <div class="camera-guide-rect">
              <div class="camera-guide-corner tl"></div>
              <div class="camera-guide-corner tr"></div>
              <div class="camera-guide-corner bl"></div>
              <div class="camera-guide-corner br"></div>
            </div>
            <p class="camera-guide-text">Align worksheet within the frame</p>
          </div>
          <canvas id="camera-canvas" style="display:none"></canvas>
        </div>
        <div class="camera-scanner-controls">
          <div class="camera-shutter-ring">
            <button id="camera-shutter-btn" class="camera-shutter" aria-label="Capture photo"></button>
          </div>
        </div>
        <!-- Confirmation screen (hidden initially) -->
        <div id="camera-confirm-screen" class="camera-confirm-screen hidden">
          <div class="camera-scanner-header">
            <button id="camera-retake-btn" class="camera-btn camera-btn-text">Retake</button>
            <span class="camera-header-title">Review Photo</span>
            <button id="camera-use-btn" class="camera-btn camera-btn-text camera-btn-use">Use Photo</button>
          </div>
          <div class="camera-confirm-preview">
            <img id="camera-confirm-img" alt="Captured worksheet">
            <div id="camera-qr-status" class="camera-qr-status"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlayEl);
    videoEl = document.getElementById('camera-video');
    canvasEl = document.getElementById('camera-canvas');

    // Bind events
    document.getElementById('camera-close-btn').addEventListener('click', destroy);
    document.getElementById('camera-flip-btn').addEventListener('click', flipCamera);
    document.getElementById('camera-shutter-btn').addEventListener('click', captureFrame);
    document.getElementById('camera-retake-btn').addEventListener('click', retake);
    document.getElementById('camera-use-btn').addEventListener('click', usePhoto);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }

  // Start the camera stream
  async function startStream() {
    try {
      const constraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 3840, min: 1920 },
          height: { ideal: 2160, min: 1080 },
        },
        audio: false
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoEl.srcObject = stream;
      await videoEl.play();
    } catch (err) {
      console.error('Camera access failed:', err);
      destroy();
      throw new Error('Could not access camera. Please check permissions and try again.');
    }
  }

  // Stop the camera stream
  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
    }
  }

  // Flip between front and rear camera
  async function flipCamera() {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    stopStream();
    await startStream();
  }

  // Capture the current video frame
  function captureFrame() {
    if (!videoEl || !canvasEl) return;

    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    canvasEl.width = vw;
    canvasEl.height = vh;

    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, vw, vh);

    // Convert to data URL for preview
    const dataUrl = canvasEl.toDataURL('image/jpeg', 0.92);

    // Show confirmation screen
    const confirmScreen = document.getElementById('camera-confirm-screen');
    const confirmImg = document.getElementById('camera-confirm-img');
    const qrStatus = document.getElementById('camera-qr-status');

    confirmImg.src = dataUrl;
    confirmScreen.classList.remove('hidden');

    // Pause the video
    videoEl.pause();

    // Try to detect QR code for immediate feedback
    detectQR(ctx, vw, vh, qrStatus);
  }

  // Try to detect the QR code in the captured image
  function detectQR(ctx, w, h, statusEl) {
    if (typeof jsQR === 'undefined') {
      statusEl.innerHTML = '<span class="camera-qr-warning">QR detection unavailable</span>';
      return;
    }

    try {
      const imageData = ctx.getImageData(0, 0, w, h);
      const code = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });

      if (code && code.data) {
        statusEl.innerHTML = `
          <span class="camera-qr-found">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            QR Detected: ${code.data}
          </span>
        `;
      } else {
        statusEl.innerHTML = `
          <span class="camera-qr-warning">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            No QR code found — try retaking with better lighting or angle
          </span>
        `;
      }
    } catch (e) {
      console.warn('QR detection error:', e);
      statusEl.innerHTML = '<span class="camera-qr-warning">Could not check QR code</span>';
    }
  }

  // Go back to live camera from confirmation
  function retake() {
    const confirmScreen = document.getElementById('camera-confirm-screen');
    confirmScreen.classList.add('hidden');
    videoEl.play();
  }

  // Accept the captured photo and pass to callback
  function usePhoto() {
    // Convert canvas to Blob/File
    canvasEl.toBlob((blob) => {
      const file = new File([blob], `kidtasker-scan-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const callback = onCapture;
      destroy();
      if (callback) callback(file);
    }, 'image/jpeg', 0.92);
  }

  // Open the camera scanner
  async function open(captureCallback) {
    if (!isSupported()) {
      throw new Error('Camera is not supported on this device or browser.');
    }
    onCapture = captureCallback;
    createUI();
    await startStream();
  }

  // Tear down and clean up
  function destroy() {
    stopStream();
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
    videoEl = null;
    canvasEl = null;
    document.body.style.overflow = '';
  }

  return {
    isSupported,
    open,
    destroy
  };
})();
