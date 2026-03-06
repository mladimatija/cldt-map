/** Locale-aware Link, useRouter, usePathname for next-intl (used instead of next/link and next/navigation in app). */
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, useRouter, usePathname } = createNavigation(routing);
