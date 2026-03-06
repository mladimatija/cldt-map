import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const StoreTest: React.FC = () => {
	const t = useTranslations('storeTest');
	const tCommon = useTranslations('common');
	const {
		direction,
		setDirection,
		units,
		setUnits,
		showBoundary,
		setShowBoundary,
		showTileBoundary,
		setShowTileBoundary,
		distancePrecision,
		setDistancePrecision,
		fakeUserLocationEnabled,
		setFakeUserLocationEnabled,
		setFakeUserLocation,
		setFakeUserLocationOnTrail,
		userLocation,
	} = useMapStore();

	const toggleDirection = (): void => {
		setDirection(direction === 'SOBO' ? 'NOBO' : 'SOBO');
	};

	const toggleUnits = (): void => {
		setUnits(units === 'metric' ? 'imperial' : 'metric');
	};

	const toggleBoundary = (): void => {
		setShowBoundary(!showBoundary);
	};

	const toggleTileBoundary = (): void => {
		setShowTileBoundary(!showTileBoundary);
	};

	const [trailLoading, setTrailLoading] = useState(false);
	const handleRandomOnTrail = async (): Promise<void> => {
		setTrailLoading(true);
		try {
			await setFakeUserLocationOnTrail();
		} catch (_err) {
			alert(tCommon('failedToLoadTrail'));
		} finally {
			setTrailLoading(false);
		}
	};

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>{t('title')}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-6">
					<div>
						<p className="mb-2">
							{t('direction')}: <span className="text-cldt-blue font-semibold">{direction}</span>
						</p>
						<Button size="default" variant="base" onClick={toggleDirection}>
							{t('toggleDirection')}
						</Button>
					</div>

					<div>
						<p className="mb-2">
							{t('units')}: <span className="text-cldt-blue font-semibold">{units}</span>
						</p>
						<Button size="default" variant="base" onClick={toggleUnits}>
							{t('toggleUnits')}
						</Button>
					</div>

					<div>
						<p className="mb-2">
							{t('distanceDecimals')}: <span className="text-cldt-blue font-semibold">{distancePrecision}</span>
						</p>
						<div className="flex flex-wrap gap-2">
							{[0, 1, 2, 3].map((n) => (
								<Button
									key={n}
									size="default"
									variant={distancePrecision === n ? 'selected' : 'base'}
									onClick={() => setDistancePrecision(n)}
								>
									{n}
								</Button>
							))}
						</div>
					</div>

					<div>
						<p className="mb-2">
							{t('showBoundary')}:{' '}
							<span className="text-cldt-blue font-semibold">{showBoundary ? t('yes') : t('no')}</span>
						</p>
						<Button size="default" variant="base" onClick={toggleBoundary}>
							{t('toggleBoundary')}
						</Button>
					</div>

					<div>
						<p className="mb-2">
							{t('showTileBoundary')}:{' '}
							<span className="text-cldt-blue font-semibold">{showTileBoundary ? t('yes') : t('no')}</span>
						</p>
						<Button size="default" variant="base" onClick={toggleTileBoundary}>
							{t('toggleTileBoundary')}
						</Button>
					</div>

					<div>
						<p className="mb-2">
							{t('fakeUserLocation')}:{' '}
							<span className="text-cldt-blue font-semibold">{fakeUserLocationEnabled ? t('on') : t('off')}</span>
						</p>
						<p className="mb-2 text-sm text-gray-600">
							{userLocation ? `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}` : '—'}
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								size="default"
								variant={fakeUserLocationEnabled ? 'selected' : 'primary'}
								onClick={() => setFakeUserLocationEnabled(!fakeUserLocationEnabled)}
							>
								{fakeUserLocationEnabled ? t('disable') : t('enable')}
							</Button>
							{fakeUserLocationEnabled && (
								<>
									<Button size="default" variant="base" onClick={() => setFakeUserLocation()}>
										{t('newRandomLocation')}
									</Button>
									<Button disabled={trailLoading} size="default" variant="base" onClick={handleRandomOnTrail}>
										{trailLoading ? t('loadingTrail') : t('randomOnTrail')}
									</Button>
								</>
							)}
						</div>
					</div>
				</CardContent>
			</Card>

			<Card className="bg-cldt-light-blue/30 border-cldt-blue/20">
				<CardHeader>
					<CardTitle className="text-lg">{t('testingInstructions')}</CardTitle>
				</CardHeader>
				<CardContent>
					<ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700">
						<li>{t('instruction1')}</li>
						<li>{t('instruction2')}</li>
						<li>{t('instruction3')}</li>
					</ol>
					<p className="mt-3 text-xs text-gray-600">{t('instructionNote')}</p>
				</CardContent>
			</Card>
		</div>
	);
};

export default StoreTest;
