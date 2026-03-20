/**
 * App Controller — Orchestrates all modules.
 */
(() => {
    // State
    const state = {
        lat: 52.37,
        lng: 4.895,
        date: new Date(),
        timeMinutes: new Date().getHours() * 60 + new Date().getMinutes(),
        animating: false,
        animFrameId: null,
        currentView: 'map',
        showShadows: true,
        showAllPaths: false,
    };

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    // DOM Elements
    const views = document.querySelectorAll('.view');
    const navBtns = document.querySelectorAll('.nav-btn');
    const datePicker = document.getElementById('date-picker');
    const timeSlider = document.getElementById('time-slider');
    const timeDisplay = document.getElementById('time-display');
    const monthSlider = document.getElementById('month-slider');
    const monthDisplay = document.getElementById('month-display');
    const btnAnimate = document.getElementById('btn-animate');
    const btnNow = document.getElementById('btn-now');
    const showShadowsCb = document.getElementById('show-shadows');
    const showAllPathsCb = document.getElementById('show-all-paths');
    const infoModal = document.getElementById('info-modal');
    const btnInfo = document.getElementById('btn-info');
    const modalClose = document.getElementById('modal-close');

    /**
     * Initialize the app.
     */
    function init() {
        // Set initial date/time values
        const now = new Date();
        state.date = now;
        state.timeMinutes = now.getHours() * 60 + now.getMinutes();

        datePicker.value = formatDateInput(now);
        timeSlider.value = state.timeMinutes;
        monthSlider.value = now.getMonth();
        updateTimeDisplay();
        updateMonthDisplay();

        // Initialize modules
        MapView.init(handleLocationChange);

        // Navigation
        navBtns.forEach(btn => {
            btn.addEventListener('click', () => switchView(btn.dataset.view));
        });

        // Controls
        datePicker.addEventListener('change', handleDateChange);
        timeSlider.addEventListener('input', handleTimeChange);
        monthSlider.addEventListener('input', handleMonthChange);
        btnAnimate.addEventListener('click', toggleAnimation);
        btnNow.addEventListener('click', jumpToNow);
        showShadowsCb.addEventListener('change', () => {
            state.showShadows = showShadowsCb.checked;
            updateScene();
        });
        showAllPathsCb.addEventListener('change', () => {
            state.showAllPaths = showAllPathsCb.checked;
            updateScene();
        });

        // Modal
        btnInfo.addEventListener('click', () => infoModal.classList.remove('hidden'));
        modalClose.addEventListener('click', () => infoModal.classList.add('hidden'));
        infoModal.addEventListener('click', (e) => {
            if (e.target === infoModal) infoModal.classList.add('hidden');
        });

        // AR undo obstruction
        const arUndoBtn = document.getElementById('ar-undo-obstruction');
        if (arUndoBtn) {
            arUndoBtn.addEventListener('click', () => ARView.clearObstructions());
        }

        // Initial update
        updateScene();
    }

    /**
     * Switch between views (map, sunpath, ar).
     */
    function switchView(viewName) {
        state.currentView = viewName;

        views.forEach(v => v.classList.remove('active'));
        navBtns.forEach(b => b.classList.remove('active'));

        document.getElementById(`view-${viewName}`).classList.add('active');
        document.querySelector(`[data-view="${viewName}"]`).classList.add('active');

        if (viewName === 'map') {
            MapView.invalidateSize();
            updateMapSunArc();
        } else if (viewName === 'sunpath') {
            initSunPathView();
        } else if (viewName === 'ar') {
            startARView();
        }

        // Stop AR when leaving AR view
        if (viewName !== 'ar' && ARView.isActive) {
            ARView.stop();
        }
    }

    /**
     * Initialize the 3D sun path view.
     */
    function initSunPathView() {
        const canvas = document.getElementById('sunpath-canvas');
        SunPathScene.init(canvas);
        SunPathScene.addSampleBuildings();
        updateScene();
    }

    /**
     * Start the AR view.
     */
    function startARView() {
        ARView.start();
        updateARSunPath();
    }

    /**
     * Handle location change from map.
     */
    function handleLocationChange(lat, lng) {
        state.lat = lat;
        state.lng = lng;
        updateScene();
    }

    /**
     * Handle date picker change.
     */
    function handleDateChange() {
        const parts = datePicker.value.split('-');
        if (parts.length === 3) {
            state.date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            monthSlider.value = state.date.getMonth();
            updateMonthDisplay();
            updateScene();
        }
    }

    /**
     * Handle time slider change.
     */
    function handleTimeChange() {
        state.timeMinutes = parseInt(timeSlider.value);
        updateTimeDisplay();
        updateScene();
    }

    /**
     * Handle month slider change.
     */
    function handleMonthChange() {
        const month = parseInt(monthSlider.value);
        state.date = new Date(state.date.getFullYear(), month, state.date.getDate());
        datePicker.value = formatDateInput(state.date);
        updateMonthDisplay();
        updateScene();
    }

    /**
     * Toggle day animation.
     */
    function toggleAnimation() {
        if (state.animating) {
            stopAnimation();
        } else {
            startAnimation();
        }
    }

    function startAnimation() {
        state.animating = true;
        btnAnimate.querySelector('.material-icons-round').textContent = 'pause';
        btnAnimate.classList.add('active');

        function step() {
            if (!state.animating) return;
            state.timeMinutes = (state.timeMinutes + 2) % 1440;
            timeSlider.value = state.timeMinutes;
            updateTimeDisplay();
            updateScene();
            state.animFrameId = requestAnimationFrame(step);
        }
        step();
    }

    function stopAnimation() {
        state.animating = false;
        btnAnimate.querySelector('.material-icons-round').textContent = 'play_arrow';
        btnAnimate.classList.remove('active');
        if (state.animFrameId) {
            cancelAnimationFrame(state.animFrameId);
            state.animFrameId = null;
        }
    }

    /**
     * Jump to current date/time/location.
     */
    function jumpToNow() {
        const now = new Date();
        state.date = now;
        state.timeMinutes = now.getHours() * 60 + now.getMinutes();
        datePicker.value = formatDateInput(now);
        timeSlider.value = state.timeMinutes;
        monthSlider.value = now.getMonth();
        updateTimeDisplay();
        updateMonthDisplay();
        updateScene();
    }

    /**
     * Main update — recalculate sun position and update all active views.
     */
    function updateScene() {
        const { lat, lng, date, timeMinutes } = state;

        // Build a UTC date from local inputs
        const hours = Math.floor(timeMinutes / 60);
        const minutes = timeMinutes % 60;
        const dateTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);

        // Sun position
        const sunPos = SunCalculator.getPosition(dateTime, lat, lng);
        const times = SunCalculator.getTimes(date, lat, lng);

        // Update info panel
        updateInfoPanel(sunPos, times);

        // Update 3D scene
        if (SunPathScene.isInitialized) {
            SunPathScene.updateSunPosition(sunPos.altitude, sunPos.azimuth);
            SunPathScene.updatePaths(lat, lng, date, state.showAllPaths);
        }

        // Update map sun arc
        if (state.currentView === 'map') {
            updateMapSunArc();
        }

        // Update AR
        if (ARView.isActive) {
            updateARSunPath();
            ARView.setSunPosition(sunPos.altitude, sunPos.azimuth);
        }
    }

    function updateMapSunArc() {
        const pathData = SunCalculator.getPath(state.date, state.lat, state.lng, 10);
        MapView.drawSunArcOnMap(pathData);
    }

    function updateARSunPath() {
        const pathData = SunCalculator.getPath(state.date, state.lat, state.lng, 5);
        ARView.setSunPath(pathData);
    }

    /**
     * Update the sun information panel.
     */
    function updateInfoPanel(sunPos, times) {
        document.getElementById('sun-altitude').textContent = `${sunPos.altitude.toFixed(1)}°`;
        document.getElementById('sun-azimuth').textContent = `${sunPos.azimuth.toFixed(1)}° ${SunCalculator.azimuthToCompass(sunPos.azimuth)}`;

        if (times.sunrise) {
            document.getElementById('sun-rise').textContent = formatTimeFromDate(times.sunrise);
            document.getElementById('sun-set').textContent = formatTimeFromDate(times.sunset);
        } else {
            document.getElementById('sun-rise').textContent = times.dayLength > 0 ? '—' : 'No sunrise';
            document.getElementById('sun-set').textContent = times.dayLength > 0 ? '—' : 'No sunset';
        }

        const dlHours = Math.floor(times.dayLength / 60);
        const dlMins = Math.round(times.dayLength % 60);
        document.getElementById('sun-daylength').textContent = `${dlHours}h ${dlMins}m`;
    }

    function updateTimeDisplay() {
        const h = Math.floor(state.timeMinutes / 60);
        const m = state.timeMinutes % 60;
        timeDisplay.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    function updateMonthDisplay() {
        monthDisplay.textContent = MONTHS[parseInt(monthSlider.value)];
    }

    function formatDateInput(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function formatTimeFromDate(date) {
        // Convert UTC date to local time string
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Boot
    document.addEventListener('DOMContentLoaded', init);
})();
