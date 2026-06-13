'use client';

/**
 * Dev-only sample-data seeders for the /test page. The waypoint/journal and
 * pack-weight features start empty for every fresh profile; these buttons
 * fabricate realistic data so the popups, progress panel sections, planner
 * chips, and trip brief pages can be exercised without manual setup. The
 * notification button renders a local test notification through the service
 * worker - the same code path a real seasonal push uses.
 */
import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, useStore } from '@/lib/store';
import { newId, todayIsoDate } from '@/lib/user-waypoints';
import type { WaypointCategoryId } from '@/lib/waypoint-categories';
import { parsePackCsv } from '@/lib/pack-csv';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/** Sample pack list in LighterPack CSV shape; parsed through the real
 *  importer so the seeder exercises the production parser too. */
const SAMPLE_PACK_CSV = `Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable
Shelter tarp,Shelter,,1,450,gram,,,,
Down quilt,Sleep,,1,680,gram,,,,
Sleeping pad,Sleep,,1,410,gram,,,,
Backpack 40L,Storage,,1,890,gram,,,,
Water filter,Water,,1,85,gram,,,,
Stove + pot,Kitchen,,1,310,gram,,,,
Rain jacket,Clothing,,1,240,gram,,,,
Hiking shirt,Clothing,,1,160,gram,,,Worn,
Trail runners,Footwear,,1,620,gram,,,Worn,
Dinners,Food,,4,130,gram,,,,Consumable
Microspikes,Safety,,1,350,gram,,,,`;

/** Waypoints seeded relative to the current (usually simulated) trail
 *  position, or a mid-trail fallback. */
const FALLBACK_KM = 400;

function seedWaypoints(noteLabel: string): number {
	const main = useStore.getState();
	const map = useMapStore.getState();
	const points = main.enhancedTrailPoints;
	if (points.length < 2) return 0;
	const curKm = (main.closestPoint?.distanceFromStart ?? FALLBACK_KM * 1000) / 1000;
	const totalKm = points[points.length - 1].distanceFromStart / 1000;
	const offsets = [2, 7.5, 18];
	const categories: WaypointCategoryId[] = ['water', 'camp', 'resupply'];
	let created = 0;
	for (let i = 0; i < offsets.length; i++) {
		const off = offsets[i];
		const km = Math.min(totalKm - 1, curKm + off);
		const idx = points.findIndex((p) => p.distanceFromStart / 1000 >= km);
		if (idx === -1) continue;
		const pt = points[idx];
		map.addUserWaypoint({
			id: newId(),
			lat: pt.lat,
			lng: pt.lng,
			name: `Test waypoint +${off} km`,
			note: noteLabel,
			category: categories[i] ?? 'generic',
			createdAt: new Date().toISOString(),
			trailKm: km,
		});
		created++;
	}
	return created;
}

function seedJournal(): void {
	const map = useMapStore.getState();
	const today = todayIsoDate();
	const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
	map.addJournalEntry({
		id: newId(),
		date: yesterday,
		text: 'Long ridge day - wind picked up after noon, camped early by the spring.',
		startKm: 380,
		endKm: 405,
		createdAt: new Date().toISOString(),
	});
	map.addJournalEntry({
		id: newId(),
		date: today,
		text: 'Easy forest stretch, resupplied in the village before the climb.',
		createdAt: new Date().toISOString(),
	});
}

function seedPack(): void {
	const map = useMapStore.getState();
	const list = parsePackCsv(SAMPLE_PACK_CSV, 'sample-pack.csv');
	map.setPackGearList(list);
	map.setPackBaseWeightKg(list.baseKg);
}

async function showTestNotification(title: string, body: string): Promise<boolean> {
	if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;
	if ((await Notification.requestPermission()) !== 'granted') return false;
	const registration = await navigator.serviceWorker.ready;
	await registration.showNotification(title, {
		body,
		icon: '/icon-192.png',
		badge: '/icon-192.png',
		data: { url: '/' },
	});
	return true;
}

export function TestDataSeeders(): React.ReactElement {
	const t = useTranslations('storeTest');
	const [status, setStatus] = useState<string | null>(null);

	const actions: { id: string; label: string; run: () => void | Promise<void> }[] = [
		{
			id: 'waypoints',
			label: t('seed.waypoints'),
			run: () => {
				const n = seedWaypoints(t('seed.waypointNote'));
				setStatus(n > 0 ? t('seed.done') : t('seed.needsTrail'));
			},
		},
		{
			id: 'journal',
			label: t('seed.journal'),
			run: () => {
				seedJournal();
				setStatus(t('seed.done'));
			},
		},
		{
			id: 'pack',
			label: t('seed.pack'),
			run: () => {
				seedPack();
				setStatus(t('seed.done'));
			},
		},
		{
			id: 'notification',
			label: t('seed.notification'),
			run: async () => {
				const ok = await showTestNotification(t('seed.notificationTitle'), t('seed.notificationBody'));
				setStatus(ok ? t('seed.done') : t('seed.notificationDenied'));
			},
		},
	];

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('seed.title')}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2">
				<p className="text-sm text-gray-600">{t('seed.description')}</p>
				{actions.map((action) => (
					<div className="flex items-center gap-2 text-sm" key={action.id}>
						<span className="min-w-0 flex-1 text-gray-700">{action.label}</span>
						<Button size="sm" variant="base" onClick={() => void action.run()}>
							{t('seed.run')}
						</Button>
					</div>
				))}
				{status && <p className="text-cldt-green m-0 text-xs">{status}</p>}
			</CardContent>
		</Card>
	);
}
