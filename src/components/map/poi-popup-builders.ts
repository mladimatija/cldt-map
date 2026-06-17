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
import { WATER_STATUS_OPTIONS, type WaterLogEntry, type WaterStatus } from '@/lib/water-log';
import { POI_NOTE_MAX_LENGTH } from '@/lib/poi-notes';

export interface PopupBuildArgs {
	direction: TrailDirection;
	units: UnitSystem;
	totalKm: number;
	distancePrecision: number;
	locale: string;
	labels: PopupBuildLabels;
	isStarred: boolean;
	/** Personal water-status observation for this POI (water type only). */
	waterLog?: WaterLogEntry;
	/** Curator email for the "Report an issue" link; empty/unset hides it. */
	reportEmail?: string;
	/** Today's date (YYYY-MM-DD) stamped into the report mail body. */
	today?: string;
	/** The hiker's personal on-device note for this POI, if any. */
	poiNote?: string;
}

/** Labels for the personal water-status log block. Subset of PopupBuildLabels
 *  so the marker layer can re-render the block on its own after a click. */
export interface WaterLogPopupLabels {
	waterLogPrompt: string;
	waterLogYouFound: string;
	waterLogFlowing: string;
	waterLogLow: string;
	waterLogDry: string;
	waterLogClearLabel: string;
}

/** Labels for the personal POI note block. Subset of PopupBuildLabels so the
 *  marker layer can re-render the block in place across view/edit states. */
export interface PoiNotePopupLabels {
	noteAdd: string;
	noteEdit: string;
	noteClear: string;
	noteSave: string;
	noteCancel: string;
	notePlaceholder: string;
	noteAriaLabel: string;
}

