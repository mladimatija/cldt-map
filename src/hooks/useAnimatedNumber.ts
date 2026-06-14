'use client';

import { useEffect, useRef, useState } from 'react';

const DEFAULT_DURATION_MS = 150;

function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Smoothly interpolates a numeric display value toward `target`.
 * Skips animation when the user prefers reduced motion.
 */
export function useAnimatedNumber(target: number, duration = DEFAULT_DURATION_MS): number {
	const [display, setDisplay] = useState(target);
	const displayRef = useRef(target);

	useEffect(() => {
		if (prefersReducedMotion()) {
			displayRef.current = target;
			return;
		}

		const from = displayRef.current;
		if (Math.abs(from - target) < 0.0001) {
			displayRef.current = target;
			return;
		}

		const start = performance.now();
		let raf = 0;

		const tick = (now: number): void => {
			const t = Math.min(1, (now - start) / duration);
			const eased = 1 - (1 - t) ** 3;
			const next = from + (target - from) * eased;
			displayRef.current = next;
			setDisplay(next);
			if (t < 1) {
				raf = requestAnimationFrame(tick);
			} else {
				displayRef.current = target;
			}
		};

		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [target, duration]);

	if (prefersReducedMotion()) return target;
	return display;
}
