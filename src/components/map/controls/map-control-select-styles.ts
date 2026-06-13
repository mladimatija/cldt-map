import { cn } from '@/lib/utils';

/** Shared Tailwind classNames for react-select in map control panels. */
export const mapControlSelectClassNames = {
	// No z-index on the container: a stacking context here would trap the open
	// menu inside it, letting a later sibling paint over the menu. The menu's
	// own z-controls-popover below sits in the panel stacking context instead.
	container: () => 'relative w-full text-xs leading-snug',
	control: ({ isFocused }: { isFocused: boolean }) =>
		cn(
			'flex min-h-[44px] flex-wrap items-center justify-between cursor-pointer rounded-md border bg-[var(--map-tooltip-bg)] px-2 py-0.5 text-xs leading-snug text-gray-800 outline-none dark:bg-[var(--bg-secondary)] dark:text-white',
			isFocused ? 'border-cldt-green ring-1 ring-cldt-green' : 'border-gray-200 dark:border-white',
		),
	scrollControl: ({ isFocused }: { isFocused: boolean }) =>
		cn(
			'flex h-[44px] items-center justify-between cursor-pointer rounded-md border bg-[var(--map-tooltip-bg)] px-2 text-xs leading-snug text-gray-800 outline-none dark:bg-[var(--bg-secondary)] dark:text-white',
			isFocused ? 'border-cldt-green ring-1 ring-cldt-green' : 'border-gray-200 dark:border-white',
		),
	placeholder: () => 'm-0 text-xs leading-none text-gray-400',
	input: () => 'text-xs text-gray-800 dark:text-white',
	singleValue: () => 'text-xs text-gray-800 dark:text-white',
	valueContainer: () => 'flex flex-wrap items-center gap-1 flex-1',
	/** Chip scroll row: layout (nowrap, overflow, height) lives in mapControlSelectChipScrollStyles. */
	scrollValueContainer: () => 'flex flex-1 items-center gap-1',
	multiValue: () =>
		'flex items-center gap-1 rounded bg-cldt-blue/15 dark:bg-cldt-blue/25 text-[11px] px-1.5 py-0.5 leading-none',
	multiValueLabel: () => 'text-cldt-blue dark:text-cldt-blue text-[11px]',
	multiValueRemove: () => 'cursor-pointer hover:text-red-500 ml-0.5 text-[11px]',
	indicatorsContainer: () => 'flex items-center self-stretch shrink-0',
	indicatorSeparator: () => 'hidden',
	dropdownIndicator: () => 'flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-white px-1',
	clearIndicator: () => 'flex items-center text-gray-400 hover:text-red-500 px-1 cursor-pointer',
	menu: () =>
		'absolute z-controls-popover mt-1 w-full rounded-md border border-gray-200 bg-[var(--map-tooltip-bg)] shadow-md text-xs leading-snug dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)]',
	menuList: () => 'py-1 max-h-60 overflow-y-auto',
	group: () => '',
	groupHeading: () =>
		'px-2 pt-1 pb-0.5 text-[10px] font-semibold tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]',
	option: ({ isFocused, isSelected }: { isFocused: boolean; isSelected: boolean }) =>
		cn(
			'cursor-pointer px-2 py-1 text-xs leading-snug text-gray-800 dark:text-[var(--text-primary)]',
			isFocused && 'bg-cldt-blue/10 dark:bg-cldt-blue/20',
			isSelected && 'text-cldt-blue font-medium dark:text-cldt-blue',
		),
	noOptionsMessage: () => 'p-2 text-xs italic text-gray-500',
};

export const mapControlSelectMenuStyles = {
	menu: (base: Record<string, unknown>) => ({
		...base,
		zIndex: 'calc(var(--z-map-overlay) + 1)',
	}),
};

/** Single-row chip scroll: overrides react-select Emotion baseline (flex-wrap, overflow). */
export const mapControlSelectChipScrollStyles = {
	container: (base: Record<string, unknown>) => ({
		...base,
		position: 'relative',
		width: '100%',
		maxWidth: '100%',
		// Keep visible so the absolute menu is not clipped; width is capped above.
		overflow: 'visible',
	}),
	control: (base: Record<string, unknown>) => ({
		...base,
		boxSizing: 'border-box',
		alignItems: 'center',
		flexWrap: 'nowrap',
		width: '100%',
		maxWidth: '100%',
		minHeight: 44,
		maxHeight: 44,
		height: 44,
		paddingTop: 0,
		paddingBottom: 0,
		overflow: 'hidden',
	}),
	valueContainer: (base: Record<string, unknown>) => ({
		...base,
		// react-select toggles grid (empty) vs flex (has chips); keep flex always to avoid vertical jitter.
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'nowrap',
		flex: 1,
		minWidth: 0,
		height: '100%',
		padding: 0,
		overflowX: 'auto',
		overflowY: 'hidden',
	}),
	placeholder: (base: Record<string, unknown>) => ({
		...base,
		gridArea: 'unset',
		margin: 0,
		position: 'static',
		lineHeight: 1,
	}),
	multiValue: (base: Record<string, unknown>) => ({
		...base,
		flexShrink: 0,
		margin: 0,
	}),
	input: (base: Record<string, unknown>) => ({
		...base,
		margin: 0,
	}),
	indicatorsContainer: (base: Record<string, unknown>) => ({
		...base,
		flexShrink: 0,
		alignSelf: 'center',
	}),
};