export interface PopupBuildLabels extends WaterLogPopupLabels, PoiNotePopupLabels {
	distanceLabel: string;
	offTrailLabel: string;
	elevationLabel: string;
	phoneLabel: string;
	capacityLabel: string;
	seasonLabel: string;
	operatorLabel: string;
	reservationLabel: string;
	feeLabel: string;
	wifiLabel: string;
	populationLabel: string;
	wikipediaLoading: string;
	wikipediaSource: string;
	shareLink: string;
	shareCopied: string;
	shareCopiedShort: string;
	shareFailed: string;
	openInMaps: string;
	addAsWaypoint: string;
	navigateHere: string;
	publicTransportEscape: string;
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
	// Personal water-status log labels are inherited from WaterLogPopupLabels so
	// the marker layer can re-render that block with the same subset of labels.
	/** Resupply section heading + per-kind labels + empty/verify hints. */
	resupplyHeading: string;
	resupplyNone: string;
	resupplyVerify: string;
	resupplyKinds: Record<'grocery' | 'bakery' | 'pharmacy' | 'atm' | 'post' | 'bus' | 'fuel', string>;
	resupplyMore: string;
	/** "Report an issue" link text. */
	reportAction: string;
	/** Mail subject template; substitutes {name}. */
	reportSubject: string;
	/** Mail body template; substitutes {name}, {id}, {coords}, {date}. */
	reportBody: string;
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

function waterStatusLabel(status: WaterStatus, labels: WaterLogPopupLabels): string {
	return status === 'flowing' ? labels.waterLogFlowing : status === 'low' ? labels.waterLogLow : labels.waterLogDry;
}

/** Builds the inner HTML of the personal water-status log block: the user's
 *  own observation line (when present) plus the Flowing / Low / Dry logging
 *  buttons. Re-rendered in place by the marker layer after each click, so it
 *  is kept as a standalone pure builder. */
export function buildWaterLogInnerHtml(
	entry: WaterLogEntry | undefined,
	labels: WaterLogPopupLabels,
	locale: string,
): string {
	const lines: string[] = [];
	if (entry) {
		lines.push(
			`<p class="poi-popup__row poi-popup__water-log-mine">` +
				`<span class="poi-popup__row--muted">${escapeHtml(labels.waterLogYouFound)}</span>` +
				` <span class="poi-popup__water poi-popup__water--log-${entry.status}">${escapeHtml(waterStatusLabel(entry.status, labels))}</span>` +
				` <span class="poi-popup__row--muted">${escapeHtml(formatIsoDate(entry.date, locale))}</span>` +
				` <button type="button" class="poi-popup__water-log-clear" data-poi-water-log-clear aria-label="${escapeHtml(labels.waterLogClearLabel)}" title="${escapeHtml(labels.waterLogClearLabel)}">&times;</button>` +
				`</p>`,
		);
	}
	const buttons = WATER_STATUS_OPTIONS.map((s) => {
		const active = entry?.status === s;
		return (
			`<button type="button" class="poi-popup__water-log-btn poi-popup__water-log-btn--${s}${active ? ' poi-popup__water-log-btn--active' : ''}"` +
			` data-water-status="${s}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(waterStatusLabel(s, labels))}</button>`
		);
	}).join('');
	lines.push(
		`<p class="poi-popup__row poi-popup__row--muted poi-popup__water-log-prompt">${escapeHtml(labels.waterLogPrompt)}</p>`,
		`<div class="poi-popup__water-log-actions">${buttons}</div>`,
	);
	return lines.join('');
}

/** Builds the inner HTML of the personal POI-note block across its three
 *  states: empty (an "add a note" link), view (the note text + edit/clear), and
 *  edit (a prefilled textarea + save/cancel). The marker layer re-renders this
 *  in place on each state transition, so it is a standalone pure builder. */
export function buildPoiNoteInnerHtml(note: string | undefined, editing: boolean, labels: PoiNotePopupLabels): string {
	if (editing) {
		return (
			`<textarea class="poi-popup__input poi-popup__note-input" data-poi-note-input rows="3" maxlength="${POI_NOTE_MAX_LENGTH}" placeholder="${escapeHtml(labels.notePlaceholder)}" aria-label="${escapeHtml(labels.noteAriaLabel)}">${escapeHtml(note ?? '')}</textarea>` +
			`<div class="poi-popup__note-actions">` +
			`<button type="button" class="poi-popup__open-maps" data-poi-note-action="save">${escapeHtml(labels.noteSave)}</button>` +
			`<button type="button" class="poi-popup__share" data-poi-note-action="cancel">${escapeHtml(labels.noteCancel)}</button>` +
			`</div>`
		);
	}
	if (note) {
		return (
			`<p class="poi-popup__note-text">${escapeHtml(note)}</p>` +
			`<div class="poi-popup__note-actions">` +
			`<button type="button" class="poi-popup__note-link" data-poi-note-action="edit">${escapeHtml(labels.noteEdit)}</button>` +
			`<button type="button" class="poi-popup__note-link poi-popup__note-link--danger" data-poi-note-action="clear">${escapeHtml(labels.noteClear)}</button>` +
			`</div>`
		);
	}
	return `<button type="button" class="poi-popup__note-link" data-poi-note-action="add">${escapeHtml(labels.noteAdd)}</button>`;
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
	if (poi.isReachableViaPublicTransport === true && poi.isReachable === false && poi.nearestPublicTransportM) {
		const ptDistance = formatDistance(poi.nearestPublicTransportM / 1000, units, 0);
		lines.push(
			`<p class="poi-popup__row poi-popup__row--muted">${escapeHtml(labels.publicTransportEscape.replace('{distance}', ptDistance))}</p>`,
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

	// Personal water-status log: shown for every water POI (including legacy
	// rows that predate the OSM water-intelligence pass), right below the static
	// reliability class. The marker layer wires the buttons after popup open and
	// re-renders this container in place on each click.
	if (poi.type === 'water') {
		lines.push(
			`<div class="poi-popup__water-log" data-poi-water-log="${escapeHtml(poi.id)}">${buildWaterLogInnerHtml(args.waterLog, labels, locale)}</div>`,
		);
	}

	// Resupply section (towns/settlements with enrichment data). Empty
	// places[] means the area was checked and nothing was found - say so
	// explicitly rather than rendering nothing.
	if (poi.resupply) {
		lines.push(
			`<p class="poi-popup__row"><span class="poi-popup__label">${escapeHtml(labels.resupplyHeading)}</span></p>`,
		);
		if (poi.resupply.places.length === 0) {
			lines.push(`<p class="poi-popup__row poi-popup__row--muted">${escapeHtml(labels.resupplyNone)}</p>`);
		} else {
			const shown = poi.resupply.places.slice(0, 6);
			for (const place of shown) {
				const kindLabel = labels.resupplyKinds[place.kind] ?? place.kind;
				const name = place.name ? ` ${escapeHtml(place.name)}` : '';
				const hours = place.openingHours
					? ` <span class="poi-popup__row--muted">(${escapeHtml(place.openingHours)})</span>`
					: '';
				lines.push(
					`<p class="poi-popup__row">· <span class="poi-popup__label">${escapeHtml(kindLabel)}</span>${name}${hours}</p>`,
				);
			}
			const rest = poi.resupply.places.length - shown.length;
			if (rest > 0) {
				lines.push(
					`<p class="poi-popup__row poi-popup__row--muted">${escapeHtml(labels.resupplyMore.replace('{count}', String(rest)))}</p>`,
				);
			}
			lines.push(
				`<p class="poi-popup__row poi-popup__row--muted">${escapeHtml(labels.resupplyVerify.replace('{date}', formatIsoDate(poi.resupply.updated, locale)))}</p>`,
			);
		}
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
	if (poi.hutInfo) {
		const h = poi.hutInfo;
		if (h.operator) {
			lines.push(
				`<p class="poi-popup__row"><span class="poi-popup__label">${escapeHtml(labels.operatorLabel)}</span> ${escapeHtml(h.operator)}</p>`,
			);
		}
		if (h.reservation) {
			lines.push(
				`<p class="poi-popup__row"><span class="poi-popup__label">${escapeHtml(labels.reservationLabel)}</span> ${escapeHtml(h.reservation)}</p>`,
			);
		}
		const flags: string[] = [];
		if (h.fee === 'yes') flags.push(escapeHtml(labels.feeLabel));
		if (h.internetAccess) flags.push(escapeHtml(labels.wifiLabel));
		if (flags.length > 0) {
			lines.push(`<p class="poi-popup__row">${flags.join(' &middot; ')}</p>`);
		}
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
	// Personal note (any POI type). The marker layer wires the add/edit/clear/
	// save lifecycle and re-renders this container in place across states.
	lines.push(
		`<div class="poi-popup__note" data-poi-note="${escapeHtml(poi.id)}">${buildPoiNoteInnerHtml(args.poiNote, false, labels)}</div>`,
	);
	return lines.join('');
}

/** Builds the title row with star toggle left of the POI name. */
export function buildTitleRowHtml(
	poi: Poi,
	displayName: string,
	typeLabel: string,
	labels: PopupBuildLabels,
	isStarred: boolean,
): string {
	const starAria = isStarred ? labels.starRemoveLabel : labels.starAddLabel;
	return (
		`<div class="poi-popup__title-row">` +
		`<button type="button" class="poi-popup__star" data-poi-star="${escapeHtml(poi.id)}" aria-pressed="${isStarred ? 'true' : 'false'}" aria-label="${escapeHtml(starAria)}" title="${escapeHtml(starAria)}">${isStarred ? '★' : '☆'}</button>` +
		`<h3 class="poi-popup__title">${escapeHtml(displayName)} <span class="poi-popup__type">(${escapeHtml(typeLabel)})</span></h3>` +
		`</div>`
	);
}

/** Conservative email shape for the curator report address. Restricts the
 *  local/domain charset (no `?`/`&`/`#`/space) so a misconfigured value can
 *  never inject extra mailto headers into the link. */
const REPORT_EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/** Builds the low-prominence "Report an issue" link: a `mailto:` to the curator
 *  prefilled with the place name, id, coordinates, and date, plus a free-text
 *  prompt the hiker completes in their own mail client (account-free, one-way,
 *  user-sent). Returns an empty string when no valid curator email is set. */
export function buildReportLinkHtml(poi: Poi, displayName: string, args: PopupBuildArgs): string {
	const email = args.reportEmail?.trim();
	if (!email || !REPORT_EMAIL_RE.test(email)) return '';
	const { labels } = args;
	// Replacer-function substitution (literal, all occurrences): a POI name or
	// id containing a `$` cannot trigger String.replace's `$`-pattern handling,
	// and a locale that repeats a token still gets every copy filled.
	const tokens: Record<string, string> = {
		name: displayName,
		id: poi.id,
		coords: `${poi.lat.toFixed(5)}, ${poi.lng.toFixed(5)}`,
		date: args.today ?? '',
	};
	const fill = (template: string): string =>
		template.replace(/\{(name|id|coords|date)\}/g, (_, key: string) => tokens[key]);
	const subject = fill(labels.reportSubject);
	const body = fill(labels.reportBody);
	const href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
	return (
		`<p class="poi-popup__report-row">` +
		`<a class="poi-popup__report" href="${escapeHtml(href)}">${escapeHtml(labels.reportAction)}</a>` +
		`</p>`
	);
}

/** Builds the action rows: Open in Maps + Share on the first line, Add as
 *  waypoint centred on the second. Buttons are wired imperatively in
 *  PoiMarkers after the popup opens. */
export function buildActionsHtml(poi: Poi, labels: PopupBuildLabels): string {
	return (
		`<div class="poi-popup__actions poi-popup__actions--poi">` +
		`<button type="button" class="poi-popup__open-maps" data-poi-open-maps="${escapeHtml(poi.id)}">${escapeHtml(labels.openInMaps)}</button>` +
		`<button type="button" class="poi-popup__share" data-poi-share="${escapeHtml(poi.id)}">${escapeHtml(labels.shareLink)}</button>` +
		`<button type="button" class="poi-popup__share poi-popup__add-waypoint" data-poi-add-waypoint="${escapeHtml(poi.id)}">${escapeHtml(labels.addAsWaypoint)}</button>` +
		`<button type="button" class="poi-popup__share poi-popup__nav-target" data-poi-nav-target="${escapeHtml(poi.id)}">${escapeHtml(labels.navigateHere)}</button>` +
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
		buildTitleRowHtml(poi, displayName, typeLabel, labels, isStarred) +
		buildMetaRowsHtml(poi, args, trailDistanceLabel, onTrail, offTrailLabel) +
		buildActionsHtml(poi, labels) +
		buildReportLinkHtml(poi, displayName, args)
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
