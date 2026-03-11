/**
 * Catch-all for unknown routes: triggers the localized not-found page.
 * Required because Next.js only renders not-found when notFound() is called from a route.
 */
import { notFound } from 'next/navigation';

export default function CatchAllPage(): never {
	notFound();
}
