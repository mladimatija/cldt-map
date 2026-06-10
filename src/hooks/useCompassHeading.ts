'use client';

/**
 * Device compass heading for the user-location marker.
 *
 * Listens to `deviceorientationabsolute` (Chromium / Android: absolute alpha,
 * compass heading = 360 - alpha) with a fallback to `deviceorientation` for
 * iOS Safari, which exposes the calibrated `webkitCompassHeading` instead.
 * Updates are coalesced through requestAnimationFrame so a 60 Hz sensor
 * cannot flood React with renders.
 *
 * iOS additionally gates orientation events behind a permission prompt that
 * must be triggered from a user gesture; call `requestCompassPermission()`
 * from the toggle's event handler before enabling the hook.
 */
import { useEffect, useState } from 'react';

interface IosDeviceOrientationEvent extends DeviceOrientationEvent {
	webkitCompassHeading?: number;
}

interface IosDeviceOrientationEventCtor {
	requestPermission?: () => Promise<'granted' | 'denied'>;
}

/**
 * Requests iOS orientation permission. Resolves true when events may flow
 * (granted, or no permission gate exists on this platform). Must be invoked
 * from a user-gesture handler on iOS or Safari rejects silently.
 */
export async function requestCompassPermission(): Promise<boolean> {
	if (typeof DeviceOrientationEvent === 'undefined') return false;
	const ctor = DeviceOrientationEvent as unknown as IosDeviceOrientationEventCtor;
	if (typeof ctor.requestPermission !== 'function') return true;
	try {
		return (await ctor.requestPermission()) === 'granted';
	} catch {
		return false;
	}
}

/** Current compass heading in degrees (0 = north, clockwise), or null when
 *  disabled / unsupported / no reading yet. */
export function useCompassHeading(enabled: boolean): number | null {
	const [heading, setHeading] = useState<number | null>(null);

	useEffect(() => {
		// No reset needed in the disabled branch: the cleanup below already
		// nulls the heading when listeners detach.
		if (!enabled || typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
			return;
		}

		let frame: number | null = null;
		let latest: number | null = null;

		const flush = (): void => {
			frame = null;
			setHeading((prev) => (prev === latest ? prev : latest));
		};

		const onOrientation = (e: Event): void => {
			const ev = e as IosDeviceOrientationEvent;
			let next: number | null = null;
			if (typeof ev.webkitCompassHeading === 'number' && Number.isFinite(ev.webkitCompassHeading)) {
				// iOS: already a compass heading (0 = north, clockwise).
				next = ev.webkitCompassHeading;
			} else if (ev.absolute && typeof ev.alpha === 'number' && Number.isFinite(ev.alpha)) {
				// Absolute alpha is counterclockwise from north; invert.
				next = (360 - ev.alpha) % 360;
			}
			if (next === null) return;
			latest = next;
			if (frame === null) frame = requestAnimationFrame(flush);
		};

		// Prefer the absolute variant where it exists; iOS only fires the plain one.
		const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
		window.addEventListener(eventName, onOrientation);

		return () => {
			window.removeEventListener(eventName, onOrientation);
			if (frame !== null) cancelAnimationFrame(frame);
			setHeading(null);
		};
	}, [enabled]);

	return heading;
}
