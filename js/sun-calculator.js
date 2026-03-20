/**
 * Sun Calculator — Astronomical sun position calculations.
 * Based on NOAA Solar Calculator algorithms.
 * Accuracy: ±0.01° for altitude/azimuth.
 */
const SunCalculator = (() => {
    const RAD = Math.PI / 180;
    const DEG = 180 / Math.PI;

    /**
     * Calculate Julian Day Number from a Date object (UTC).
     */
    function toJulianDay(date) {
        return date.getTime() / 86400000 + 2440587.5;
    }

    /**
     * Julian Century from Julian Day.
     */
    function julianCentury(jd) {
        return (jd - 2451545.0) / 36525.0;
    }

    /**
     * Geometric mean longitude of the sun (degrees).
     */
    function geomMeanLongSun(T) {
        return (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
    }

    /**
     * Geometric mean anomaly of the sun (degrees).
     */
    function geomMeanAnomalySun(T) {
        return 357.52911 + T * (35999.05029 - 0.0001537 * T);
    }

    /**
     * Eccentricity of Earth's orbit.
     */
    function eccentricityEarthOrbit(T) {
        return 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    }

    /**
     * Sun equation of center (degrees).
     */
    function sunEqOfCenter(T) {
        const M = geomMeanAnomalySun(T) * RAD;
        return Math.sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T))
            + Math.sin(2 * M) * (0.019993 - 0.000101 * T)
            + Math.sin(3 * M) * 0.000289;
    }

    /**
     * Sun true longitude (degrees).
     */
    function sunTrueLong(T) {
        return geomMeanLongSun(T) + sunEqOfCenter(T);
    }

    /**
     * Sun apparent longitude (degrees).
     */
    function sunApparentLong(T) {
        const omega = 125.04 - 1934.136 * T;
        return sunTrueLong(T) - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    }

    /**
     * Mean obliquity of the ecliptic (degrees).
     */
    function meanObliquityOfEcliptic(T) {
        return 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    }

    /**
     * Corrected obliquity (degrees).
     */
    function obliquityCorrection(T) {
        const omega = 125.04 - 1934.136 * T;
        return meanObliquityOfEcliptic(T) + 0.00256 * Math.cos(omega * RAD);
    }

    /**
     * Sun declination (degrees).
     */
    function sunDeclination(T) {
        const e = obliquityCorrection(T) * RAD;
        const lambda = sunApparentLong(T) * RAD;
        return Math.asin(Math.sin(e) * Math.sin(lambda)) * DEG;
    }

    /**
     * Equation of time (minutes).
     */
    function equationOfTime(T) {
        const e = eccentricityEarthOrbit(T);
        const L0 = geomMeanLongSun(T) * RAD;
        const M = geomMeanAnomalySun(T) * RAD;
        const obliq = obliquityCorrection(T) * RAD;

        let y = Math.tan(obliq / 2);
        y *= y;

        const EoT = y * Math.sin(2 * L0)
            - 2 * e * Math.sin(M)
            + 4 * e * y * Math.sin(M) * Math.cos(2 * L0)
            - 0.5 * y * y * Math.sin(4 * L0)
            - 1.25 * e * e * Math.sin(2 * M);

        return 4 * EoT * DEG;
    }

    /**
     * Hour angle for sunrise/sunset (degrees).
     * zenith: 90.833 for standard, 96 for civil twilight, etc.
     */
    function hourAngleSunrise(lat, decl, zenith = 90.833) {
        const latR = lat * RAD;
        const declR = decl * RAD;
        const cosHA = (Math.cos(zenith * RAD) / (Math.cos(latR) * Math.cos(declR))) - Math.tan(latR) * Math.tan(declR);
        if (cosHA > 1) return NaN; // No sunrise (polar night)
        if (cosHA < -1) return NaN; // No sunset (midnight sun)
        return Math.acos(cosHA) * DEG;
    }

    /**
     * Get sun position (altitude, azimuth) for a given date/time and location.
     * @param {Date} date - Date/time (local or UTC).
     * @param {number} lat - Latitude in degrees.
     * @param {number} lng - Longitude in degrees.
     * @returns {{ altitude: number, azimuth: number }} Degrees.
     */
    function getPosition(date, lat, lng) {
        const jd = toJulianDay(date);
        const T = julianCentury(jd);
        const decl = sunDeclination(T);
        const eqTime = equationOfTime(T);

        // Time in minutes from midnight UTC
        const utcH = date.getUTCHours();
        const utcM = date.getUTCMinutes();
        const utcS = date.getUTCSeconds();
        const totalMinutes = utcH * 60 + utcM + utcS / 60;

        // True solar time
        const trueSolarTime = ((totalMinutes + eqTime + 4 * lng) % 1440 + 1440) % 1440;

        // Hour angle
        let hourAngle = trueSolarTime / 4 - 180;

        const latR = lat * RAD;
        const declR = decl * RAD;
        const haR = hourAngle * RAD;

        // Solar zenith / altitude
        const sinAlt = Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(haR);
        const altitude = Math.asin(sinAlt) * DEG;

        // Solar azimuth
        const cosZenith = sinAlt;
        const sinZenith = Math.sqrt(1 - sinAlt * sinAlt);
        let azimuth;
        if (sinZenith === 0) {
            azimuth = 0;
        } else {
            const cosAz = (Math.sin(declR) - Math.sin(latR) * cosZenith) / (Math.cos(latR) * sinZenith);
            azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) * DEG;
            if (hourAngle > 0) {
                azimuth = 360 - azimuth;
            }
        }

        return { altitude, azimuth };
    }

    /**
     * Get sunrise, sunset, solar noon, and day length for a date and location.
     * Times returned as Date objects in UTC.
     * @param {Date} date - Any date (only the date portion is used).
     * @param {number} lat - Latitude in degrees.
     * @param {number} lng - Longitude in degrees.
     */
    function getTimes(date, lat, lng) {
        const year = date.getFullYear();
        const month = date.getMonth();
        const day = date.getDate();

        const noon = new Date(Date.UTC(year, month, day, 12, 0, 0));
        const jd = toJulianDay(noon);
        const T = julianCentury(jd);

        const eqTime = equationOfTime(T);
        const decl = sunDeclination(T);
        const ha = hourAngleSunrise(lat, decl);

        // Solar noon in minutes from midnight UTC
        const solarNoonMin = 720 - 4 * lng - eqTime;

        const result = {
            solarNoon: minutesToDate(year, month, day, solarNoonMin),
            solarNoonMin
        };

        if (isNaN(ha)) {
            result.sunrise = null;
            result.sunset = null;
            result.dayLength = decl > 0 === lat > 0 ? 1440 : 0;
        } else {
            const sunriseMin = solarNoonMin - ha * 4;
            const sunsetMin = solarNoonMin + ha * 4;
            result.sunrise = minutesToDate(year, month, day, sunriseMin);
            result.sunset = minutesToDate(year, month, day, sunsetMin);
            result.sunriseMin = sunriseMin;
            result.sunsetMin = sunsetMin;
            result.dayLength = ha * 8; // minutes
        }

        return result;
    }

    /**
     * Compute the full sun path for a given date (altitude/azimuth every N minutes).
     * @param {Date} date - The date.
     * @param {number} lat - Latitude.
     * @param {number} lng - Longitude.
     * @param {number} stepMinutes - Step size in minutes (default: 10).
     * @returns {Array<{ minutes: number, altitude: number, azimuth: number }>}
     */
    function getPath(date, lat, lng, stepMinutes = 10) {
        const year = date.getFullYear();
        const month = date.getMonth();
        const day = date.getDate();
        const path = [];

        for (let m = 0; m <= 1440; m += stepMinutes) {
            const d = new Date(Date.UTC(year, month, day, 0, m, 0));
            const pos = getPosition(d, lat, lng);
            path.push({ minutes: m, ...pos });
        }

        return path;
    }

    /**
     * Convert minutes-from-midnight-UTC to a Date.
     */
    function minutesToDate(year, month, day, minutes) {
        const d = new Date(Date.UTC(year, month, day));
        d.setUTCMinutes(d.getUTCMinutes() + Math.round(minutes));
        return d;
    }

    /**
     * Format minutes as HH:MM.
     */
    function formatTime(minutes) {
        const h = Math.floor(((minutes % 1440) + 1440) % 1440 / 60);
        const m = Math.round(minutes % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    /**
     * Convert azimuth degrees to compass bearing string.
     */
    function azimuthToCompass(az) {
        const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const idx = Math.round(((az % 360 + 360) % 360) / 22.5) % 16;
        return dirs[idx];
    }

    return {
        getPosition,
        getTimes,
        getPath,
        formatTime,
        azimuthToCompass,
    };
})();
