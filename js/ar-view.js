/**
 * AR View — Overlays sun path on the phone's camera feed.
 * Uses rear camera + device orientation (compass/gyroscope) to align the
 * sun-path arc with the real sky. Works on iOS and Android mobile browsers.
 */
const ARView = (() => {
    let video, canvas, ctx;
    let isActive = false;
    let animFrameId = null;

    // Device orientation (smoothed)
    let deviceHeading = 0;   // compass heading 0-360
    let devicePitch  = 90;   // beta: 0=flat, 90=upright
    let deviceRoll   = 0;    // gamma: tilt left/right
    let targetHeading = 0;
    let targetPitch   = 90;
    let targetRoll    = 0;

    let sunPathData = [];
    let currentSunPos = { altitude: 0, azimuth: 0 };
    let markedObstructions = [];
    let hasOrientation = false;
    let manualHeading = 0;        // fallback for desktop (no compass)
    let useManualHeading = false;

    // Estimated camera FOV – updated when camera reports actual track settings
    let hFOV = 60;
    let vFOV = 45;

    // Smoothing factor for orientation (lower = smoother)
    const SMOOTH = 0.25;

    /* ------------------------------------------------------------------ */
    /*  Lifecycle                                                          */
    /* ------------------------------------------------------------------ */

    function init() {
        video  = document.getElementById('ar-video');
        canvas = document.getElementById('ar-canvas');
        ctx    = canvas.getContext('2d');
    }

    /**
     * Start the camera-based AR overlay.
     */
    async function start() {
        if (isActive) return;
        init();

        // ---- Camera ----
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width:  { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false,
            });
            video.srcObject = stream;
            await video.play();
            updateCameraFOV(stream);
        } catch (err) {
            console.warn('Camera unavailable:', err);
            showFallbackMessage(
                'Camera access is required for AR. Please allow camera permission and reload.'
            );
            return;
        }

        // ---- Device Orientation ----
        // iOS 13+ requires a user-gesture-triggered permission request
        const needsPermission =
            typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function';

        if (needsPermission) {
            showIOSPermissionButton();
        } else {
            listenOrientation();
        }

        // ---- Canvas interaction ----
        canvas.style.pointerEvents = 'auto';           // receive taps
        canvas.addEventListener('click', handleTap);
        canvas.addEventListener('touchstart', handleTouchStart, { passive: true });

        // Manual heading fallback (desktop drag / no compass)
        canvas.addEventListener('pointerdown', handleManualDragStart);

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        screen.orientation?.addEventListener('change', resizeCanvas);

        isActive = true;
        hideInstructions();
        render();
    }

    function stop() {
        isActive = false;
        if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }

        if (video?.srcObject) {
            video.srcObject.getTracks().forEach(t => t.stop());
            video.srcObject = null;
        }

        window.removeEventListener('deviceorientation', onOrientation);
        window.removeEventListener('deviceorientationabsolute', onOrientation);
        window.removeEventListener('resize', resizeCanvas);
        screen.orientation?.removeEventListener('change', resizeCanvas);

        if (canvas) {
            canvas.removeEventListener('click', handleTap);
            canvas.removeEventListener('touchstart', handleTouchStart);
            canvas.removeEventListener('pointerdown', handleManualDragStart);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Orientation                                                        */
    /* ------------------------------------------------------------------ */

    function listenOrientation() {
        // Prefer absolute orientation (gives true-north heading)
        window.addEventListener('deviceorientationabsolute', onOrientation);
        window.addEventListener('deviceorientation', onOrientation);
    }

    function onOrientation(e) {
        if (e.alpha === null && e.beta === null) return;
        hasOrientation = true;
        useManualHeading = false;

        // Compass heading
        if (e.webkitCompassHeading !== undefined) {
            targetHeading = e.webkitCompassHeading;           // iOS (always true-north)
        } else if (e.absolute && e.alpha !== null) {
            targetHeading = (360 - e.alpha) % 360;            // Android absolute
        } else if (e.alpha !== null) {
            targetHeading = (360 - e.alpha) % 360;            // best-effort
        }

        targetPitch = e.beta  ?? 90;
        targetRoll  = e.gamma ?? 0;

        // Update HUD heading
        const el = document.getElementById('ar-heading');
        if (el) el.textContent = `${Math.round(targetHeading)}° ${compassLabel(targetHeading)}`;
    }

    /** iOS permission button (must be triggered by user gesture). */
    function showIOSPermissionButton() {
        let btn = document.getElementById('ar-ios-perm');
        if (btn) return;
        btn = document.createElement('button');
        btn.id = 'ar-ios-perm';
        btn.className = 'ar-perm-btn';
        btn.innerHTML = '<span class="material-icons-round">explore</span> Enable Compass';
        btn.addEventListener('click', async () => {
            try {
                const perm = await DeviceOrientationEvent.requestPermission();
                if (perm === 'granted') listenOrientation();
            } catch { /* user denied */ }
            btn.remove();
        });
        document.getElementById('ar-container').appendChild(btn);
    }

    /* ------------------------------------------------------------------ */
    /*  Manual heading fallback (desktop — drag to rotate view)            */
    /* ------------------------------------------------------------------ */

    let _dragStartX = 0;
    let _dragStartHeading = 0;
    let _dragging = false;

    function handleManualDragStart(e) {
        if (hasOrientation) return;   // compass available — skip manual
        useManualHeading = true;
        _dragging = true;
        _dragStartX = e.clientX;
        _dragStartHeading = manualHeading;
        canvas.setPointerCapture(e.pointerId);
        canvas.addEventListener('pointermove', handleManualDragMove);
        canvas.addEventListener('pointerup', handleManualDragEnd);
    }

    function handleManualDragMove(e) {
        if (!_dragging) return;
        const dx = e.clientX - _dragStartX;
        manualHeading = (_dragStartHeading - dx * 0.3 + 360) % 360;
        targetHeading = manualHeading;
        const el = document.getElementById('ar-heading');
        if (el) el.textContent = `${Math.round(manualHeading)}° ${compassLabel(manualHeading)}`;
    }

    function handleManualDragEnd(e) {
        _dragging = false;
        canvas.releasePointerCapture(e.pointerId);
        canvas.removeEventListener('pointermove', handleManualDragMove);
        canvas.removeEventListener('pointerup', handleManualDragEnd);
    }

    /* ------------------------------------------------------------------ */
    /*  Camera FOV detection                                               */
    /* ------------------------------------------------------------------ */

    function updateCameraFOV(stream) {
        const track = stream.getVideoTracks()[0];
        if (!track) return;
        // Some browsers report FOV via getCapabilities / getSettings
        try {
            const caps = track.getCapabilities?.() || {};
            const settings = track.getSettings?.() || {};
            // aspectRatio helps compute vFOV from hFOV
            const ar = settings.aspectRatio || (settings.width / settings.height) || (16 / 9);
            // Default phone rear cam ~ 60-70° horizontal
            hFOV = 65;
            vFOV = hFOV / ar;
        } catch {
            // keep defaults
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Tap to mark building obstructions                                  */
    /* ------------------------------------------------------------------ */

    function handleTap(e) {
        if (_dragging) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const cx = (e.clientX - rect.left) * scaleX;
        const cy = (e.clientY - rect.top)  * scaleY;

        // Unproject screen → sky coordinates
        const az  = deviceHeading + ((cx / canvas.width) - 0.5) * hFOV;
        const alt = (90 - devicePitch) + (0.5 - cy / canvas.height) * vFOV;

        markedObstructions.push({
            azimuth:  ((az % 360) + 360) % 360,
            altitude: Math.max(0, alt),
        });

        // Haptic feedback on supported devices
        navigator.vibrate?.(30);
    }

    function handleTouchStart() {
        // Hide the instruction overlay after first touch
        hideInstructions();
    }

    /* ------------------------------------------------------------------ */
    /*  Public setters                                                     */
    /* ------------------------------------------------------------------ */

    function setSunPath(pathData)  { sunPathData = pathData || []; }

    function setSunPosition(altitude, azimuth) {
        currentSunPos = { altitude, azimuth };
        const el = document.getElementById('ar-sun-pos');
        if (el) el.textContent = `${altitude.toFixed(1)}° alt · ${azimuth.toFixed(0)}° az`;
    }

    /* ------------------------------------------------------------------ */
    /*  Canvas / render                                                    */
    /* ------------------------------------------------------------------ */

    function resizeCanvas() {
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width  = canvas.clientWidth  * dpr;
        canvas.height = canvas.clientHeight * dpr;
    }

    function render() {
        if (!isActive) return;
        animFrameId = requestAnimationFrame(render);

        // Smooth orientation
        deviceHeading = lerpAngle(deviceHeading, targetHeading, SMOOTH);
        devicePitch   = lerp(devicePitch,   targetPitch,   SMOOTH);
        deviceRoll    = lerp(deviceRoll,    targetRoll,    SMOOTH);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        drawCompassBar();
        drawHorizon();
        drawSunPath();
        drawSun();
        drawObstructions();
        drawDirectionPointers();

        if (!hasOrientation && !useManualHeading) {
            drawNoCompassHint();
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Projection: sky-coordinates → screen pixels                        */
    /* ------------------------------------------------------------------ */

    function project(azimuth, altitude) {
        let relAz = azimuth - deviceHeading;
        while (relAz >  180) relAz -= 360;
        while (relAz < -180) relAz += 360;

        // Phone held upright: pitch ≈ 90 → camera points at horizon (alt 0)
        // pitch 45 → camera tilted up 45°
        const cameraCenterAlt = 90 - devicePitch;
        const relAlt = altitude - cameraCenterAlt;

        const x = canvas.width  / 2 + (relAz  / hFOV) * canvas.width;
        const y = canvas.height / 2 - (relAlt / vFOV) * canvas.height;

        const inView = Math.abs(relAz) < hFOV * 0.6 && Math.abs(relAlt) < vFOV * 0.6;
        return { x, y, inView };
    }

    /* ------------------------------------------------------------------ */
    /*  Drawing helpers                                                    */
    /* ------------------------------------------------------------------ */

    function drawCompassBar() {
        const dpr = window.devicePixelRatio || 1;
        const barH = 28 * dpr;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, 0, canvas.width, barH);

        ctx.font = `bold ${11 * dpr}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Draw tick marks every 15° and cardinal labels
        const dirs = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
        for (let deg = 0; deg < 360; deg += 15) {
            let rel = deg - deviceHeading;
            while (rel >  180) rel -= 360;
            while (rel < -180) rel += 360;
            if (Math.abs(rel) > hFOV * 0.6) continue;

            const x = canvas.width / 2 + (rel / hFOV) * canvas.width;
            const label = dirs[deg];
            if (label) {
                ctx.fillStyle = deg === 0 ? '#ef4444' : 'rgba(255,255,255,0.85)';
                ctx.fillText(label, x, barH / 2);
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.fillRect(x - 0.5 * dpr, barH * 0.3, 1 * dpr, barH * 0.4);
            }
        }

        // Center indicator
        ctx.fillStyle = '#f59e0b';
        const triSize = 5 * dpr;
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2, barH);
        ctx.lineTo(canvas.width / 2 - triSize, barH + triSize);
        ctx.lineTo(canvas.width / 2 + triSize, barH + triSize);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    function drawHorizon() {
        const dpr = window.devicePixelRatio || 1;
        const horizonP = project(deviceHeading, 0);
        const hy = horizonP.y;
        if (hy < 0 || hy > canvas.height) return;

        ctx.save();
        // Gradient band
        const grad = ctx.createLinearGradient(0, hy - 20 * dpr, 0, hy + 20 * dpr);
        grad.addColorStop(0,   'rgba(100,180,255,0.0)');
        grad.addColorStop(0.5, 'rgba(100,180,255,0.08)');
        grad.addColorStop(1,   'rgba(100,180,255,0.0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, hy - 20 * dpr, canvas.width, 40 * dpr);

        // Dashed line
        ctx.setLineDash([10 * dpr, 6 * dpr]);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(0, hy);
        ctx.lineTo(canvas.width, hy);
        ctx.stroke();

        // Label
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = `${10 * dpr}px Inter, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText('HORIZON  0°', 10 * dpr, hy - 6 * dpr);
        ctx.restore();
    }

    function drawSunPath() {
        if (sunPathData.length < 2) return;
        const dpr = window.devicePixelRatio || 1;

        ctx.save();

        // Thick glowing arc
        ctx.lineWidth = 4 * dpr;
        ctx.strokeStyle = 'rgba(255, 200, 50, 0.85)';
        ctx.shadowColor = 'rgba(255, 170, 0, 0.6)';
        ctx.shadowBlur  = 14 * dpr;
        ctx.lineJoin = 'round';
        ctx.lineCap  = 'round';

        ctx.beginPath();
        let started = false;
        for (const pt of sunPathData) {
            if (pt.altitude < -1) { started = false; continue; }
            const p = project(pt.azimuth, pt.altitude);
            if (!p.inView) { started = false; continue; }
            if (!started) { ctx.moveTo(p.x, p.y); started = true; }
            else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Hour markers
        ctx.font = `bold ${12 * dpr}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        for (const pt of sunPathData) {
            if (pt.altitude < 0 || pt.minutes % 60 !== 0) continue;
            const p = project(pt.azimuth, pt.altitude);
            if (!p.inView) continue;

            // Dot
            ctx.fillStyle = '#ffc107';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5 * dpr, 0, Math.PI * 2);
            ctx.fill();

            // Label background pill
            const label = `${Math.floor(pt.minutes / 60)}:00`;
            const tw = ctx.measureText(label).width;
            const px = 4 * dpr, py = 2 * dpr;
            const ly = p.y - 12 * dpr;
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            roundRect(ctx, p.x - tw / 2 - px, ly - 13 * dpr - py, tw + px * 2, 13 * dpr + py * 2, 4 * dpr);
            ctx.fill();

            ctx.fillStyle = '#fff';
            ctx.fillText(label, p.x, ly);
        }

        ctx.restore();
    }

    function drawSun() {
        if (currentSunPos.altitude < -1) return;
        const p = project(currentSunPos.azimuth, currentSunPos.altitude);
        if (!p.inView) return;
        const dpr = window.devicePixelRatio || 1;
        const r = 18 * dpr;

        ctx.save();

        // Outer glow
        const g1 = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r * 4);
        g1.addColorStop(0,   'rgba(255,220,50,0.55)');
        g1.addColorStop(0.4, 'rgba(255,180,0,0.15)');
        g1.addColorStop(1,   'rgba(255,150,0,0)');
        ctx.fillStyle = g1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2);
        ctx.fill();

        // Sun disc
        const g2 = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g2.addColorStop(0, '#fff8e1');
        g2.addColorStop(0.6, '#ffd54f');
        g2.addColorStop(1, '#ffab00');
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Rays
        ctx.strokeStyle = 'rgba(255,200,50,0.45)';
        ctx.lineWidth = 2.5 * dpr;
        ctx.lineCap = 'round';
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(p.x + Math.cos(a) * r * 1.4, p.y + Math.sin(a) * r * 1.4);
            ctx.lineTo(p.x + Math.cos(a) * r * 2.2, p.y + Math.sin(a) * r * 2.2);
            ctx.stroke();
        }

        // Altitude label
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.font = `bold ${11 * dpr}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const lbl = `${currentSunPos.altitude.toFixed(1)}°`;
        ctx.fillText(lbl, p.x, p.y + r * 1.5);

        ctx.restore();
    }

    function drawObstructions() {
        const dpr = window.devicePixelRatio || 1;
        for (const obs of markedObstructions) {
            const p = project(obs.azimuth, obs.altitude);
            if (!p.inView) continue;

            ctx.save();
            const s = 14 * dpr;

            // Red translucent circle
            ctx.fillStyle = 'rgba(239,68,68,0.2)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, s * 1.5, 0, Math.PI * 2);
            ctx.fill();

            // X mark
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2.5 * dpr;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(p.x - s, p.y - s);
            ctx.lineTo(p.x + s, p.y + s);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(p.x + s, p.y - s);
            ctx.lineTo(p.x - s, p.y + s);
            ctx.stroke();

            ctx.fillStyle = 'rgba(239,68,68,0.85)';
            ctx.font = `${10 * dpr}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('Building', p.x, p.y + s * 1.5 + 10 * dpr);
            ctx.restore();
        }
    }

    /** Draw arrow pointers at screen edges when the sun is out of view. */
    function drawDirectionPointers() {
        if (currentSunPos.altitude < 0) return;
        const p = project(currentSunPos.azimuth, currentSunPos.altitude);
        if (p.inView) return;   // sun is visible, no pointer needed

        const dpr = window.devicePixelRatio || 1;
        const margin = 40 * dpr;

        // Clamp to edge
        const cx = Math.max(margin, Math.min(canvas.width - margin, p.x));
        const cy = Math.max(margin, Math.min(canvas.height - margin, p.y));

        ctx.save();
        // Arrow
        const angle = Math.atan2(p.y - canvas.height / 2, p.x - canvas.width / 2);
        ctx.translate(cx, cy);
        ctx.rotate(angle);

        ctx.fillStyle = 'rgba(255,200,50,0.7)';
        ctx.beginPath();
        ctx.moveTo(16 * dpr, 0);
        ctx.lineTo(-6 * dpr, -8 * dpr);
        ctx.lineTo(-6 * dpr, 8 * dpr);
        ctx.closePath();
        ctx.fill();

        // Sun icon
        ctx.fillStyle = '#ffd54f';
        ctx.beginPath();
        ctx.arc(-14 * dpr, 0, 6 * dpr, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    function drawNoCompassHint() {
        const dpr = window.devicePixelRatio || 1;
        ctx.save();

        const text = 'Drag left/right to rotate view (no compass detected)';
        ctx.font = `${12 * dpr}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        const tw = ctx.measureText(text).width;
        const px = 14 * dpr, py = 8 * dpr;
        const bx = canvas.width / 2 - tw / 2 - px;
        const by = canvas.height - 50 * dpr;

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        roundRect(ctx, bx, by, tw + px * 2, 24 * dpr + py, 6 * dpr);
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, by + (24 * dpr + py) / 2);
        ctx.restore();
    }

    /* ------------------------------------------------------------------ */
    /*  Utilities                                                          */
    /* ------------------------------------------------------------------ */

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    function lerp(a, b, t) { return a + (b - a) * t; }

    function lerpAngle(a, b, t) {
        let diff = b - a;
        while (diff >  180) diff -= 360;
        while (diff < -180) diff += 360;
        return ((a + diff * t) % 360 + 360) % 360;
    }

    function compassLabel(deg) {
        const dirs = ['N','NE','E','SE','S','SW','W','NW'];
        return dirs[Math.round(((deg % 360 + 360) % 360) / 45) % 8];
    }

    function hideInstructions() {
        const el = document.getElementById('ar-instructions');
        if (el) el.style.display = 'none';
    }

    function showFallbackMessage(msg) {
        const el = document.getElementById('ar-instructions');
        if (el) {
            el.style.display = '';
            el.querySelector('p').textContent = msg;
        }
    }

    function clearObstructions() { markedObstructions = []; }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                         */
    /* ------------------------------------------------------------------ */

    return {
        init,
        start,
        stop,
        setSunPath,
        setSunPosition,
        clearObstructions,
        get isActive()       { return isActive; },
        get hasOrientation() { return hasOrientation; },
    };
})();
