'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
	children: React.ReactNode;
	content: React.ReactNode;
	/** Native title fallback when the custom tooltip is not visible */
	title?: string;
	position?: 'top' | 'right' | 'bottom' | 'left';
	offset?: number;
	delay?: number;
}

const TOOLTIP_Z_INDEX = 9999;

export function Tooltip({
	children,
	content,
	title,
	position = 'left',
	offset = 8,
	delay = 300,
}: TooltipProps): React.ReactElement {
	const [showTooltip, setShowTooltip] = useState(false);
	const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({
		position: 'fixed',
		left: '-9999px',
		top: 0,
		zIndex: TOOLTIP_Z_INDEX,
	});
	const [tooltipReady, setTooltipReady] = useState(false);
	const childRef = useRef<HTMLDivElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	const retryCountRef = useRef(0);
	const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

	// Calculate and set the tooltip position when it becomes visible.
	// Use double rAF to wait for layout: first rAF = DOM committed, second = layout complete.
	useEffect(() => {
		if (!showTooltip || !childRef.current || !tooltipRef.current) {
			queueMicrotask(() => setTooltipReady(false));
			return;
		}

		let cancelled = false;
		retryCountRef.current = 0;

		const positionTooltip = (): void => {
			if (cancelled || !childRef.current || !tooltipRef.current) {
				return;
			}

			const childRect = childRef.current.getBoundingClientRect();
			const tooltipRect = tooltipRef.current.getBoundingClientRect();

			// Skip if the tooltip has no dimensions yet (layout not complete)
			if (tooltipRect.width === 0 && tooltipRect.height === 0) {
				if (retryCountRef.current < 5) {
					retryCountRef.current += 1;
					requestAnimationFrame(positionTooltip);
				}
				return;
			}
			retryCountRef.current = 0;

			let top, left;

			switch (position) {
				case 'top':
					top = childRect.top - tooltipRect.height - offset;
					left = childRect.left + childRect.width / 2 - tooltipRect.width / 2;
					break;
				case 'right':
					top = childRect.top + childRect.height / 2 - tooltipRect.height / 2;
					left = childRect.right + offset;
					break;
				case 'bottom':
					top = childRect.bottom + offset;
					left = childRect.left + childRect.width / 2 - tooltipRect.width / 2;
					break;
				case 'left':
				default:
					top = childRect.top + childRect.height / 2 - tooltipRect.height / 2;
					left = childRect.left - tooltipRect.width - offset;
					break;
			}

			// Ensure the tooltip stays within the viewport
			const rightEdge = left + tooltipRect.width;
			const bottomEdge = top + tooltipRect.height;

			if (rightEdge > window.innerWidth) {
				left = window.innerWidth - tooltipRect.width - 5;
			}

			if (bottomEdge > window.innerHeight) {
				top = window.innerHeight - tooltipRect.height - 5;
			}

			if (top < 0) {
				top = 5;
			}

			if (left < 0) {
				left = 5;
			}

			setTooltipStyle({
				position: 'fixed',
				top: `${top}px`,
				left: `${left}px`,
				zIndex: TOOLTIP_Z_INDEX,
			});
			setTooltipReady(true);
		};

		// Wait for layout before measuring
		requestAnimationFrame(() => {
			if (cancelled) {
				return;
			}
			requestAnimationFrame(positionTooltip);
		});

		return () => {
			cancelled = true;
		};
	}, [showTooltip, position, offset]);

	// Handle tooltip visibility with delay
	const showTimer = useRef<NodeJS.Timeout | null>(null);

	const scheduleHide = (): void => {
		if (hideTimerRef.current) {
			clearTimeout(hideTimerRef.current);
		}
		hideTimerRef.current = setTimeout(() => {
			hideTimerRef.current = null;
			setShowTooltip(false);
			setTooltipReady(false);
		}, 100);
	};

	const cancelHide = (): void => {
		if (hideTimerRef.current) {
			clearTimeout(hideTimerRef.current);
			hideTimerRef.current = null;
		}
	};

	const handleShowTooltip = (): void => {
		cancelHide();
		if (showTimer.current) {
			clearTimeout(showTimer.current);
		}
		showTimer.current = setTimeout(() => {
			showTimer.current = null;
			setShowTooltip(true);
		}, delay);
	};

	const handleHideTooltip = (): void => {
		if (showTimer.current) {
			clearTimeout(showTimer.current);
			showTimer.current = null;
		}
		scheduleHide();
	};

	// Clean up timeouts on unmounting
	useEffect(
		() => () => {
			if (showTimer.current) {
				clearTimeout(showTimer.current);
			}
			if (hideTimerRef.current) {
				clearTimeout(hideTimerRef.current);
			}
		},
		[],
	);

	// Native title as fallback when the custom tooltip is not visible (e.g., before delay, or when custom fails)
	const fallbackTitle = title && !showTooltip ? title : undefined;

	const tooltipContent = showTooltip && (
		<div
			className={`map-tooltip map-tooltip--control pointer-events-auto fixed ${tooltipReady ? 'opacity-100' : 'opacity-0'}`}
			ref={tooltipRef}
			role="tooltip"
			style={tooltipStyle}
			onMouseEnter={cancelHide}
			onMouseLeave={scheduleHide}
		>
			<div className="font-normal">{content}</div>

			{/* Arrow for the tooltip based on position - hidden to match the Trail Information tooltip */}
			<div
				className={`hidden ${
					position === 'top'
						? 'bottom-[-4px] left-1/2 -ml-1'
						: position === 'right'
							? 'top-1/2 left-[-4px] -mt-1'
							: position === 'bottom'
								? 'top-[-4px] left-1/2 -ml-1'
								: 'top-1/2 right-[-4px] -mt-1'
				} `}
			/>
		</div>
	);

	return (
		<div
			className="relative inline-block"
			ref={childRef}
			title={fallbackTitle}
			onBlur={handleHideTooltip}
			onFocus={handleShowTooltip}
			onMouseEnter={handleShowTooltip}
			onMouseLeave={handleHideTooltip}
		>
			{children}

			{typeof document !== 'undefined' && createPortal(tooltipContent, document.body)}
		</div>
	);
}
