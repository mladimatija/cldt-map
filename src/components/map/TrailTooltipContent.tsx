'use client';

/**
 * Shared tooltip panel used by both the "Your location" marker (MapMarkers) and
 * the trail click tooltip (TrailRoute). Accepts fully pre-formatted strings so it
 * remains a pure presentational component with no store or locale dependencies.
 */
import React from 'react';
import { Button } from '@/components/ui/Button';

export interface TrailTooltipData {
	lat: number;
	lng: number;
	sectionLabel: string | null;
	elevation: string | null;
	distanceFromStart: string;
	distanceFromStartPct: string;
	distanceToEnd: string;
	distanceToEndPct: string;
	/** Set to the formatted ruler-end distance when the ruler is active; null otherwise. */
	distanceToSection: string | null;
	accumulatedGain: string | null;
	accumulatedGainPct: string | null;
	accumulatedLoss: string | null;
	accumulatedLossPct: string | null;
}

export interface TrailTooltipWeather {
	icon: string;
	condition: string;
	temperature: string;
	feelsLike: string;
	precipitation: string;
	wind: string;
	sunrise: string;
	sunset: string;
}

/** All label strings — callers are responsible for including trailing punctuation (e.g. ":"). */
export interface TrailTooltipLabels {
	close: string;
	coordinates: string;
	section: string;
	elevation: string;
	distanceFromStart: string;
	distanceToEnd: string;
	distanceToSection: string;
	accumulatedGain: string;
	accumulatedLoss: string;
	temperature: string;
	feelsLike: string;
	precipitation: string;
	wind: string;
	sunrise: string;
	sunset: string;
	weatherLoading?: string;
	navigate?: string;
}

interface TrailTooltipContentProps {
	title?: string;
	trailData: TrailTooltipData | null;
	weather: TrailTooltipWeather | null;
	weatherLoading?: boolean;
	labels: TrailTooltipLabels;
	showClose?: boolean;
	canNavigate?: boolean;
	onClose: () => void;
	onNavigate?: () => void;
}

function openCoordinates(lat: number, lng: number): void {
	const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
	if (isMobile) {
		window.location.href = `geo:${lat},${lng}`;
	} else {
		window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank', 'noopener,noreferrer');
	}
}

export function TrailTooltipContent({
	title,
	trailData,
	weather,
	weatherLoading,
	labels,
	showClose,
	canNavigate,
	onClose,
	onNavigate,
}: TrailTooltipContentProps): React.ReactElement {
	return (
		<div
			className="user-location-tooltip-inner"
			role="presentation"
			onClick={(e) => e.stopPropagation()}
			onMouseDown={(e) => e.stopPropagation()}
		>
			{showClose && (
				<Button aria-label={labels.close} className="user-location-close-btn" variant="closeIcon" onClick={onClose}>
					×
				</Button>
			)}
			{title && <div className="text-center font-medium">{title}</div>}
			{trailData && (
				<div className={`${title ? 'mt-1' : ''} space-y-0.5 text-xs`}>
					<div>
						<span className="font-medium">{labels.coordinates}</span>{' '}
						<button
							className="trail-tooltip-coords-link m-0 border-0 bg-transparent p-0 font-bold"
							type="button"
							onClick={() => openCoordinates(trailData.lat, trailData.lng)}
						>
							{trailData.lat.toFixed(5)}, {trailData.lng.toFixed(5)}
						</button>
					</div>
					{trailData.sectionLabel && (
						<div>
							<span className="font-medium">{labels.section}</span> {trailData.sectionLabel}
						</div>
					)}
					{trailData.elevation && (
						<div>
							<span className="font-medium">{labels.elevation}</span> {trailData.elevation}
						</div>
					)}
					<div>
						<span className="font-medium">{labels.distanceFromStart}</span> {trailData.distanceFromStart} (
						{trailData.distanceFromStartPct}%)
					</div>
					<div>
						<span className="font-medium">{labels.distanceToEnd}</span> {trailData.distanceToEnd} (
						{trailData.distanceToEndPct}%)
					</div>
					{trailData.distanceToSection !== null && (
						<div>
							<span className="font-medium">{labels.distanceToSection}</span> {trailData.distanceToSection}
						</div>
					)}
					{trailData.accumulatedGain && (
						<div>
							<span className="font-medium">{labels.accumulatedGain}</span> {trailData.accumulatedGain}
							{trailData.accumulatedGainPct && ` (${trailData.accumulatedGainPct}%)`}
						</div>
					)}
					{trailData.accumulatedLoss && (
						<div>
							<span className="font-medium">{labels.accumulatedLoss}</span> {trailData.accumulatedLoss}
							{trailData.accumulatedLossPct && ` (${trailData.accumulatedLossPct}%)`}
						</div>
					)}
				</div>
			)}
			{(weatherLoading === true || weather !== null) && (
				<div className="mt-1 space-y-0.5 border-t border-black pt-1 text-left text-xs">
					{weatherLoading && labels.weatherLoading && <div className="text-gray-500">{labels.weatherLoading}</div>}
					{weather && (
						<>
							<div>
								<span title={weather.condition}>{weather.icon}</span> {weather.condition}
							</div>
							<div>
								<span className="font-medium">{labels.temperature}</span> {weather.temperature} (
								<span className="font-medium">{labels.feelsLike}</span> {weather.feelsLike})
							</div>
							<div>
								<span className="font-medium">{labels.precipitation}</span> {weather.precipitation}
							</div>
							<div>
								<span className="font-medium">{labels.wind}</span> {weather.wind}
							</div>
							{(weather.sunrise || weather.sunset) && (
								<div>
									<span className="font-medium">{labels.sunrise}</span> {weather.sunrise}{' '}
									<span className="font-medium">{labels.sunset}</span> {weather.sunset}
								</div>
							)}
						</>
					)}
				</div>
			)}
			{canNavigate === true && onNavigate && (
				<div className="mt-2 flex justify-center gap-2">
					<Button variant="mapTooltipPrimary" onClick={onNavigate}>
						{labels.navigate}
					</Button>
				</div>
			)}
		</div>
	);
}
