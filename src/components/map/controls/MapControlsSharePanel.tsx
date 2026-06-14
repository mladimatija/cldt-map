'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { resolveShareUrlForCopy } from '@/lib/share-shortener-client';
import { usePopoverFocusTrap } from '@/hooks';
import { MAP_CONTROL_POPOVER } from './map-controls-constants';

const ShareQrLoader: React.FC<{ label?: string }> = ({ label }) => (
	<div
		className="flex h-[200px] w-[200px] items-center justify-center"
		{...(label ? { 'aria-label': label, role: 'status' as const } : { 'aria-hidden': true })}
	>
		<div
			aria-hidden
			className="border-t-cldt-blue h-10 w-10 animate-spin rounded-full border-4 border-gray-200 motion-reduce:animate-none dark:border-[var(--border-color)]"
		/>
	</div>
);

const QRCode = dynamic(() => import('react-qr-code'), {
	ssr: false,
	loading: () => <ShareQrLoader />,
});

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
	const tCommon = useTranslations('common');
	const loadingLabel = tCommon('loading');
	const popoverRef = usePopoverFocusTrap(true);
	const snapshotUrlRef = useRef(longUrl);
	const [displayUrl, setDisplayUrl] = useState<string | null>(null);
	const [isShort, setIsShort] = useState(false);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		void resolveShareUrlForCopy(snapshotUrlRef.current, {
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
		// Resolve once per panel mount; parent snapshots longUrl when the panel opens.
	}, [useShortLinks]);

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
			<div
				aria-busy={loading || !displayUrl}
				className="flex justify-center rounded-md border border-gray-100 bg-white p-3 dark:border-[var(--border-color)]"
			>
				{loading || !displayUrl ? (
					<ShareQrLoader label={loadingLabel} />
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
