/**
 * Shadow Simulator — Calculates and visualizes building shadow projections.
 */
const ShadowSimulator = (() => {
    /**
     * Calculate shadow polygon for a rectangular building.
     * @param {{ x, z, width, depth, height }} building - Building params in scene coordinates.
     * @param {number} altitude - Sun altitude in degrees.
     * @param {number} azimuth - Sun azimuth in degrees (0=N, 90=E, 180=S, 270=W).
     * @returns {Array<{x, z}>} Shadow polygon corners on the ground plane.
     */
    function calculateBuildingShadow(building, altitude, azimuth) {
        if (altitude <= 0) return []; // No shadow when sun is below horizon

        const shadowLength = building.height / Math.tan(altitude * Math.PI / 180);
        const azR = (azimuth * Math.PI / 180);

        // Shadow direction (opposite to sun azimuth)
        const dx = -Math.sin(azR) * shadowLength;
        const dz = -Math.cos(azR) * shadowLength;

        // Building corners (top view)
        const hw = building.width / 2;
        const hd = building.depth / 2;
        const corners = [
            { x: building.x - hw, z: building.z - hd },
            { x: building.x + hw, z: building.z - hd },
            { x: building.x + hw, z: building.z + hd },
            { x: building.x - hw, z: building.z + hd },
        ];

        // Shadow polygon = building footprint + projected top corners
        const shadowCorners = corners.map(c => ({ x: c.x + dx, z: c.z + dz }));

        // Return the convex hull of building footprint + shadow tips
        return convexHull([...corners, ...shadowCorners]);
    }

    /**
     * Simple convex hull (Graham scan) for 2D points {x, z}.
     */
    function convexHull(points) {
        if (points.length < 3) return points;

        // Find lowest-z point (leftmost if tie)
        let start = 0;
        for (let i = 1; i < points.length; i++) {
            if (points[i].z < points[start].z || (points[i].z === points[start].z && points[i].x < points[start].x)) {
                start = i;
            }
        }
        [points[0], points[start]] = [points[start], points[0]];

        const pivot = points[0];
        points.sort((a, b) => {
            if (a === pivot) return -1;
            if (b === pivot) return 1;
            const angleA = Math.atan2(a.x - pivot.x, a.z - pivot.z);
            const angleB = Math.atan2(b.x - pivot.x, b.z - pivot.z);
            return angleA - angleB;
        });

        const stack = [points[0], points[1]];
        for (let i = 2; i < points.length; i++) {
            while (stack.length > 1 && cross(stack[stack.length - 2], stack[stack.length - 1], points[i]) <= 0) {
                stack.pop();
            }
            stack.push(points[i]);
        }
        return stack;
    }

    function cross(O, A, B) {
        return (A.x - O.x) * (B.z - O.z) - (A.z - O.z) * (B.x - O.x);
    }

    /**
     * Calculate shadow coverage percentage at a point for a full day.
     * Returns hours of shadow vs. hours of daylight.
     * @param {{ x, z }} point - Ground position to check.
     * @param {Array} buildings - Array of building objects.
     * @param {Date} date - The date.
     * @param {number} lat - Latitude.
     * @param {number} lng - Longitude.
     * @returns {{ shadowHours: number, daylightHours: number, percentage: number }}
     */
    function calculateShadowCoverage(point, buildings, date, lat, lng) {
        const times = SunCalculator.getTimes(date, lat, lng);
        if (!times.sunrise || !times.sunset) {
            return { shadowHours: 0, daylightHours: times.dayLength / 60, percentage: 0 };
        }

        let shadowMinutes = 0;
        const stepMin = 10;
        const year = date.getFullYear();
        const month = date.getMonth();
        const day = date.getDate();

        for (let m = Math.floor(times.sunriseMin); m <= Math.ceil(times.sunsetMin); m += stepMin) {
            const d = new Date(Date.UTC(year, month, day, 0, m));
            const pos = SunCalculator.getPosition(d, lat, lng);
            if (pos.altitude <= 0) continue;

            let inShadow = false;
            for (const b of buildings) {
                const shadow = calculateBuildingShadow(b, pos.altitude, pos.azimuth);
                if (isPointInPolygon(point, shadow)) {
                    inShadow = true;
                    break;
                }
            }
            if (inShadow) shadowMinutes += stepMin;
        }

        const daylightHours = times.dayLength / 60;
        const shadowHours = shadowMinutes / 60;

        return {
            shadowHours,
            daylightHours,
            percentage: daylightHours > 0 ? (shadowHours / daylightHours) * 100 : 0,
        };
    }

    /**
     * Point-in-polygon test (ray casting).
     */
    function isPointInPolygon(point, polygon) {
        if (polygon.length < 3) return false;
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, zi = polygon[i].z;
            const xj = polygon[j].x, zj = polygon[j].z;

            if ((zi > point.z) !== (zj > point.z) &&
                point.x < (xj - xi) * (point.z - zi) / (zj - zi) + xi) {
                inside = !inside;
            }
        }
        return inside;
    }

    return {
        calculateBuildingShadow,
        calculateShadowCoverage,
        isPointInPolygon,
    };
})();
