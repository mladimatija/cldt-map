/**
 * POI popup HTML builders. Pure string factories that produce the inner
 * markup Leaflet binds via `bindPopup`. Extracted from PoiMarkers.tsx so the
 * component file stays focused on Leaflet effect orchestration; these
 * builders have no React, no map, and no store-subscription concerns - just
 * `Poi` in, escaped HTML string out.
 */

import type { TrailDirection, UnitSystem } from '@/lib/types';
import type { Poi } from '@/lib/pois';
import { formatDistance, isSafeUrl } from '@/lib/utils';
import { formatIsoDate } from '@/lib/date-format';
import { escapeHtml } from '@/components/map/poi-marker-utils';

export interface PopupBuildArgs {
	direction: TrailDirection;
	units: UnitSystem;
	totalKm: number;
	distancePrecision: number;
	locale: string;
	labels: PopupBuildLabels;
	isStarred: boolean;
}

export interface PopupBuildLabels {
	distanceLabel: string;
	offTrailLabel: string;
	elevationLabel: string;
	phoneLabel: string;
	capacityLabel: string;
	seasonLabel: string;
	populationLabel: string;
	wikipediaLoading: string;
	wikipediaSource: string;
	shareLink: string;
	shareCopied: string;
	shareFailed: string;
	openInMaps: string;
	starAddLabel: string;
	starRemoveLabel: string;
	sourceOsm: string;
	sourceWikidata: string;
	sourceHps: string;
	sourceCurated: string;
	lastVerifiedLabel: string;
	/** Used as aria-label prefix for gallery thumbnail buttons: "{galleryImageLabel} {i+1} of {total}: {name}". */
	galleryImageLabel: string;
	/** Water reliability badge labels, keyed by WaterReliability class. */
	waterReliable: string;
	waterSeasonal: string;
	waterUnverified: string;
	waterNotPotable: string;
	/** Prefix for the OSM check_date shown next to the water badge. */
	waterCheckedLabel: string;
}

/** Builds the gallery or legacy single-image HTML block. Returns empty string
 *  if no images. */
export function buildGalleryHtml(
	poi: Poi,
	displayName: string,
	labels?: Pick<PopupBuildLabels, 'galleryImageLabel'>,
): string {
	const lines: string[] = [];
	// The Phase 4 `images[]` field wins when present (carries attribution and
	// licence); fall back to the legacy `image` string for older datasets.
	// URLs pass through `isSafeUrl` to guard against `javascript:` or
	// malformed entries sneaking in.
	const gallery = (poi.images ?? []).filter((img) => isSafeUrl(img.url));
	if (gallery.length > 0) {
		lines.push(
			`<div class="poi-popup__gallery" role="group" aria-label="${escapeHtml(displayName)}" data-poi-gallery-id="${escapeHtml(poi.id)}">`,
		);
		gallery.forEach((img, i) => {
			const src = img.thumbUrl && isSafeUrl(img.thumbUrl) ? img.thumbUrl : img.url;
			// Each thumbnail is a button that opens the lightbox at this index.
			// Attribution appears inline; the source link moves to the lightbox
			// so the gallery row stays compact.
			const galleryBtnAria = labels?.galleryImageLabel
				? `${escapeHtml(labels.galleryImageLabel)} ${i + 1} / ${gallery.length}: ${escapeHtml(displayName)}`
				: `${escapeHtml(displayName)} (${i + 1})`;
			lines.push(`<figure class="poi-popup__gallery-item">`);
			lines.push(
				`<button type="button" class="poi-popup__gallery-btn" data-gallery-index="${i}" aria-label="${galleryBtnAria}">` +
					`<img class="poi-popup__gallery-img" src="${escapeHtml(src)}" alt="${escapeHtml(displayName)}" loading="lazy" />` +
					`</button>`,
			);
			if (img.attribution) {
				const cap = `${escapeHtml(img.attribution)}${img.license ? ' · ' + escapeHtml(img.license) : ''}`;
				lines.push(`<figcaption class="poi-popup__gallery-cap">${cap}</figcaption>`);
			}
			lines.push(`</figure>`);
		});
		lines.push(`</div>`);
	} else if (poi.image && isSafeUrl(poi.image)) {
		lines.push(
			`<img class="poi-popup__image" src="${escapeHtml(poi.image)}" alt="${escapeHtml(displayName)}" loading="lazy" />`,
		);
	}
	return lines.join('');
}

/** Builds the metadata rows (position, elevation, population, season, phone,
 *  URL, Wikipedia, provenance) that appear below the title. */
