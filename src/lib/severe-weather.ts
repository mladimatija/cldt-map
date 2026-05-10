export type SeverityLevel = 'yellow' | 'orange' | 'red';

export function resolveSeverity(feature: GeoJSON.Feature): SeverityLevel {
	const raw = feature.properties?.severity as string | undefined;
	if (raw === 'red') return 'red';
	if (raw === 'orange') return 'orange';
	return 'yellow';
}
