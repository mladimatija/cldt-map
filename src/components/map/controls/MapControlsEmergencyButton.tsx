'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import SmartTooltip from '@/components/ui/SmartTooltip';

const LONG_PRESS_MS = 700;
const TAP_HINT_MS = 1500;
const MOVEMENT_CANCEL_PX = 8;

interface MapControlsEmergencyButtonProps {
	onOpen: () => void;
	expanded: boolean;
}

export function MapControlsEmergencyButton({ onOpen, expanded }: MapControlsEmergencyButtonProps): React.ReactElement {
	const t = useTranslations('emergency');
	const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const tapHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pressStartRef = useRef<{ x: number; y: number } | null>(null);
	const triggeredRef = useRef(false);
	const [showTapHint, setShowTapHint] = useState(false);

	const clearLongPress = useCallback((): void => {
		if (longPressTimerRef.current !== null) {
			clearTimeout(longPressTimerRef.current);
			longPressTimerRef.current = null;
		}
	}, []);

	const showHint = useCallback((): void => {
		setShowTapHint(true);
		if (tapHintTimerRef.current !== null) clearTimeout(tapHintTimerRef.current);
		tapHintTimerRef.current = setTimeout(() => {
			setShowTapHint(false);
			tapHintTimerRef.current = null;
		}, TAP_HINT_MS);
	}, []);

	useEffect(
		() => () => {
			clearLongPress();
			if (tapHintTimerRef.current !== null) clearTimeout(tapHintTimerRef.current);
		},
		[clearLongPress],
	);

	const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
		// Ignore non-primary pointer (e.g. right-click)
		if (e.button !== 0 && e.pointerType === 'mouse') return;
		triggeredRef.current = false;
		pressStartRef.current = { x: e.clientX, y: e.clientY };
		try {
			e.currentTarget.setPointerCapture(e.pointerId);
		} catch {
			// setPointerCapture may throw in test environments; ignore
		}
		clearLongPress();
		longPressTimerRef.current = setTimeout(() => {
			triggeredRef.current = true;
			longPressTimerRef.current = null;
			onOpen();
		}, LONG_PRESS_MS);
	};

	const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>): void => {
		const start = pressStartRef.current;
		if (start === null || longPressTimerRef.current === null) return;
		const dx = e.clientX - start.x;
		const dy = e.clientY - start.y;
		if (Math.hypot(dx, dy) > MOVEMENT_CANCEL_PX) {
			clearLongPress();
			pressStartRef.current = null;
		}
	};

	const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>): void => {
		try {
			if (e.currentTarget.hasPointerCapture(e.pointerId)) {
				e.currentTarget.releasePointerCapture(e.pointerId);
			}
		} catch {
			// ignore
		}
		const wasArmed = longPressTimerRef.current !== null;
		clearLongPress();
		pressStartRef.current = null;
		if (wasArmed && !triggeredRef.current) {
			showHint();
		}
	};

	const handlePointerCancel = (): void => {
		clearLongPress();
		pressStartRef.current = null;
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onOpen();
		}
	};

	const tooltipContent = showTapHint ? t('holdToOpen') : t('buttonAriaLabel');

	return (
		<SmartTooltip content={tooltipContent} position="left">
			<button
				aria-expanded={expanded}
				aria-label={t('buttonAriaLabel')}
				className="bg-cldt-red hover:bg-cldt-red/90 focus-visible:ring-cldt-green focus-visible:ring-offset-cldt-red relative flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full text-white shadow-md transition-all outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
				data-tour="sos"
				type="button"
				onContextMenu={(e) => e.preventDefault()}
				onKeyDown={handleKeyDown}
				onPointerCancel={handlePointerCancel}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
			>
				<span aria-hidden="true" className="sos-pulse-ring" />
				<span aria-hidden="true" className="text-sm font-bold tracking-wide">
					SOS
				</span>
			</button>
		</SmartTooltip>
	);
}