export function buildMetaRowsHtml(
	poi: Poi,
	args: PopupBuildArgs,
	trailDistanceLabel: string,
	onTrail: boolean,
	offTrailLabel: string | null,
): string {
	const { units, labels, locale } = args;
	const lines: string[] = [];
	// Mutually exclusive trail-position lines: a POI is either on the trail
	// (within 0.5 km) or it isn't, and we don't want both numbers competing.
	//   - On-trail  -> show "Position on the trail: <km along the route>"
	//   - Off-trail -> show "Off trail: <walk-in distance>" only; the trail
	//                  position becomes noise once you're hiking off-route.
	const roundedOffTrailKm = Math.round(poi.distanceFromTrailKm * 10) / 10;
	if (onTrail || roundedOffTrailKm < 0.1) {
		lines.push(
			`<p class="poi-popup__row"><span class="poi-popup__label">${escapeHtml(labels.distanceLabel)}</span> ${escapeHtml(trailDistanceLabel)}</p>`,
		);
	} else {
		lines.push(
			`<p class="poi-popup__row poi-popup__row--muted"><span class="poi-popup__label">${escapeHtml(labels.offTrailLabel)}</span> ${escapeHtml(offTrailLabel ?? '')}</p>`,
		);
	}
	// Water reliability badge: a coloured chip directly under the position
	// line, plus the last OSM survey date when a mapper recorded one.
	if (poi.water) {
		const rel = poi.water.reliability;
		const relLabel =
			rel === 'reliable'
				? labels.waterReliable
				: rel === 'seasonal'
					? labels.waterSeasonal
					: rel === 'not_potable'
						? labels.waterNotPotable
						: labels.waterUnverified;
		const chipModifier = rel === 'not_potable' ? 'nonpotable' : rel;
		const checked = poi.water.checkDate
			? ` <span class="poi-popup__row--muted">${escapeHtml(labels.waterCheckedLabel)} ${escapeHtml(formatIsoDate(poi.water.checkDate, locale))}</span>`
			: '';
		lines.push(
			`<p class="poi-popup__row"><span class="poi-popup__water poi-popup__water--${chipModifier}">${escapeHtml(relLabel)}</span>${checked}</p>`,
		);
	}
	if (typeof poi.elevationM === 'number') {
		const elev =
			units === 'imperial' ? `${Math.round(poi.elevationM * 3.28084)} ft` : `${Math.round(poi.elevationM)} m`;
		lines.push(
			`<p class="poi-popup__row"><span class="poi-popup__label">${escapeHtml(labels.elevationLabel)}</span> ${escapeHtml(elev)}</p>`,
		);
	}
	if (typeof poi.population === 'number') {
		lines.push(
			`<p class="poi-popup__row"><span class="poi-popup__label">${escapeHtml(labels.populationLabel)}</span> ${escapeHtml(poi.population.toLocaleString())}</p>`,
		);
	}
	if (typeof poi.capacity === 'number') {
		lines.push(
			`<p class="poi-popup__row"><span class="poi-popup__label">${escapeHtml(labels.capacityLabel)}</span> ${escapeHtml(String(poi.capacity))}</p>`,
		);
	}
	if (poi.season) {
		lines.push(
			`<p class="poi-popup__row"><span class="poi-popup__label">${escapeHtml(labels.seasonLabel)}</span> ${escapeHtml(poi.season)}</p>`,
		);
	}
	// Drop forward-slash from the allow-list - it's never part of an ITU /
	// E.164-shaped phone number, and removing it tightens the input shape we
	// embed into a `tel:` href.
	const safePhone = /^\+?[\d\s().,-]{1,25}$/.test(poi.phone ?? '') ? poi.phone : null;
	if (safePhone) {
		lines.push(
			`<p class="poi-popup__row"><span class="poi-popup__label">${escapeHtml(labels.phoneLabel)}</span> <a href="tel:${escapeHtml(safePhone)}" class="poi-popup__link">${escapeHtml(safePhone)}</a></p>`,
		);
	}
	// Explicit https:// allow-list on top of isSafeUrl so the policy stays
	// self-documenting and survives any future relaxation of the helper.
	if (poi.url && isSafeUrl(poi.url) && poi.url.startsWith('https://')) {
		lines.push(
			`<p class="poi-popup__row poi-popup__row--link"><a href="${escapeHtml(poi.url)}" target="_blank" rel="noopener noreferrer" class="poi-popup__link">${escapeHtml(poi.url)}</a></p>`,
		);
	}
	// Wikipedia summary. Three tiers:
	//   1. Baked summary in the active locale (Phase 5): render immediately,
	//      no async fetch needed - the popup is full-fidelity offline.
	//   2. Baked summary in the other locale: render that as a fallback so
	//      the popup isn't blank when the user's locale has no extract.
	//   3. Neither baked: keep the lazy-fetch placeholder so the existing
	//      runtime `hydrateWikipediaSnippet` path can fill it from the REST
	//      summary endpoint on first open.
	const bakedPrimary = locale === 'hr' ? poi.summary_hr : poi.summary_en;
	const bakedFallback = locale === 'hr' ? poi.summary_en : poi.summary_hr;
	const baked = bakedPrimary ?? bakedFallback;
	if (baked) {
		lines.push(`<p class="poi-popup__wiki">${escapeHtml(baked)}</p>`);
	} else if (poi.wikipedia) {
		lines.push(
			`<p class="poi-popup__wiki" data-poi-wiki="${escapeHtml(poi.id)}">${escapeHtml(labels.wikipediaLoading)}</p>`,
		);
	}
	// Provenance footer: small grey line at the bottom telling the user where
	// the data came from and when it was last touched. Only rendered when the
	// dataset actually carries `source` (legacy entries from before Phase 4
	// just don't show it).
	if (poi.source) {
		const sourceLabel = provenanceLabel(poi.source, labels);
		const verified = poi.lastVerified
			? ` · ${escapeHtml(labels.lastVerifiedLabel)} ${escapeHtml(formatIsoDate(poi.lastVerified, locale))}`
			: '';
		lines.push(`<p class="poi-popup__provenance">${escapeHtml(sourceLabel)}${verified}</p>`);
	}
	return lines.join('');
}

