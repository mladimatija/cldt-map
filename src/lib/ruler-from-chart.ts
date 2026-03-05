/**
 * Custom event when the user drags a range on the elevation chart to set the distance ruler.
 */

export const RULER_SET_FROM_CHART_EVENT = 'rulerSetFromChart' as const;

export type RulerSetFromChartDetail = {
	distanceFromStartA: number;
	distanceFromStartB: number;
};
