'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { IoAddOutline } from 'react-icons/io5';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { SOS_CARD_FIELDS, SOS_CARD_FIELD_MAX_LEN, type SosCard } from '@/lib/store/types';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { MAP_CONTROL_SECTION_HEADING } from './MapControlSectionCard';
import { MAP_CONTROL_INPUT, MAP_CONTROL_LINK_BUTTON, MAP_CONTROL_SECTION_DIVIDER } from './map-controls-constants';

/** Fields entered as a multi-line textarea (free text) rather than a single input. */
const MULTILINE_FIELDS = new Set<keyof SosCard>(['allergies', 'conditions', 'medications', 'notes']);

/** Phone shapes safe to turn into a tel: link (mirrors the POI popup / HGSS guard). */
const LINKABLE_PHONE_RE = /^\+?[\d\s().,-]{1,30}$/;

/** Read-only tel: link styling, matching the HGSS rescue link incl. its focus ring. */
const READONLY_LINK_CLASS =
	'text-cldt-blue hover:text-cldt-green focus-visible:text-cldt-green focus-visible:ring-cldt-green rounded outline-none focus-visible:ring-1 focus-visible:ring-offset-1';

/**
 * On-device personal/medical card for the emergency panel: optional blood type,
 * allergies, conditions, medications, an emergency contact, party size, and notes.
 * Empty by default, persisted locally, never included in share links. Renders an
 * "add" prompt when empty, a read-only card when filled, and an inline edit form.
 */
export function EmergencySosCard(): React.ReactElement {
	const t = useTranslations('emergency');
	const sosCard = useMapStore((s: MapStoreState) => s.sosCard);
	const setSosCard = useMapStore((s: MapStoreState) => s.setSosCard);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<SosCard>(sosCard);

	const hasData = SOS_CARD_FIELDS.some((field) => (sosCard[field]?.trim() ?? '') !== '');

	const startEditing = (): void => {
		setDraft(sosCard);
		setEditing(true);
	};

	const handleSave = (): void => {
		// Trim and drop empty fields so the read-only view and hasData stay clean.
		const cleaned: SosCard = {};
		for (const field of SOS_CARD_FIELDS) {
			const value = draft[field]?.trim();
			if (value) cleaned[field] = value.slice(0, SOS_CARD_FIELD_MAX_LEN);
		}
		setSosCard(cleaned);
		setEditing(false);
	};

	const updateField = (field: keyof SosCard, value: string): void => {
		setDraft((prev) => ({ ...prev, [field]: value }));
	};

	return (
		<section className={cn('flex flex-col gap-1.5', MAP_CONTROL_SECTION_DIVIDER)}>
			<div className="flex items-center justify-between gap-2">
				<h4 className={MAP_CONTROL_SECTION_HEADING}>{t('sosCard.heading')}</h4>
				{!editing && hasData && (
					<button className={MAP_CONTROL_LINK_BUTTON} type="button" onClick={startEditing}>
						{t('sosCard.edit')}
					</button>
				)}
			</div>

			{editing ? (
				<div className="flex flex-col gap-2">
					<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('sosCard.privacyNote')}</p>
					{SOS_CARD_FIELDS.map((field) => (
						<label className="flex flex-col gap-0.5 text-xs" key={field}>
							<span className="text-gray-500 dark:text-[var(--text-secondary)]">{t(`sosCard.field.${field}`)}</span>
							{MULTILINE_FIELDS.has(field) ? (
								<textarea
									className={cn(MAP_CONTROL_INPUT, 'w-full resize-y')}
									rows={2}
									value={draft[field] ?? ''}
									onChange={(e) => updateField(field, e.target.value)}
								/>
							) : (
								<input
									className={cn(MAP_CONTROL_INPUT, 'w-full')}
									type={field === 'emergencyContactPhone' ? 'tel' : 'text'}
									value={draft[field] ?? ''}
									onChange={(e) => updateField(field, e.target.value)}
								/>
							)}
						</label>
					))}
					<div className="flex justify-end gap-2">
						<Button size="sm" variant="mapControlOutlineSecondary" onClick={() => setEditing(false)}>
							{t('sosCard.cancel')}
						</Button>
						<Button size="sm" variant="mapControlOutline" onClick={handleSave}>
							{t('sosCard.save')}
						</Button>
					</div>
				</div>
			) : hasData ? (
				<dl className="m-0 flex flex-col gap-1 text-sm">
					{SOS_CARD_FIELDS.filter((field) => (sosCard[field]?.trim() ?? '') !== '').map((field) => {
						const value = sosCard[field] ?? '';
						const isLinkablePhone = field === 'emergencyContactPhone' && LINKABLE_PHONE_RE.test(value);
						return (
							<div className="flex gap-2" key={field}>
								<dt className="shrink-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
									{t(`sosCard.field.${field}`)}:
								</dt>
								<dd className="m-0 min-w-0 break-words">
									{isLinkablePhone ? (
										<a className={READONLY_LINK_CLASS} href={`tel:${value}`}>
											{value}
										</a>
									) : (
										value
									)}
								</dd>
							</div>
						);
					})}
				</dl>
			) : (
				<button className={cn(MAP_CONTROL_LINK_BUTTON, 'flex items-center gap-1')} type="button" onClick={startEditing}>
					<IoAddOutline aria-hidden className="h-3.5 w-3.5 shrink-0" />
					{t('sosCard.add')}
				</button>
			)}
		</section>
	);
}
