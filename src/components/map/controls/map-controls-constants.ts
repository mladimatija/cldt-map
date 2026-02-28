/** Distance precision slider range (0–3 decimal places). Value comes from config.distancePrecision / store. */
export const DISTANCE_PRECISION_MIN = 0;
export const DISTANCE_PRECISION_MAX = 3;

/** Shared class for round control buttons (inactive state). */
export const CONTROL_BTN_BASE =
	'flex h-10 w-10 items-center justify-center rounded-full shadow-md transition-all outline-none';
export const CONTROL_BTN_INACTIVE =
	'text-cldt-blue hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green cursor-pointer border border-gray-200 bg-white hover:border-2 focus-visible:border-2';
export const CONTROL_BTN_ACTIVE =
	'border-cldt-blue text-cldt-blue hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green cursor-pointer border-2 bg-white hover:border-2 focus-visible:border-2';
