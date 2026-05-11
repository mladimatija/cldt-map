/** Allow importing .css files in TypeScript (e.g., leaflet/dist/leaflet.css). */
declare module '*.css' {
	const content: { [className: string]: string };
	export default content;
}

/** Type stub for the `open-location-code` package (no bundled types). */
declare module 'open-location-code' {
	export class OpenLocationCode {
		encode(latitude: number, longitude: number, codeLength?: number): string;
		decode(code: string): {
			latitudeLo: number;
			longitudeLo: number;
			latitudeHi: number;
			longitudeHi: number;
			latitudeCenter: number;
			longitudeCenter: number;
			codeLength: number;
		};
		isValid(code: string): boolean;
		isFull(code: string): boolean;
		isShort(code: string): boolean;
	}
}
