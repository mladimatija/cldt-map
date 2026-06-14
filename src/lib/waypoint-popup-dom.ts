/**
 * DOM helpers for personal waypoint popups (category chip picker).
 */

import {
	normalizeWaypointCategory,
	WAYPOINT_CATEGORIES,
	waypointCategoryPinColor,
	type WaypointCategoryId,
} from './waypoint-categories';

/** Horizontal category chip row; returns the current selection via getSelected(). */
export function appendWaypointCategoryChips(
	container: HTMLElement,
	selected: WaypointCategoryId,
	headingText: string,
	categoryLabel: (id: WaypointCategoryId) => string,
): { getSelected: () => WaypointCategoryId } {
	const heading = document.createElement('p');
	heading.className = 'poi-popup__row poi-popup__row--muted waypoint-category-chips__heading';
	heading.textContent = headingText;

	const row = document.createElement('div');
	row.className = 'waypoint-category-chips';
	row.setAttribute('role', 'radiogroup');
	row.setAttribute('aria-label', headingText);

	let current = normalizeWaypointCategory(selected);

	const syncActive = (): void => {
		for (const btn of row.querySelectorAll<HTMLButtonElement>('[data-waypoint-category]')) {
			const id = normalizeWaypointCategory(btn.dataset.waypointCategory);
			const active = id === current;
			btn.classList.toggle('waypoint-category-chip--active', active);
			btn.setAttribute('aria-checked', active ? 'true' : 'false');
		}
	};

	for (const cat of WAYPOINT_CATEGORIES) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'waypoint-category-chip';
		btn.dataset.waypointCategory = cat.id;
		btn.setAttribute('role', 'radio');
		btn.setAttribute('aria-label', categoryLabel(cat.id));
		btn.title = categoryLabel(cat.id);

		const dot = document.createElement('span');
		dot.className = 'waypoint-category-chip__dot';
		dot.style.backgroundColor = waypointCategoryPinColor(cat.id);
		dot.setAttribute('aria-hidden', 'true');

		const label = document.createElement('span');
		label.className = 'waypoint-category-chip__label';
		label.textContent = categoryLabel(cat.id);

		btn.append(dot, label);
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			current = cat.id;
			syncActive();
		});
		row.append(btn);
	}

	syncActive();
	container.append(heading, row);

	return {
		getSelected: () => current,
	};
}
