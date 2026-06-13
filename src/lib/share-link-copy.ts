'use client';

import { useMapStore } from '@/lib/store';
import { resolveShareUrlForCopy } from '@/lib/share-shortener-client';

/** Copy plain text with Clipboard API, then execCommand fallback. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
	try {
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		/* try fallback */
	}
	try {
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', '');
		textarea.style.position = 'absolute';
		textarea.style.left = '-9999px';
		document.body.appendChild(textarea);
		textarea.select();
		const success = document.execCommand('copy');
		document.body.removeChild(textarea);
		return success;
	} catch {
		return false;
	}
}

/** Resolve a share URL (short when possible, else long) and copy it to the clipboard. */
export async function copyShareLink(
	longUrl: string,
	options: { useShortLinks: boolean; online: boolean },
): Promise<{ ok: boolean; short: boolean }> {
	const { url, short } = await resolveShareUrlForCopy(longUrl, options);
	const ok = await copyTextToClipboard(url);
	return { ok, short: ok ? short : false };
}

/** Tailwind spinner (matches inline loaders elsewhere in the app). */
const SHARE_BUTTON_SPINNER_CLASS =
	'h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none';

function setShareButtonLoading(btn: HTMLButtonElement, loading: boolean, label: string): void {
	if (loading) {
		btn.disabled = true;
		btn.setAttribute('aria-busy', 'true');
		btn.classList.add('relative', 'justify-center');
		btn.replaceChildren();
		const sizeAnchor = document.createElement('span');
		sizeAnchor.className = 'invisible select-none';
		sizeAnchor.textContent = label;
		sizeAnchor.setAttribute('aria-hidden', 'true');
		const spinner = document.createElement('span');
		spinner.className = `${SHARE_BUTTON_SPINNER_CLASS} absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2`;
		spinner.setAttribute('aria-hidden', 'true');
		btn.append(sizeAnchor, spinner);
		return;
	}
	btn.disabled = false;
	btn.removeAttribute('aria-busy');
	btn.classList.remove('relative', 'justify-center');
	btn.textContent = label;
}

/**
 * Wire a popup "Share link" button: centered spinner while busy (label kept
 * invisible so the button does not resize), resolve short/long URL, copy, and
 * surface success/error in the app-level toast chip.
 */
export function wirePopupShareButton(btn: HTMLButtonElement, getLongUrl: () => string, shareLinkLabel: string): void {
	if (btn.dataset.wired === '1') return;
	btn.dataset.wired = '1';
	btn.classList.add('inline-flex', 'items-center', 'gap-1', 'disabled:opacity-65', 'disabled:cursor-wait');

	btn.addEventListener('click', (e) => {
		e.preventDefault();
		if (btn.disabled) return;

		setShareButtonLoading(btn, true, shareLinkLabel);

		void (async () => {
			try {
				const state = useMapStore.getState();
				const { ok, short } = await copyShareLink(getLongUrl(), {
					useShortLinks: state.shareShortLinks,
					online: typeof navigator !== 'undefined' ? navigator.onLine : false,
				});
				state.showShareCopyToast({ status: ok ? 'success' : 'error', short: ok ? short : false });
			} finally {
				setShareButtonLoading(btn, false, shareLinkLabel);
			}
		})();
	});
}
