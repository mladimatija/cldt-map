import type { LatLng } from 'leaflet';
import type * as GeoJSON from 'geojson';
import type { TrailDirection, UnitSystem } from '../types';

export type { TrailDirection, UnitSystem };

export interface LocationState {
	userLocation: { lat: number; lng: number; accuracy?: number } | null;
	isLocating: boolean;
	userLocationInitialized: boolean;
	initialLocationSet: boolean;
	permissionStatus: 'granted' | 'denied' | 'prompt' | null;
	showPermissionNotification: boolean;
	locationError: { code: number; message: string } | null;
	showUserMarker: boolean;
}

export interface LocationActions {
	setUserLocation: (location: { lat: number; lng: number; accuracy?: number } | null) => void;
	setIsLocating: (isLocating: boolean) => void;
	setUserLocationInitialized: (initialized: boolean) => void;
	setInitialLocationSet: (set: boolean) => void;
	setPermissionStatus: (status: 'granted' | 'denied' | 'prompt' | null) => void;
	setShowPermissionNotification: (show: boolean) => void;
	setLocationError: (error: { code: number; message: string } | null) => void;
	setShowUserMarker: (show: boolean) => void;

	handleLocationUpdate: (location: LatLng) => void;
	togglePermissionNotification: (visible: boolean) => void;
	getCurrentLocation: () => Promise<void>;
	initLocationService: () => void;
	requestLocationPermission: () => Promise<void>;
}

export type LocationSlice = LocationState & LocationActions;

export interface ClosestPoint {
	point: LatLng;
	distance: number;
	distanceFromStart: number;
	distanceToEnd: number;
	elevationGainSoFar?: number;
}

export interface EnhancedTrailPoint {
	lat: number;
	lng: number;
	elevation: number;
	distanceFromStart: number;
	elevationGainFromStart: number;
	elevationLossFromStart: number;
	index: number;
	sectionName?: string;
}

export interface TrailMetadata {
	startPoint: LatLng | null;
	endPoint: LatLng | null;
	totalDistance: number;
	elevationGain: number;
	elevationLoss: number;
}

export interface TrailState {
	trailPoints: LatLng[];
	enhancedTrailPoints: EnhancedTrailPoint[];
	highlightedTrailPoint: EnhancedTrailPoint | null;
	tooltipPinnedFromShare: boolean;
	boundaryInitialized: boolean;
	gpxLoaded: boolean;
	gpxLoadFailed: boolean;
	closestPointCalculated: boolean;
	showClosestPointLine: boolean;
	closestPoint: ClosestPoint | null;
	trailMetadata: TrailMetadata;
	rawGpxData: string | null;
	gpxElevationPoints: { lat: number; lng: number; elevation: number }[] | null;
	direction: TrailDirection;
}

export interface TrailActions {
	setTrailPoints: (points: LatLng[]) => void;
	setEnhancedTrailPoints: (points: EnhancedTrailPoint[]) => void;
	setHighlightedTrailPoint: (point: EnhancedTrailPoint | null) => void;
	setBoundaryInitialized: (initialized: boolean) => void;
	setGpxLoaded: (loaded: boolean) => void;
	setGpxLoadFailed: (failed: boolean) => void;
	setClosestPointCalculated: (calculated: boolean) => void;
	setShowClosestPointLine: (show: boolean) => void;
	setClosestPoint: (point: ClosestPoint) => void;
	setTrailMetadata: (metadata: TrailMetadata) => void;
	setRawGpxData: (data: string) => void;
	setGpxElevationPoints: (points: { lat: number; lng: number; elevation: number }[]) => void;
	setDirection: (direction: TrailDirection) => void;

	calculateClosestPoint: () => void;
	forceCalculateClosestPointFromLocation: (location: { lat: number; lng: number }) => void;
	broadcastDirectionChange: (newDirection: TrailDirection) => void;
	processTrailData: (
		points: LatLng[],
		elevationPoints: { lat: number; lng: number; elevation: number }[],
		startPoint: LatLng | null,
		endPoint: LatLng | null,
		distance: number,
		elevGain: number,
		elevLoss: number,
	) => void;
	highlightTrailPosition: (
		position: { lat: number; lng: number; maxDistance?: number } | { distance: number; elevation?: number },
	) => void;
	clearTrailHighlight: (force?: boolean) => void;
	setTooltipPinnedFromShare: (pinned: boolean) => void;
	requestRawGpxData: () => string | null;
	findTrailPointByDistance: (distance: number) => EnhancedTrailPoint | null;
	findTrailPointByCoordinates: (lat: number, lng: number, maxDistanceM?: number) => EnhancedTrailPoint | null;
}

