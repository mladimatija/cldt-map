import type { CourseMesg, EventMesg, FileIdMesg, LapMesg, RecordMesg } from '@garmin/fitsdk';
import type { GpxExportPoint } from '@/lib/gpx-export';
import { haversineDistanceM } from '@/lib/haversine';

const SEMICIRCLES_PER_DEGREE = 2 ** 31 / 180;
/** processed + valid + distance + position */
const COURSE_CAPABILITIES = 0x00000001 | 0x00000002 | 0x00000008 | 0x00000010;

function toSemicircles(degrees: number): number {
	return Math.round(degrees * SEMICIRCLES_PER_DEGREE);
}

export interface FitCourseBuildOptions {
	points: GpxExportPoint[];
	courseName: string;
	totalAscentM?: number;
	totalDescentM?: number;
}

/**
 * Builds a Garmin FIT course file for a trail segment. Uses FILE_ID + COURSE +
 * LAP + timer events + RECORD messages, matching common third-party course
 * encoders so Fenix / Edge / Explore can load the route.
 */
export async function buildFitCourseBytes(options: FitCourseBuildOptions): Promise<Uint8Array> {
	const { points, courseName, totalAscentM, totalDescentM } = options;
	if (points.length < 2) throw new Error('FIT course requires at least two points');

	const { Encoder, Profile } = await import('@garmin/fitsdk');

	const start = new Date();
	const startPt = points[0];
	const endPt = points[points.length - 1];

	const distances: number[] = [0];
	for (let i = 1; i < points.length; i++) {
		distances.push(
			distances[i - 1] + haversineDistanceM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng),
		);
	}

	const encoder = new Encoder();

	const fileId: FileIdMesg = {
		type: 'course',
		manufacturer: 'development',
		product: 0,
		timeCreated: start,
	};
	encoder.onMesg(Profile.MesgNum.FILE_ID, fileId);

	const course: CourseMesg = {
		name: courseName.slice(0, 254),
		sport: 'hiking',
		capabilities: COURSE_CAPABILITIES,
	};
	encoder.onMesg(Profile.MesgNum.COURSE, course);

	const lap: LapMesg = {
		timestamp: start,
		startTime: start,
		totalTimerTime: points.length,
		startPositionLat: toSemicircles(startPt.lat),
		startPositionLong: toSemicircles(startPt.lng),
		endPositionLat: toSemicircles(endPt.lat),
		endPositionLong: toSemicircles(endPt.lng),
	};
	if (totalAscentM !== undefined && totalAscentM > 0) lap.totalAscent = Math.round(totalAscentM);
	if (totalDescentM !== undefined && totalDescentM > 0) lap.totalDescent = Math.round(totalDescentM);
	encoder.onMesg(Profile.MesgNum.LAP, lap);

	const startEvent: EventMesg = {
		timestamp: start,
		event: 'timer',
		eventType: 'start',
		eventGroup: 0,
	};
	encoder.onMesg(Profile.MesgNum.EVENT, startEvent);

	points.forEach((p, i) => {
		const record: RecordMesg = {
			timestamp: new Date(start.getTime() + i * 1000),
			positionLat: toSemicircles(p.lat),
			positionLong: toSemicircles(p.lng),
			distance: Math.round(distances[i]),
		};
		if (p.elevation !== undefined) record.enhancedAltitude = p.elevation;
		encoder.onMesg(Profile.MesgNum.RECORD, record);
	});

	const endTime = new Date(start.getTime() + points.length * 1000);
	const stopEvent: EventMesg = {
		timestamp: endTime,
		event: 'timer',
		eventType: 'stopDisableAll',
		eventGroup: 0,
	};
	encoder.onMesg(Profile.MesgNum.EVENT, stopEvent);

	return encoder.close();
}

/** Triggers a browser file download for the given FIT course bytes. */
export function downloadFitFile(bytes: Uint8Array, filename: string): void {
	const blob = new Blob([Uint8Array.from(bytes)], {
		type: 'application/vnd.ant.fit',
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
