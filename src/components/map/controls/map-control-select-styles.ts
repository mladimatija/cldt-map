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
		'flex items-center gap-1 rounded bg-cldt-blue/15 dark:bg-cldt-blue/25 text-[0.6875rem] px-1.5 py-0.5 leading-none',
	multiValueLabel: () => 'text-cldt-blue dark:text-cldt-blue text-[0.6875rem]',
	multiValueRemove: () => 'cursor-pointer hover:text-red-500 ml-0.5 text-[0.6875rem]',
	indicatorsContainer: () => 'flex items-center self-stretch shrink-0',
	indicatorSeparator: () => 'hidden',
	dropdownIndicator: () => 'flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-white px-1',
	clearIndicator: () => 'flex items-center text-gray-400 hover:text-red-500 px-1 cursor-pointer',
	menu: () =>
		'absolute z-controls-popover mt-1 w-full rounded-md border border-gray-200 bg-[var(--map-tooltip-bg)] shadow-md text-xs leading-snug dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)]',
	menuList: () => 'py-1 max-h-60 overflow-y-auto',
	group: () => '',
	groupHeading: () =>
		'px-2 pt-1 pb-0.5 text-[0.625rem] font-semibold tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]',
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
	// Applied only when a select passes menuPortalTarget (e.g. a select inside a
	// useBlockMapPropagation panel whose overflow/stacking would clip an inline
	// menu). Harmless for inline selects: react-select never invokes it then.
	menuPortal: (base: Record<string, unknown>) => ({
		...base,
		zIndex: 'calc(var(--z-map-overlay) + 1)',
	}),
};

/** Inline text-style single-select for the Up Next horizon distance (10px header). */
export const mapControlSelectInlineHorizonClassNames = {
	...mapControlSelectClassNames,
	container: () => 'relative inline-block w-auto align-baseline',
	control: ({ isFocused }: { isFocused: boolean }) =>
		cn(
			'inline-flex min-h-0 cursor-pointer items-center rounded-none border-0 border-b border-dotted border-gray-400/70 bg-transparent p-0 text-[0.625rem] font-medium leading-none text-gray-400 outline-none dark:border-[var(--text-secondary)]/70 dark:text-[var(--text-secondary)]',
			isFocused && 'border-cldt-green text-cldt-blue dark:border-cldt-green dark:text-cldt-blue',
		),
	placeholder: () => 'm-0 text-[0.625rem] leading-none text-gray-400',
	input: () => 'text-[0.625rem] text-inherit',
	singleValue: () => 'm-0 p-0 text-[0.625rem] font-medium tabular-nums text-inherit',
	valueContainer: () => 'm-0 flex items-center p-0',
	indicatorsContainer: () => 'flex shrink-0 items-center self-center pl-0.5',
	indicatorSeparator: () => 'hidden',
	dropdownIndicator: () =>
		'flex items-center p-0 leading-none text-gray-400 dark:text-[var(--text-secondary)] [&>svg]:size-[10px]',
	menu: () =>
		'absolute z-controls-popover mt-0.5 min-w-[4.5rem] rounded border border-gray-200 bg-[var(--map-tooltip-bg)] text-[0.625rem] leading-snug shadow-md dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)]',
	menuList: () => 'max-h-40 overflow-y-auto py-0.5',
	option: ({ isFocused, isSelected }: { isFocused: boolean; isSelected: boolean }) =>
		cn(
			'cursor-pointer px-2 py-0.5 text-[0.625rem] leading-snug tabular-nums text-gray-800 dark:text-[var(--text-primary)]',
			isFocused && 'bg-cldt-blue/10 dark:bg-cldt-blue/20',
			isSelected && 'font-medium text-cldt-blue dark:text-cldt-blue',
		),
};

export const mapControlSelectInlineHorizonStyles = {
	control: (base: Record<string, unknown>) => ({
		...base,
		minHeight: 'auto',
		height: 'auto',
		boxShadow: 'none',
	}),
	valueContainer: (base: Record<string, unknown>) => ({
		...base,
		padding: 0,
	}),
	input: (base: Record<string, unknown>) => ({
		...base,
		gridArea: 'unset',
		position: 'absolute' as const,
		width: 1,
		height: 1,
		margin: 0,
		opacity: 0,
	}),
	indicatorsContainer: (base: Record<string, unknown>) => ({
		...base,
		padding: 0,
		alignSelf: 'center',
	}),
	dropdownIndicator: (base: Record<string, unknown>) => ({
		...base,
		padding: 0,
		paddingLeft: 2,
		lineHeight: 'inherit',
	}),
	singleValue: (base: Record<string, unknown>) => ({
		...base,
		margin: 0,
		position: 'static' as const,
		transform: 'none',
		maxWidth: 'none',
	}),
	menu: (base: Record<string, unknown>) => ({
		...base,
		width: 'max-content',
		minWidth: '4.5rem',
		zIndex: 'calc(var(--z-map-overlay) + 1)',
	}),
	menuPortal: (base: Record<string, unknown>) => ({
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
