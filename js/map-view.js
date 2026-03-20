/**
 * Map View — Leaflet-based map for location selection and search.
 */
const MapView = (() => {
    let map, marker, sunArcLayer;
    let currentLat = 52.37;  // Default: Amsterdam
    let currentLng = 4.895;
    let onLocationChange = null;
    let searchTimeout = null;

    /**
     * Initialize the map.
     * @param {function} locationCallback - Called with (lat, lng) when location changes.
     */
    function init(locationCallback) {
        onLocationChange = locationCallback;

        map = L.map('leaflet-map', {
            center: [currentLat, currentLng],
            zoom: 15,
            zoomControl: true,
        });

        // Dark tile layer
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
            maxZoom: 20,
        }).addTo(map);

        // Location marker
        const sunIcon = L.divIcon({
            className: 'sun-marker',
            html: '<div style="width:24px;height:24px;border-radius:50%;background:#f59e0b;border:3px solid #fbbf24;box-shadow:0 0 16px rgba(245,158,11,0.6);"></div>',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
        });

        marker = L.marker([currentLat, currentLng], { icon: sunIcon, draggable: true }).addTo(map);
        marker.on('dragend', () => {
            const pos = marker.getLatLng();
            setLocation(pos.lat, pos.lng);
        });

        // Click to set location
        map.on('click', (e) => {
            setLocation(e.latlng.lat, e.latlng.lng);
        });

        // Sun arc overlay layer
        sunArcLayer = L.layerGroup().addTo(map);

        // Search functionality
        setupSearch();

        // Try to get user's location
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                pos => {
                    setLocation(pos.coords.latitude, pos.coords.longitude);
                    map.setView([pos.coords.latitude, pos.coords.longitude], 16);
                },
                () => { /* Use default location */ },
                { enableHighAccuracy: true, timeout: 5000 }
            );
        }

        updateCoordinateDisplay();
    }

    function setLocation(lat, lng) {
        currentLat = lat;
        currentLng = lng;
        marker.setLatLng([lat, lng]);
        updateCoordinateDisplay();
        if (onLocationChange) onLocationChange(lat, lng);
    }

    function updateCoordinateDisplay() {
        document.getElementById('display-lat').textContent = currentLat.toFixed(5);
        document.getElementById('display-lng').textContent = currentLng.toFixed(5);
    }

    /**
     * Draw the sun arc on the map as a polyline.
     */
    function drawSunArcOnMap(pathData) {
        sunArcLayer.clearLayers();

        const points = [];
        const arcRadius = 0.002; // ~200m in map coordinates

        pathData.forEach(p => {
            if (p.altitude < 0) return;
            const azR = (p.azimuth - 90) * Math.PI / 180;
            const dlat = arcRadius * Math.cos(-azR) * (p.altitude / 45);
            const dlng = arcRadius * Math.sin(-azR) * (p.altitude / 45) / Math.cos(currentLat * Math.PI / 180);
            points.push([currentLat + dlat, currentLng + dlng]);
        });

        if (points.length > 1) {
            L.polyline(points, {
                color: '#f59e0b',
                weight: 3,
                opacity: 0.7,
                dashArray: '8 4',
            }).addTo(sunArcLayer);
        }
    }

    function setupSearch() {
        const input = document.getElementById('location-search');
        const resultsList = document.getElementById('search-results');

        input.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            const query = input.value.trim();
            if (query.length < 3) {
                resultsList.classList.remove('visible');
                return;
            }
            searchTimeout = setTimeout(() => searchLocation(query), 400);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                resultsList.classList.remove('visible');
                input.blur();
            }
        });

        // Close results on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#map-search')) {
                resultsList.classList.remove('visible');
            }
        });
    }

    async function searchLocation(query) {
        const resultsList = document.getElementById('search-results');
        try {
            const url = new URL('https://nominatim.openstreetmap.org/search');
            url.searchParams.set('q', query);
            url.searchParams.set('format', 'json');
            url.searchParams.set('limit', '5');
            url.searchParams.set('addressdetails', '1');

            const resp = await fetch(url, {
                headers: { 'Accept': 'application/json' }
            });
            const data = await resp.json();

            resultsList.innerHTML = '';
            if (data.length === 0) {
                resultsList.innerHTML = '<li style="color: var(--text-secondary);">No results found</li>';
                resultsList.classList.add('visible');
                return;
            }

            data.forEach(item => {
                const li = document.createElement('li');
                li.textContent = item.display_name;
                li.addEventListener('click', () => {
                    const lat = parseFloat(item.lat);
                    const lng = parseFloat(item.lon);
                    setLocation(lat, lng);
                    map.setView([lat, lng], 17);
                    resultsList.classList.remove('visible');
                    document.getElementById('location-search').value = item.display_name;
                });
                resultsList.appendChild(li);
            });
            resultsList.classList.add('visible');
        } catch (err) {
            console.warn('Search error:', err);
        }
    }

    function invalidateSize() {
        if (map) {
            setTimeout(() => map.invalidateSize(), 100);
        }
    }

    function getLocation() {
        return { lat: currentLat, lng: currentLng };
    }

    return {
        init,
        setLocation,
        drawSunArcOnMap,
        invalidateSize,
        getLocation,
    };
})();
