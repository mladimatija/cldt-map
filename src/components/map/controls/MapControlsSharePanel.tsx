'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { resolveShareUrlForCopy } from '@/lib/share-shortener-client';
import { usePopoverFocusTrap } from '@/hooks';
import { MAP_CONTROL_POPOVER } from './map-controls-constants';

const QRCode = dynamic(() => import('react-qr-code'), { ssr: false });

interface MapControlsSharePanelProps {
	longUrl: string;
	useShortLinks: boolean;
	onCopy: (finalUrl: string, short: boolean) => void;
	onClose: () => void;
}

/** Share popover: QR code for the current map link plus copy-to-clipboard. */
export function MapControlsSharePanel({
	longUrl,
	useShortLinks,
	onCopy,
	onClose,
}: MapControlsSharePanelProps): React.ReactElement {
	const t = useTranslations('mapControls');
	const popoverRef = usePopoverFocusTrap(true);
	const [displayUrl, setDisplayUrl] = useState<string | null>(null);
	const [isShort, setIsShort] = useState(false);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		void resolveShareUrlForCopy(longUrl, {
			useShortLinks,
			online: typeof navigator !== 'undefined' ? navigator.onLine : false,
		}).then(({ url, short }) => {
			if (cancelled) return;
			setDisplayUrl(url);
			setIsShort(short);
			setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [longUrl, useShortLinks]);

	return (
		<div
			aria-labelledby="share-panel-title"
			aria-modal="true"
			className={`z-controls-popover fixed top-2 right-16 flex w-80 flex-col gap-3 ${MAP_CONTROL_POPOVER}`}
			ref={popoverRef}
			role="dialog"
			onContextMenu={(e) => e.preventDefault()}
		>
			<h3 className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]" id="share-panel-title">
				{t('shareTitle')}
			</h3>
			<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('shareQrHint')}</p>
			<div className="flex justify-center rounded-md border border-gray-100 bg-white p-3 dark:border-[var(--border-color)]">
				{loading || !displayUrl ? (
					<div
						aria-hidden
						className="h-[200px] w-[200px] animate-pulse rounded bg-gray-100 dark:bg-[var(--bg-primary)]"
					/>
				) : (
					<div aria-label={t('shareQrLabel')} role="img">
						<QRCode level="M" size={200} value={displayUrl} />
					</div>
				)}
			</div>
			{displayUrl && !loading && isShort ? (
				<p className="m-0 text-xs break-all text-gray-600 dark:text-[var(--text-secondary)]">{displayUrl}</p>
			) : null}
			{displayUrl && !loading && !isShort ? (
				<p className="m-0 text-[10px] leading-snug text-gray-500 dark:text-[var(--text-secondary)]">
					{t('shareQrLongFallback')}
				</p>
			) : null}
			{isShort && !loading ? (
				<p className="m-0 text-[10px] text-gray-500 dark:text-[var(--text-secondary)]">{t('shareQrShortNote')}</p>
			) : null}
			<div className="flex flex-col gap-2">
				<Button
					disabled={!displayUrl || loading}
					variant="mapControlOutline"
					onClick={() => onCopy(displayUrl!, isShort)}
				>
					{t('copyLink')}
				</Button>
				<Button aria-label={t('shareHide')} variant="mapControlOutlineSecondary" onClick={onClose}>
					{t('cancel')}
				</Button>
			</div>
		</div>
	);
}
