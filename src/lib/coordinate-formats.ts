/**
 * Coordinate-format conversions for the emergency panel.
 *
 * The 112 panel needs to relay a position in whatever grid the responder
 * works in. Croatian mountain rescue (HGSS) and NATO-aligned SAR commonly
 * use MGRS / UTM, so showing only decimal degrees + a Plus Code can force an
 * on-the-spot conversion during an emergency. This module adds MGRS, UTM, and
 * DMS readouts.
 *
 * The MGRS / UTM forward path is a dependency-free port of the well-known
 * proj4 `mgrs` algorithm (Transverse Mercator on WGS84). It is kept here
 * rather than pulled as an npm dependency to keep the emergency bundle lean
 * and the math auditable. Croatia sits entirely in UTM zones 33T / 34T, well
 * clear of the Norway (32V) and Svalbard zone exceptions - but those
 * exceptions are still implemented so the helper is correct everywhere.
 */

// WGS84 ellipsoid constants and the UTM scale factor.
const WGS84_A = 6378137.0; // semi-major axis (m)
const ECC_SQUARED = 0.00669438; // first eccentricity squared
const UTM_K0 = 0.9996; // central-meridian scale factor

// Char codes used by the MGRS 100km square-letter logic (I and O are skipped).
const CHAR_A = 65;
const CHAR_I = 73;
const CHAR_O = 79;
const CHAR_V = 86;
const CHAR_Z = 90;

const NUM_100K_SETS = 6;
const SET_ORIGIN_COLUMN_LETTERS = 'AJSAJS';
const SET_ORIGIN_ROW_LETTERS = 'AFAFAF';

interface UtmCoordinate {
	zoneNumber: number;
	/** Latitude-band letter (C-X, omitting I and O). */
	zoneLetter: string;
	/** Truncated to the metre. */
	easting: number;
	/** Truncated to the metre. */
	northing: number;
}

/** Latitude-band designator (C-X, 8 deg bands from -80). Returns 'Z' when the
 *  latitude is outside the UTM-defined range (below -80 or above 84). */
function latBandLetter(lat: number): string {
	if (lat <= 84 && lat >= 72) return 'X';
	if (lat < 72 && lat >= 64) return 'W';
	if (lat < 64 && lat >= 56) return 'V';
	if (lat < 56 && lat >= 48) return 'U';
	if (lat < 48 && lat >= 40) return 'T';
	if (lat < 40 && lat >= 32) return 'S';
	if (lat < 32 && lat >= 24) return 'R';
	if (lat < 24 && lat >= 16) return 'Q';
	if (lat < 16 && lat >= 8) return 'P';
	if (lat < 8 && lat >= 0) return 'N';
	if (lat < 0 && lat >= -8) return 'M';
	if (lat < -8 && lat >= -16) return 'L';
	if (lat < -16 && lat >= -24) return 'K';
	if (lat < -24 && lat >= -32) return 'J';
	if (lat < -32 && lat >= -40) return 'H';
	if (lat < -40 && lat >= -48) return 'G';
	if (lat < -48 && lat >= -56) return 'F';
	if (lat < -56 && lat >= -64) return 'E';
	if (lat < -64 && lat >= -72) return 'D';
	if (lat < -72 && lat >= -80) return 'C';
	return 'Z';
}

/** Converts WGS84 lat/lng to a UTM coordinate (zone, band, easting, northing).
 *  Returns null outside the UTM-defined latitude range (below -80 / above 84). */
