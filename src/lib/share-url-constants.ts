/** Single base64url JSON blob for stage plan, waypoints, journal, completion, stars. */
export const SHARE_TRIP_PARAM_KEY = 'trip';

/** Max `?` search length for share URLs (short-link storage and validation). */
export const SHARE_TARGET_MAX_LEN = 2048;

/** Query param keys used by map share / POI deep links. Keep in sync across encode, parse, and shortener validation. */
export const SHARE_QUERY_PARAM_KEYS = [
	'lat',
	'lng',
	'zoom',
	'dir',
	'progress',
	'unit',
	'baseMap',
	'trailStyle',
	'sections',
	'dark',
	'ruler',
	'pois',
	'weather',
	'radar',
	'distanceMarkers',
	'waymarked',
	'poi',
	SHARE_TRIP_PARAM_KEY,
] as const;
