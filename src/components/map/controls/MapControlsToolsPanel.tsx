'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { IoGridOutline, IoRainyOutline } from 'react-icons/io5';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { usePopoverFocusTrap } from '@/hooks';
import { cn } from '@/lib/utils';
import { MAP_CONTROL_PANEL_WIDTH, MAP_CONTROL_POPOVER } from './map-controls-constants';
import { MapControlSectionCard } from './MapControlSectionCard';

interface ColorSettings {
	brightness: number;
	contrast: number;
	saturation: number;
}

interface SliderRowProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
}

function SliderRow({ label, value, min, max, step, onChange }: SliderRowProps): React.ReactElement {
	return (
		<div>
			<div className="mb-0.5 flex justify-between">
				<label className="text-xs text-gray-600 dark:text-[var(--text-secondary)]">{label}</label>
				<span className="text-cldt-blue dark:text-cldt-blue text-xs font-medium">{value}%</span>
			</div>
			<input
				className="precision-slider w-full min-w-0"
				max={max}
				min={min}
				step={step}
				type="range"
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
			/>
		</div>
	);
}

interface MapControlsToolsPanelProps {
	showTilesBoundary: boolean;
	onToggleTilesBoundary: () => void;
	showRadarOverlay: boolean;
	onToggleRadarOverlay: () => void;
	colorSettings: ColorSettings;
	setColorSettings: React.Dispatch<React.SetStateAction<ColorSettings>>;
}

/** Secondary map tools: tile clipping, color adjust, radar overlay. */
export function MapControlsToolsPanel({
	showTilesBoundary,
	onToggleTilesBoundary,
	showRadarOverlay,
	onToggleRadarOverlay,
	colorSettings,
	setColorSettings,
}: MapControlsToolsPanelProps): React.ReactElement {
	const t = useTranslations('mapControls');
	const popoverRef = usePopoverFocusTrap(true);

	return (
		<div
			aria-labelledby="tools-panel-title"
			aria-modal="true"
			className={cn(
				MAP_CONTROL_POPOVER,
				`z-controls-popover fixed top-2 right-16 flex max-h-[calc(100dvh-4rem)] ${MAP_CONTROL_PANEL_WIDTH} flex-col gap-2 overflow-hidden`,
			)}
			ref={popoverRef}
			role="dialog"
			onContextMenu={(e) => e.preventDefault()}
			onMouseDown={(e) => e.stopPropagation()}
			onTouchStart={(e) => e.stopPropagation()}
		>
			<div className="flex shrink-0 items-center justify-between gap-2">
				<h3 className="m-0 text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]" id="tools-panel-title">
					{t('toolsTitle')}
				</h3>
			</div>

			<div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
				<div className="flex flex-col gap-2">
					<MapControlSectionCard title={t('toolsSections.overlays')}>
						<div className="flex flex-col gap-2">
							<label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-[var(--text-primary)]">
								<Checkbox checked={showTilesBoundary} onCheckedChange={() => onToggleTilesBoundary()} />
								<span className="inline-flex items-center gap-1.5">
									<IoGridOutline aria-hidden className="h-4 w-4" />
									{showTilesBoundary ? t('tilesDisable') : t('tilesEnable')}
								</span>
							</label>
							<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('toolsTilesHint')}</p>

							<label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-[var(--text-primary)]">
								<Checkbox checked={showRadarOverlay} onCheckedChange={() => onToggleRadarOverlay()} />
								<span className="inline-flex items-center gap-1.5">
									<IoRainyOutline aria-hidden className="h-4 w-4" />
									{showRadarOverlay ? t('radarDisable') : t('radarEnable')}
								</span>
							</label>
						</div>
					</MapControlSectionCard>

					<MapControlSectionCard title={t('colorMapAppearance')}>
						<div className="flex flex-col gap-2">
							<SliderRow
								label={t('colorBrightness')}
								max={150}
								min={50}
								step={5}
								value={colorSettings.brightness}
								onChange={(v) => setColorSettings((s) => ({ ...s, brightness: v }))}
							/>
							<SliderRow
								label={t('colorContrast')}
								max={150}
								min={50}
								step={5}
								value={colorSettings.contrast}
								onChange={(v) => setColorSettings((s) => ({ ...s, contrast: v }))}
							/>
							<SliderRow
								label={t('colorSaturation')}
								max={200}
								min={0}
								step={5}
								value={colorSettings.saturation}
								onChange={(v) => setColorSettings((s) => ({ ...s, saturation: v }))}
							/>
							<Button
								className="w-full px-3 py-1.5 text-xs"
								variant="mapControlOutline"
								onClick={() => setColorSettings({ brightness: 100, contrast: 100, saturation: 100 })}
							>
								{t('colorReset')}
							</Button>
						</div>
					</MapControlSectionCard>
				</div>
			</div>
		</div>
	);
}