function latLngToUtm(lat: number, lng: number): UtmCoordinate | null {
	if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat > 84 || lat < -80) return null;

	const latRad = (lat * Math.PI) / 180;
	const lngRad = (lng * Math.PI) / 180;

	// Normalise longitude into [-180, 180) so the zone math is stable at the wrap.
	const lngNorm = ((((lng + 180) % 360) + 360) % 360) - 180;
	let zoneNumber = Math.floor((lngNorm + 180) / 6) + 1;

	// Norway / Svalbard zone exceptions (do not affect Croatia, kept for correctness).
	if (lat >= 56.0 && lat < 64.0 && lngNorm >= 3.0 && lngNorm < 12.0) zoneNumber = 32;
	if (lat >= 72.0 && lat < 84.0) {
		if (lngNorm >= 0.0 && lngNorm < 9.0) zoneNumber = 31;
		else if (lngNorm >= 9.0 && lngNorm < 21.0) zoneNumber = 33;
		else if (lngNorm >= 21.0 && lngNorm < 33.0) zoneNumber = 35;
		else if (lngNorm >= 33.0 && lngNorm < 42.0) zoneNumber = 37;
	}

	const lngOrigin = (zoneNumber - 1) * 6 - 180 + 3; // central meridian of the zone
	const lngOriginRad = (lngOrigin * Math.PI) / 180;

	const eccPrimeSquared = ECC_SQUARED / (1 - ECC_SQUARED);
	const sinLat = Math.sin(latRad);
	const cosLat = Math.cos(latRad);
	const tanLat = Math.tan(latRad);

	const n = WGS84_A / Math.sqrt(1 - ECC_SQUARED * sinLat * sinLat);
	const t = tanLat * tanLat;
	const c = eccPrimeSquared * cosLat * cosLat;
	const a = cosLat * (lngRad - lngOriginRad);

	const m =
		WGS84_A *
		((1 -
			ECC_SQUARED / 4 -
			(3 * ECC_SQUARED * ECC_SQUARED) / 64 -
			(5 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED) / 256) *
			latRad -
			((3 * ECC_SQUARED) / 8 +
				(3 * ECC_SQUARED * ECC_SQUARED) / 32 +
				(45 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED) / 1024) *
				Math.sin(2 * latRad) +
			((15 * ECC_SQUARED * ECC_SQUARED) / 256 + (45 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED) / 1024) *
				Math.sin(4 * latRad) -
			((35 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED) / 3072) * Math.sin(6 * latRad));

	const easting =
		UTM_K0 *
			n *
			(a +
				((1 - t + c) * a * a * a) / 6 +
				((5 - 18 * t + t * t + 72 * c - 58 * eccPrimeSquared) * a * a * a * a * a) / 120) +
		500000.0;

	let northing =
		UTM_K0 *
		(m +
			n *
				tanLat *
				((a * a) / 2 +
					((5 - t + 9 * c + 4 * c * c) * a * a * a * a) / 24 +
					((61 - 58 * t + t * t + 600 * c - 330 * eccPrimeSquared) * a * a * a * a * a * a) / 720));

	if (lat < 0) northing += 10000000.0; // false northing for the southern hemisphere

	return {
		zoneNumber,
		zoneLetter: latBandLetter(lat),
		easting: Math.floor(easting),
		northing: Math.floor(northing),
	};
}

function get100kSetForZone(zoneNumber: number): number {
	const setParm = zoneNumber % NUM_100K_SETS;
	return setParm === 0 ? NUM_100K_SETS : setParm;
}

/** The two-letter 100,000m square identifier for a UTM easting/northing,
 *  applying the I/O skip rules from the MGRS standard. */