export type TrailSlice = TrailState & TrailActions;

export interface UIState {
	showBoundary: boolean;
	showTileBoundary: boolean;
	units: UnitSystem;
	mapMountTime: number | null;
}

export interface UIActions {
	setShowBoundary: (show: boolean) => void;
	setShowTileBoundary: (show: boolean) => void;
	setUnits: (units: UnitSystem) => void;
	setMapMountTime: (time: number) => void;
	broadcastUnitsChange: (newUnits: UnitSystem) => void;
}

export type UISlice = UIState & UIActions;

export type StoreState = LocationSlice & TrailSlice & UISlice;

export interface MapStoreState {
	selectedTrail: string | null;
	setSelectedTrail: (id: string | null) => void;

	trailData: GeoJSON.FeatureCollection | null;
	setTrailData: (data: GeoJSON.FeatureCollection | null) => void;

	startPoint: unknown | null;
	endPoint: unknown | null;
	totalDistance: number;
	elevationGain: number;
	elevationLoss: number;

	rawGpxData?: string | null;
	setRawGpxData: (data: string | null) => void;
	gpxElevationPoints?: { lat: number; lng: number; elevation: number }[];
	setGpxElevationPoints: (points: { lat: number; lng: number; elevation: number }[]) => void;
	gpxLoaded?: boolean;
	setGpxLoaded: (loaded: boolean) => void;
	gpxLoadFailed?: boolean;
	setGpxLoadFailed: (failed: boolean) => void;
	reloadTrailRequested: number;
	setReloadTrailRequested: (timestamp: number) => void;
	trailPoints?: unknown[];
	requestRawGpxData?: () => string | null;
	processTrailData?: (
		points: unknown[],
		elevationPoints: { lat: number; lng: number; elevation: number }[],
		startPoint: unknown | null,
		endPoint: unknown | null,
		totalDistance: number,
		elevationGain: number,
		elevationLoss: number,
	) => void;

	units: UnitSystem;
	setUnits: (units: UnitSystem) => void;
	distancePrecision: number;
	setDistancePrecision: (precision: number) => void;

	direction: TrailDirection;
	setDirection: (direction: TrailDirection) => void;

	showBoundary: boolean;
	setShowBoundary: (show: boolean) => void;
	showTileBoundary: boolean;
	setShowTileBoundary: (show: boolean) => void;

	isRulerEnabled: boolean;
	setRulerEnabled: (enabled: boolean) => void;

	userLocation: { lat: number; lng: number; accuracy?: number } | null;
	isLocating: boolean;
	permissionStatus: 'granted' | 'denied' | 'prompt' | null;
	locationError: { code: number; message: string } | null;
	setUserLocation: (location: { lat: number; lng: number; accuracy?: number } | null) => void;
	setIsLocating: (isLocating: boolean) => void;
	setPermissionStatus: (status: 'granted' | 'denied' | 'prompt' | null) => void;
	setLocationError: (error: { code: number; message: string } | null) => void;
	getCurrentLocation: () => Promise<{ lat: number; lng: number; error?: { code: number; message: string } }>;
	initLocationService: () => void;
	requestLocationPermission: () => Promise<void>;
	showUserMarker: boolean;
	setShowUserMarker: (show: boolean) => void;
	fakeUserLocationEnabled: boolean;
	setFakeUserLocationEnabled: (enabled: boolean) => void;
	setFakeUserLocation: () => void;
	setFakeUserLocationOnTrail: () => Promise<void>;

	darkMode: boolean;
	setDarkMode: (enabled: boolean) => void;
	batterySaverMode: boolean;
	setBatterySaverMode: (enabled: boolean) => void;
	largeTouchTargets: boolean;
	setLargeTouchTargets: (enabled: boolean) => void;
	showSections: boolean;
	setShowSections: (show: boolean) => void;
	baseMapProvider: string;
	setBaseMapProvider: (provider: string) => void;

	isMapFullscreen: boolean;
	setMapFullscreen: (fullscreen: boolean) => void;
}
