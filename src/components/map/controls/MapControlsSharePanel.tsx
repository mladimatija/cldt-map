'use client';

import React, { type RefObject } from 'react';

interface MapControlsSharePanelProps {
	sharePopupRef: RefObject<HTMLDivElement | null>;
	getShareViewUrl: () => string;
	getShareProgressUrl: () => string | null;
	copyToClipboard: (url: string, withText?: boolean) => void;
	onClose: () => void;
}

/** Share popup: copy the link (view or progress) and cancel. */
export function MapControlsSharePanel({
	sharePopupRef,
	getShareViewUrl,
	getShareProgressUrl,
	copyToClipboard,
	onClose,
}: MapControlsSharePanelProps): React.ReactElement {
	const progressUrl = getShareProgressUrl();
	return (
		<div
			className="z-modal absolute top-20 right-12 rounded-md border border-gray-200 bg-white p-4 shadow-md dark:border-gray-600 dark:bg-gray-800"
			ref={sharePopupRef}
		>
			<h3 className="mb-2 text-lg font-semibold text-gray-800 dark:text-gray-100">Share this map</h3>
			<div className="flex flex-col gap-2">
				<button
					className="bg-cldt-blue hover:bg-cldt-green focus-visible:bg-cldt-green rounded-md px-4 py-2 text-white outline-none"
					type="button"
					onClick={() => copyToClipboard(getShareViewUrl(), true)}
				>
					Copy link (current view)
				</button>
				{progressUrl && (
					<button
						className="bg-cldt-blue hover:bg-cldt-green focus-visible:bg-cldt-green rounded-md px-4 py-2 text-white outline-none"
						type="button"
						onClick={() => copyToClipboard(progressUrl, true)}
					>
						Copy link (with progress)
					</button>
				)}
				<button
					className="rounded-md bg-gray-200 px-4 py-2 outline-none hover:bg-gray-300 focus-visible:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500"
					type="button"
					onClick={onClose}
				>
					Cancel
				</button>
			</div>
		</div>
	);
}
