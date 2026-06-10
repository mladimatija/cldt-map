'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { loadNotices, resolveLocalized, type TrailNotice, type NoticeSeverity } from '@/lib/notices';
import { isSafeUrl } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { BANNER_REGION_CLASSES, BANNER_ROW_CLASSES, BANNER_RED_CLASSES } from './banner-styles';

const DISMISSED_KEY = 'cldt-dismissed-notices';

function getDismissed(): Set<string> {
	try {
		const raw = sessionStorage.getItem(DISMISSED_KEY);
		return new Set(raw ? (JSON.parse(raw) as string[]) : []);
	} catch {
		return new Set();
	}
}

function persistDismissed(id: string): void {
	try {
		const set = getDismissed();
		set.add(id);
		sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
	} catch {
		// sessionStorage unavailable - dismiss is in-memory only
	}
}

const SEVERITY_CLASSES: Record<NoticeSeverity, string> = {
	emergency: BANNER_RED_CLASSES,
	closure: 'bg-cldt-red/90 text-white',
	warning: 'bg-amber-400 text-amber-900',
	info: 'bg-cldt-blue text-white',
};

function canDismiss(notice: TrailNotice): boolean {
	return notice.dismissible && notice.severity !== 'emergency' && notice.severity !== 'closure';
}

export function TrailNoticesBanner(): React.ReactElement | null {
	const t = useTranslations('trailNotices');
	const locale = useLocale();
	const [notices, setNotices] = useState<TrailNotice[]>([]);
	const [dismissed, setDismissed] = useState<Set<string>>(new Set());

	useEffect(() => {
		const dismissed = getDismissed();
		queueMicrotask(() => setDismissed(dismissed));
		void loadNotices().then((notices) => queueMicrotask(() => setNotices(notices)));
	}, []);

	const visible = notices.filter((n) => !dismissed.has(n.id));
	if (visible.length === 0) return null;

	const handleDismiss = (id: string): void => {
		persistDismissed(id);
		setDismissed((prev) => new Set([...prev, id]));
	};

	return (
		<div aria-label={t('regionLabel')} className={BANNER_REGION_CLASSES} role="region">
			{visible.map((n) => (
				<div className={`${BANNER_ROW_CLASSES} ${SEVERITY_CLASSES[n.severity]}`} key={n.id} role="alert">
					<div className="min-w-0 flex-1">
						<span className="font-semibold">{resolveLocalized(n.title, locale)}</span>
						{n.message && <span className="ml-2">{resolveLocalized(n.message, locale)}</span>}
						{isSafeUrl(n.url) && (
							<a className="ml-2 text-white underline" href={n.url} rel="noopener noreferrer" target="_blank">
								{t('moreInfo')}
							</a>
						)}
					</div>
					{canDismiss(n) && (
						<Button aria-label={t('dismissLabel')} variant="bannerClose" onClick={() => handleDismiss(n.id)}>
							×
						</Button>
					)}
				</div>
			))}
		</div>
	);
}