/** Builds the action row: star, "Open in Maps", and "Share link" buttons.
 *  Each button is wired imperatively in PoiMarkers after the popup opens
 *  because the popup HTML is parsed into a detached subtree before mount.
 *  The caller reads `starredPoiIds` from the store at popup-open time and
 *  passes `isStarred` directly so this function stays a pure string factory. */
export function buildActionsHtml(poi: Poi, labels: PopupBuildLabels, isStarred: boolean): string {
	const starAria = isStarred ? labels.starRemoveLabel : labels.starAddLabel;
	return (
		`<div class="poi-popup__actions">` +
		`<button type="button" class="poi-popup__star" data-poi-star="${escapeHtml(poi.id)}" aria-pressed="${isStarred ? 'true' : 'false'}" aria-label="${escapeHtml(starAria)}" title="${escapeHtml(starAria)}">${isStarred ? '★' : '☆'}</button>` +
		`<button type="button" class="poi-popup__open-maps" data-poi-open-maps="${escapeHtml(poi.id)}">${escapeHtml(labels.openInMaps)}</button>` +
		`<button type="button" class="poi-popup__share" data-poi-share="${escapeHtml(poi.id)}">${escapeHtml(labels.shareLink)}</button>` +
		`</div>`
	);
}

/**
 * Builds the inner HTML of the POI popup using the shared `.map-tooltip`
 * styling (same vocabulary as the trail-point tooltip / severe-weather
 * banner / seasonal-status modal). Direction-aware: the trail-km label is
 * mirrored to NOBO when that direction is active. Unit-aware: trail-km and
 * off-trail distance are converted to mi when `units === 'imperial'`.
 */
export function buildPopupHtml(poi: Poi, displayName: string, typeLabel: string, args: PopupBuildArgs): string {
	const { direction, units, totalKm, distancePrecision, labels, isStarred } = args;
	const soboKm = poi.trailKm;
	const directionAdjustedKm = direction === 'SOBO' ? soboKm : Math.max(0, totalKm - soboKm);
	// Both `trailKm` and `distanceFromTrailKm` are already kilometres in the
	// POI dataset, so do NOT pass `needsConversion: true` (that flag is for
	// inputs in metres and would divide by 1000 - which is why off-trail POIs
	// were rendering as "Off trail: 0.0 km" and trail positions were
	// shrinking from e.g. 330 km to "0.33 km").
	const trailDistanceLabel = formatDistance(directionAdjustedKm, units, distancePrecision);
	const onTrail = poi.distanceFromTrailKm < 0.5;
	// Only computed when off-trail; null makes the unused-when-on-trail state
	// explicit and avoids a dead empty-string path.
	const offTrailLabel = onTrail ? null : formatDistance(poi.distanceFromTrailKm, units, 1);

	// No outer wrapper - content goes directly into Leaflet's
	// `.leaflet-popup-content`. The previous `.map-tooltip__inner` wrapper
	// added a redundant DOM level that, combined with the default Leaflet
	// content-wrapper chrome, made the popup look nested-card-in-card.
	return (
		buildGalleryHtml(poi, displayName, labels) +
		`<h3 class="poi-popup__title">${escapeHtml(displayName)} <span class="poi-popup__type">(${escapeHtml(typeLabel)})</span></h3>` +
		buildMetaRowsHtml(poi, args, trailDistanceLabel, onTrail, offTrailLabel) +
		buildActionsHtml(poi, labels, isStarred)
	);
}

/** Map the schema enum to a localised, human-readable source label. */
function provenanceLabel(
	source: NonNullable<Poi['source']>,
	labels: { sourceOsm: string; sourceWikidata: string; sourceHps: string; sourceCurated: string },
): string {
	switch (source) {
		case 'osm':
			return labels.sourceOsm;
		case 'wikidata':
			return labels.sourceWikidata;
		case 'hps':
			return labels.sourceHps;
		case 'curated':
			return labels.sourceCurated;
	}
}
