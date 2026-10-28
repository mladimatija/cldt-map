/** Single base64url JSON blob for stage plan, waypoints, journal, completion, stars. */
export const SHARE_TRIP_PARAM_KEY = 'trip';

/** Max `?` search length for share URLs (short-link storage and validation). */
export const SHARE_TARGET_MAX_LEN = 2048;

/** A shared waypoint this close to an own one is taken as the same place. */
export const SHARED_WAYPOINT_DEDUPE_M = 10;

/** Share panel trip parts until the user changes them: waypoints and progress
 *  on, journal text (private notes) off. The include toggle itself starts off. */
export const DEFAULT_SHARE_TRIP_STATE_PARTS: Readonly<{ waypoints: boolean; progress: boolean; journal: boolean }> = {
	waypoints: true,
	progress: true,
	journal: false,
};

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
	'wp',
	SHARE_TRIP_PARAM_KEY,
] as const;

/** Netlify Blobs store for `/s/{code}` short links; the shortener and the
 *  monthly cleanup function both use it. */
export const SHARE_LINKS_BLOB_STORE = 'share-links';
