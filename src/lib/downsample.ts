/**
 * Downsamples a series to about `targetPoints` by splitting it into equal index
 * buckets and keeping each bucket's lowest and highest point, in their original
 * order. Unlike stride sampling (every Nth point), peaks and valleys always
 * survive: a stride of 50 over a 25k-point trail can skip a summit by hundreds
 * of metres. The first and last points are always kept.
 */
export function downsampleMinMax<T>(points: readonly T[], targetPoints: number, value: (point: T) => number): T[] {
	const n = points.length;
	if (n <= targetPoints || targetPoints < 4) return points.slice();

	const bucketCount = Math.floor((targetPoints - 2) / 2);
	const inner = n - 2;
	const out: T[] = [points[0]];
	for (let b = 0; b < bucketCount; b++) {
		const start = 1 + Math.floor((b * inner) / bucketCount);
		const end = 1 + Math.floor(((b + 1) * inner) / bucketCount);
		if (end <= start) continue;
		let minIndex = start;
		let maxIndex = start;
		let minValue = value(points[start]);
		let maxValue = minValue;
		for (let i = start + 1; i < end; i++) {
			const v = value(points[i]);
			if (v < minValue) {
				minValue = v;
				minIndex = i;
			}
			if (v > maxValue) {
				maxValue = v;
				maxIndex = i;
			}
		}
		if (minIndex === maxIndex) out.push(points[minIndex]);
		else if (minIndex < maxIndex) out.push(points[minIndex], points[maxIndex]);
		else out.push(points[maxIndex], points[minIndex]);
	}
	out.push(points[n - 1]);
	return out;
}
