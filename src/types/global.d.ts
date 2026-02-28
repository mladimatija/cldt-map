/** Allow importing .css files in TypeScript (e.g., leaflet/dist/leaflet.css). */
declare module '*.css' {
	const content: { [className: string]: string };
	export default content;
}
