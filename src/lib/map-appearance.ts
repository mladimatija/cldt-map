/** Base-map colour adjustments from the Tools panel ("Map appearance"). Percentages, 100 = unchanged. */
export interface MapAppearance {
	brightness: number;
	contrast: number;
	saturation: number;
}

export const DEFAULT_MAP_APPEARANCE: MapAppearance = { brightness: 100, contrast: 100, saturation: 100 };

/** CSS `filter` value for the tile pane; empty at the defaults so no filter layer is created. */
export function mapAppearanceFilter({ brightness, contrast, saturation }: MapAppearance): string {
	if (brightness === 100 && contrast === 100 && saturation === 100) return '';
	return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
}
