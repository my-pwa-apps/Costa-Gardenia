/**
 * Three.js Sun Path 3D Scene.
 * Renders the sun arc, compass rose, ground plane, and optional buildings.
 */
const SunPathScene = (() => {
    let scene, camera, renderer, controls;
    let sunSphere, sunLight, ambientLight;
    let pathLines = [];
    let groundMesh, compassGroup;
    let buildingMeshes = [];
    let animFrameId = null;
    let resizeObserver = null;
    let isInitialized = false;

    const GROUND_SIZE = 40;
    const SKY_RADIUS = 18;
    const SUN_RADIUS = 0.6;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const PATH_COLORS = [
        0x4fc3f7, 0x29b6f6, 0x039be5, 0x0288d1,
        0xf59e0b, 0xfbbf24, 0xf59e0b, 0xfbbf24,
        0x0288d1, 0x039be5, 0x29b6f6, 0x4fc3f7
    ];

    function init(canvas) {
        if (isInitialized) return;

        scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x0f1923, 0.012);

        // Camera
        camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 200);
        camera.position.set(15, 12, 15);
        camera.lookAt(0, 2, 0);

        // Renderer
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.setClearColor(0x0f1923);

        // Lights
        ambientLight = new THREE.AmbientLight(0x4a6a8a, 0.4);
        scene.add(ambientLight);

        sunLight = new THREE.DirectionalLight(0xfff4e0, 1.0);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.set(2048, 2048);
        sunLight.shadow.camera.near = 0.5;
        sunLight.shadow.camera.far = 60;
        sunLight.shadow.camera.left = -20;
        sunLight.shadow.camera.right = 20;
        sunLight.shadow.camera.top = 20;
        sunLight.shadow.camera.bottom = -20;
        scene.add(sunLight);

        // Ground
        createGround();

        // Compass rose
        createCompass();

        // Sky dome
        createSkyDome();

        // Sun sphere
        const sunGeo = new THREE.SphereGeometry(SUN_RADIUS, 32, 16);
        const sunMat = new THREE.MeshBasicMaterial({ color: 0xffd54f });
        sunSphere = new THREE.Mesh(sunGeo, sunMat);
        scene.add(sunSphere);

        // Sun glow
        const glowGeo = new THREE.SphereGeometry(SUN_RADIUS * 2.5, 16, 8);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xffa726,
            transparent: true,
            opacity: 0.15,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        sunSphere.add(glow);

        // Simple orbit controls (manual)
        setupControls(canvas);

        // Handle resize
        resizeObserver = new ResizeObserver(() => handleResize(canvas));
        resizeObserver.observe(canvas);

        isInitialized = true;
        animate();
    }

    function createGround() {
        // Grid helper
        const grid = new THREE.GridHelper(GROUND_SIZE, 40, 0x243447, 0x1a2733);
        grid.position.y = 0;
        scene.add(grid);

        // Solid ground
        const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x1a2733,
            roughness: 0.9,
            metalness: 0.1,
        });
        groundMesh = new THREE.Mesh(groundGeo, groundMat);
        groundMesh.rotation.x = -Math.PI / 2;
        groundMesh.receiveShadow = true;
        scene.add(groundMesh);

        // Center marker
        const markerGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.3, 16);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
        const marker = new THREE.Mesh(markerGeo, markerMat);
        marker.position.y = 0.15;
        scene.add(marker);
    }

    function createCompass() {
        compassGroup = new THREE.Group();

        const dirs = [
            { label: 'N', angle: 0, color: 0xef4444 },
            { label: 'E', angle: 90, color: 0x8a9bb0 },
            { label: 'S', angle: 180, color: 0x8a9bb0 },
            { label: 'W', angle: 270, color: 0x8a9bb0 },
        ];

        dirs.forEach(d => {
            const r = GROUND_SIZE / 2 - 1;
            const angle = (d.angle - 90) * Math.PI / 180;
            const x = r * Math.cos(-angle);
            const z = r * Math.sin(-angle);

            // Direction line
            const lineGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0.05, 0),
                new THREE.Vector3(x, 0.05, z)
            ]);
            const lineMat = new THREE.LineBasicMaterial({
                color: d.color,
                transparent: true,
                opacity: d.label === 'N' ? 0.6 : 0.2,
            });
            compassGroup.add(new THREE.Line(lineGeo, lineMat));

            // Label sprite
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = d.label === 'N' ? '#ef4444' : '#8a9bb0';
            ctx.font = 'bold 48px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(d.label, 32, 32);
            const tex = new THREE.CanvasTexture(canvas);
            const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.position.set(x * 1.08, 0.5, z * 1.08);
            sprite.scale.set(1.5, 1.5, 1);
            compassGroup.add(sprite);
        });

        scene.add(compassGroup);
    }

    function createSkyDome() {
        const skyGeo = new THREE.SphereGeometry(80, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        const skyMat = new THREE.MeshBasicMaterial({
            color: 0x0d1b2a,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0.5,
        });
        const sky = new THREE.Mesh(skyGeo, skyMat);
        scene.add(sky);
    }

    /**
     * Draw the sun path arc for given path data.
     * @param {Array} pathData - From SunCalculator.getPath()
     * @param {number} colorHex - Line color
     * @param {boolean} thick - Use thicker line
     */
    function drawSunPath(pathData, colorHex = 0xf59e0b, thick = true) {
        const points = [];

        pathData.forEach(p => {
            if (p.altitude > -2) { // Include slightly below horizon for smooth arc
                const pos = altAzToXYZ(p.altitude, p.azimuth, SKY_RADIUS);
                points.push(pos);
            }
        });

        if (points.length < 2) return null;

        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({
            color: colorHex,
            transparent: true,
            opacity: thick ? 0.9 : 0.35,
            linewidth: 1,
        });
        const line = new THREE.Line(geo, mat);
        scene.add(line);
        return line;
    }

    /**
     * Clear all sun path lines.
     */
    function clearPaths() {
        pathLines.forEach(l => {
            scene.remove(l);
            l.geometry.dispose();
            l.material.dispose();
        });
        pathLines = [];
    }

    /**
     * Update the complete sun path visualization.
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {Date} date - Current date/time
     * @param {boolean} showAllMonths - Show paths for all months
     */
    function updatePaths(lat, lng, date, showAllMonths = false) {
        clearPaths();

        if (showAllMonths) {
            // Draw path for the 21st of each month
            for (let m = 0; m < 12; m++) {
                const d = new Date(date.getFullYear(), m, 21);
                const pathData = SunCalculator.getPath(d, lat, lng, 5);
                const isCurrentMonth = m === date.getMonth();
                const line = drawSunPath(pathData, PATH_COLORS[m], isCurrentMonth);
                if (line) pathLines.push(line);
            }
        } else {
            const pathData = SunCalculator.getPath(date, lat, lng, 5);
            const line = drawSunPath(pathData, 0xf59e0b, true);
            if (line) pathLines.push(line);
        }
    }

    /**
     * Update the sun sphere position.
     */
    function updateSunPosition(altitude, azimuth) {
        const pos = altAzToXYZ(altitude, azimuth, SKY_RADIUS);
        sunSphere.position.copy(pos);

        // Update directional light
        sunLight.position.copy(pos);
        sunLight.target.position.set(0, 0, 0);

        // Adjust light intensity based on altitude
        const normAlt = Math.max(0, altitude) / 90;
        sunLight.intensity = normAlt * 1.5;
        ambientLight.intensity = 0.2 + normAlt * 0.3;

        // Color shift: warm at horizon, white at zenith
        const warmth = 1 - normAlt;
        const r = 1;
        const g = 0.95 - warmth * 0.25;
        const b = 0.85 - warmth * 0.45;
        sunLight.color.setRGB(r, g, b);

        // Sun color
        sunSphere.material.color.setRGB(1, 0.85 - warmth * 0.1, 0.4 + normAlt * 0.3);

        // Hide if below horizon
        sunSphere.visible = altitude > -2;
    }

    /**
     * Convert altitude/azimuth to 3D coordinates.
     * Azimuth: 0=N, 90=E, 180=S, 270=W
     */
    function altAzToXYZ(altitude, azimuth, radius) {
        const altR = altitude * Math.PI / 180;
        const azR = (azimuth - 180) * Math.PI / 180; // Rotate so N is towards -Z

        const y = Math.sin(altR) * radius;
        const horizontalR = Math.cos(altR) * radius;
        const x = -horizontalR * Math.sin(azR);
        const z = -horizontalR * Math.cos(azR);

        return new THREE.Vector3(x, Math.max(y, 0), z);
    }

    /**
     * Add a building block to the scene.
     */
    function addBuilding(x, z, width, depth, height, color = 0x37474f) {
        const geo = new THREE.BoxGeometry(width, height, depth);
        const mat = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.7,
            metalness: 0.2,
            transparent: true,
            opacity: 0.85,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, height / 2, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        buildingMeshes.push(mesh);
        return mesh;
    }

    /**
     * Clear all buildings.
     */
    function clearBuildings() {
        buildingMeshes.forEach(m => {
            scene.remove(m);
            m.geometry.dispose();
            m.material.dispose();
        });
        buildingMeshes = [];
    }

    /**
     * Add sample surrounding buildings.
     */
    function addSampleBuildings() {
        clearBuildings();
        // Neighbor buildings
        addBuilding(-8, -6, 4, 6, 8, 0x455a64);
        addBuilding(10, -3, 5, 4, 12, 0x37474f);
        addBuilding(6, 8, 6, 3, 6, 0x546e7a);
        addBuilding(-5, 10, 3, 5, 10, 0x455a64);
        addBuilding(-12, 2, 4, 4, 15, 0x37474f);
        addBuilding(12, 10, 3, 3, 9, 0x546e7a);
    }

    /**
     * Simple manual orbit controls.
     */
    function setupControls(canvas) {
        let isDragging = false;
        let previousMouse = { x: 0, y: 0 };
        let spherical = { theta: Math.PI / 4, phi: Math.PI / 4, radius: 25 };

        function updateCamera() {
            const x = spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
            const y = spherical.radius * Math.cos(spherical.phi);
            const z = spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
            camera.position.set(x, y, z);
            camera.lookAt(0, 2, 0);
        }

        canvas.addEventListener('pointerdown', e => {
            isDragging = true;
            previousMouse = { x: e.clientX, y: e.clientY };
            canvas.setPointerCapture(e.pointerId);
        });

        canvas.addEventListener('pointermove', e => {
            if (!isDragging) return;
            const dx = e.clientX - previousMouse.x;
            const dy = e.clientY - previousMouse.y;
            previousMouse = { x: e.clientX, y: e.clientY };

            spherical.theta -= dx * 0.005;
            spherical.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, spherical.phi + dy * 0.005));
            updateCamera();
        });

        canvas.addEventListener('pointerup', e => {
            isDragging = false;
            canvas.releasePointerCapture(e.pointerId);
        });

        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            spherical.radius = Math.max(8, Math.min(50, spherical.radius + e.deltaY * 0.02));
            updateCamera();
        }, { passive: false });

        // Touch pinch zoom
        let lastPinchDist = 0;
        canvas.addEventListener('touchstart', e => {
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                lastPinchDist = Math.sqrt(dx * dx + dy * dy);
            }
        });

        canvas.addEventListener('touchmove', e => {
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const delta = lastPinchDist - dist;
                spherical.radius = Math.max(8, Math.min(50, spherical.radius + delta * 0.05));
                lastPinchDist = dist;
                updateCamera();
            }
        });

        updateCamera();
    }

    function handleResize(canvas) {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (w === 0 || h === 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }

    function animate() {
        animFrameId = requestAnimationFrame(animate);
        if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }
    }

    function dispose() {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
        clearPaths();
        clearBuildings();
        if (renderer) { renderer.dispose(); renderer = null; }
        isInitialized = false;
    }

    return {
        init,
        updatePaths,
        updateSunPosition,
        addBuilding,
        clearBuildings,
        addSampleBuildings,
        clearPaths,
        dispose,
        get isInitialized() { return isInitialized; },
    };
})();
