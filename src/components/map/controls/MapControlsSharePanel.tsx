'use client';

import React, { useEffect, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { MAP_CONTROL_POPOVER } from './map-controls-constants';
import { Button } from '@/components/ui/Button';

interface MapControlsSharePanelProps {
	sharePopupRef: RefObject<HTMLDivElement | null>;
	getShareUrl: () => string;
	copyToClipboard: (url: string, withText?: boolean) => void;
	onClose: () => void;
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Share popup: copy the link (progress on trail) and cancel. Dialog with focus trap and Escape to close (handled by parent). */
export function MapControlsSharePanel({
	sharePopupRef,
	getShareUrl,
	copyToClipboard,
	onClose,
}: MapControlsSharePanelProps): React.ReactElement {
	const t = useTranslations('mapControls');

	// Focus first focusable on open and trap Tab/Shift+Tab inside the dialog
	useEffect(() => {
		const el = sharePopupRef.current;
		if (!el) return;
		const focusables = el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		first?.focus();

		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key !== 'Tab') return;
			if (focusables.length === 0) return;
			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault();
					last?.focus();
				}
			} else {
				if (document.activeElement === last) {
					e.preventDefault();
					first?.focus();
				}
			}
		};
		el.addEventListener('keydown', handleKeyDown);
		return () => el.removeEventListener('keydown', handleKeyDown);
	}, [sharePopupRef]);

	return (
		<div
			aria-labelledby="share-panel-title"
			aria-modal="true"
			className={`z-controls-popover absolute top-1/2 right-[calc(100%+0.5rem)] flex w-52 -translate-y-1/2 flex-col gap-2 ${MAP_CONTROL_POPOVER}`}
			ref={sharePopupRef}
			role="dialog"
			onContextMenu={(e) => e.preventDefault()}
		>
			<h3 className="text-sm font-medium text-gray-700 dark:text-gray-200" id="share-panel-title">
				{t('shareTitle')}
			</h3>
			<div className="flex flex-col gap-2">
				<Button variant="mapControlOutline" onClick={() => copyToClipboard(getShareUrl(), true)}>
					{t('copyLink')}
				</Button>
				<Button variant="mapControlOutlineSecondary" onClick={onClose}>
					{t('cancel')}
				</Button>
			</div>
		</div>
	);
}
