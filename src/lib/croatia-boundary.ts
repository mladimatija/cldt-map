import type * as GeoJSON from 'geojson';

const CROATIA_BOUNDARY_URL = '/data/croatia-boundary-display.json';

let croatiaBoundaryPromise: Promise<GeoJSON.FeatureCollection> | null = null;

/** The Croatia outline both the border layer and tile clipping use (simplified
 *  display copy, `npm run build:boundary`), fetched once per page on first use
 *  instead of shipping in the map bundle. A failed load is retried on the next
 *  call. */
export function loadCroatiaBoundary(): Promise<GeoJSON.FeatureCollection> {
	croatiaBoundaryPromise ??= fetch(CROATIA_BOUNDARY_URL).then((res) => {
		if (!res.ok) throw new Error(`boundary HTTP ${res.status}`);
		return res.json() as Promise<GeoJSON.FeatureCollection>;
	});
	croatiaBoundaryPromise.catch(() => {
		croatiaBoundaryPromise = null;
	});
	return croatiaBoundaryPromise;
}
