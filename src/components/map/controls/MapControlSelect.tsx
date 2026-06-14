'use client';

import React from 'react';
import Select, { type GroupBase, type Props as SelectProps } from 'react-select';
import {
	mapControlSelectChipScrollStyles,
	mapControlSelectClassNames,
	mapControlSelectMenuStyles,
} from './map-control-select-styles';

const MAP_CONTROL_SELECT_PREFIX = 'map-control-select';

/** Styled react-select for map control panels (unstyled + shared classNames/menu z-index).
 *  Inline menu by default; pass `menuPortalTarget` only in useBlockMapPropagation overlays
 *  where Leaflet swallows control pointer events (see DistanceRemainingOverlay horizon select). */
function MapControlSelect<Option, IsMulti extends boolean = false, Group extends GroupBase<Option> = GroupBase<Option>>(
	props: SelectProps<Option, IsMulti, Group>,
): React.ReactElement {
	const { styles: stylesProp, classNames: classNamesProp, menuPortalTarget, ...restProps } = props;
	const useMenuPortal = menuPortalTarget !== undefined && menuPortalTarget !== null;
	return (
		<Select
			{...restProps}
			unstyled
			classNamePrefix={MAP_CONTROL_SELECT_PREFIX}
			classNames={{ ...mapControlSelectClassNames, ...classNamesProp }}
			menuPortalTarget={menuPortalTarget}
			menuPosition={useMenuPortal ? 'fixed' : 'absolute'}
			styles={{ ...mapControlSelectMenuStyles, ...stylesProp }}
		/>
	);
}

function mapControlMultiSelectClassNames(chipLayout: 'wrap' | 'scroll'): typeof mapControlSelectClassNames {
	if (chipLayout === 'wrap') return mapControlSelectClassNames;
	return {
		...mapControlSelectClassNames,
		control: mapControlSelectClassNames.scrollControl,
		valueContainer: mapControlSelectClassNames.scrollValueContainer,
	};
}

/** Multi-select defaults used across map control panels. */
export function MapControlMultiSelect<Option, Group extends GroupBase<Option> = GroupBase<Option>>({
	chipLayout = 'wrap',
	classNames: classNamesProp,
	isClearable = true,
	styles: stylesProp,
	...props
}: Omit<SelectProps<Option, true, Group>, 'isMulti'> & {
	chipLayout?: 'wrap' | 'scroll';
}): React.ReactElement {
	const chipScrollStyles = chipLayout === 'scroll' ? mapControlSelectChipScrollStyles : {};
	return (
		<MapControlSelect
			hideSelectedOptions
			isMulti
			classNames={{ ...mapControlMultiSelectClassNames(chipLayout), ...classNamesProp }}
			closeMenuOnSelect={false}
			isClearable={isClearable}
			styles={{ ...chipScrollStyles, ...stylesProp }}
			{...props}
		/>
	);
}

/** Single-select defaults: not searchable (sort/filter dropdowns). */
export function MapControlSingleSelect<Option, Group extends GroupBase<Option> = GroupBase<Option>>(
	props: Omit<SelectProps<Option, false, Group>, 'isMulti'>,
): React.ReactElement {
	return <MapControlSelect isSearchable={false} {...props} />;
}

/** Option label with a colored dot (water reliability, waypoint categories). */
export function MapControlSelectColorDotLabel({ label, color }: { label: string; color: string }): React.ReactElement {
	return (
		<span className="inline-flex items-center gap-1.5">
			<span aria-hidden className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: color }} />
			{label}
		</span>
	);
}