function get100kId(easting: number, northing: number, zoneNumber: number): string {
	const setParm = get100kSetForZone(zoneNumber);
	const column = Math.floor(easting / 100000);
	const row = Math.floor(northing / 100000) % 20;

	const index = setParm - 1;
	const colOrigin = SET_ORIGIN_COLUMN_LETTERS.charCodeAt(index);
	const rowOrigin = SET_ORIGIN_ROW_LETTERS.charCodeAt(index);

	let colInt = colOrigin + column - 1;
	let rowInt = rowOrigin + row;
	let rollover = false;

	if (colInt > CHAR_Z) {
		colInt = colInt - CHAR_Z + CHAR_A - 1;
		rollover = true;
	}
	if (
		colInt === CHAR_I ||
		(colOrigin < CHAR_I && colInt > CHAR_I) ||
		((colInt > CHAR_I || colOrigin < CHAR_I) && rollover)
	) {
		colInt++;
	}
	if (
		colInt === CHAR_O ||
		(colOrigin < CHAR_O && colInt > CHAR_O) ||
		((colInt > CHAR_O || colOrigin < CHAR_O) && rollover)
	) {
		colInt++;
		if (colInt === CHAR_I) colInt++;
	}
	if (colInt > CHAR_Z) colInt = colInt - CHAR_Z + CHAR_A - 1;

	if (rowInt > CHAR_V) {
		rowInt = rowInt - CHAR_V + CHAR_A - 1;
		rollover = true;
	} else {
		rollover = false;
	}
	if (
		rowInt === CHAR_I ||
		(rowOrigin < CHAR_I && rowInt > CHAR_I) ||
		((rowInt > CHAR_I || rowOrigin < CHAR_I) && rollover)
	) {
		rowInt++;
	}
	if (
		rowInt === CHAR_O ||
		(rowOrigin < CHAR_O && rowInt > CHAR_O) ||
		((rowInt > CHAR_O || rowOrigin < CHAR_O) && rollover)
	) {
		rowInt++;
		if (rowInt === CHAR_I) rowInt++;
	}
	if (rowInt > CHAR_V) rowInt = rowInt - CHAR_V + CHAR_A - 1;

	return String.fromCharCode(colInt) + String.fromCharCode(rowInt);
}

/** The four MGRS components (zone+band, 100km square id, padded easting and
 *  northing within the square) for a UTM coordinate. Null when the coordinate
 *  is outside the UTM-defined latitude range. */
function mgrsParts(utm: UtmCoordinate): { grid: string; id: string; east: string; north: string } | null {
	if (utm.zoneLetter === 'Z') return null;
	return {
		grid: `${utm.zoneNumber}${utm.zoneLetter}`,
		id: get100kId(utm.easting, utm.northing, utm.zoneNumber),
		east: String(utm.easting % 100000).padStart(5, '0'),
		north: String(utm.northing % 100000).padStart(5, '0'),
	};
}

/** Spaced, human-readable MGRS for the panel, e.g. `33T XM 12345 67890`.
 *  Null outside the UTM latitude range. */
export function formatMgrs(lat: number, lng: number): string | null {
	const utm = latLngToUtm(lat, lng);
	const parts = utm ? mgrsParts(utm) : null;
	return parts ? `${parts.grid} ${parts.id} ${parts.east} ${parts.north}` : null;
}

/** Human-readable UTM for the panel, e.g. `33T 576897E 5074826N`.
 *  Null outside the UTM latitude range. */
export function formatUtm(lat: number, lng: number): string | null {
	const utm = latLngToUtm(lat, lng);
	if (!utm || utm.zoneLetter === 'Z') return null;
	return `${utm.zoneNumber}${utm.zoneLetter} ${utm.easting}E ${utm.northing}N`;
}

/** One axis of a DMS string (matches the runtime output), e.g. `45°48'54.0"`
 *  plus a hemisphere suffix. */
function dmsAxis(value: number, positive: string, negative: string): string {
	const hemisphere = value >= 0 ? positive : negative;
	const abs = Math.abs(value);
	let deg = Math.floor(abs);
	let min = Math.floor((abs - deg) * 60);
	let sec = (abs - deg - min / 60) * 3600;
	// Guard the rounding boundary so 59.96" does not print as 60.0".
	if (Math.round(sec * 10) === 600) {
		sec = 0;
		min += 1;
	}
	if (min === 60) {
		min = 0;
		deg += 1;
	}
	return `${deg}°${String(min).padStart(2, '0')}'${sec.toFixed(1).padStart(4, '0')}"${hemisphere}`;
}

/** Degrees-minutes-seconds for both axes (matches the runtime output), e.g.
 *  `45°48'54.0"N 15°58'55.2"E`. */
export function formatDms(lat: number, lng: number): string {
	return `${dmsAxis(lat, 'N', 'S')} ${dmsAxis(lng, 'E', 'W')}`;
}
