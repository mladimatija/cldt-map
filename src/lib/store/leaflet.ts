/**
 * Leaflet is loaded only on the client, so the app can SSR without Leaflet's DOM/global assumptions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Leaflet types vary by environment
let L: any;
if (typeof window !== 'undefined') {
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- conditional load for SSR
	L = require('leaflet');
}
export { L };
