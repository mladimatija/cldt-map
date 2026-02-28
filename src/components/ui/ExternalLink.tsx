'use client';

import React, { AnchorHTMLAttributes } from 'react';

const EXTERNAL_LINK_CLASS = 'text-cldt-blue font-medium outline-none hover:underline focus-visible:underline';

const EXTERNAL_LINK_REL = 'noopener noreferrer';

interface ExternalLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
	/** Override default link styling */
	className?: string;
}

/**
 * External link with secure defaults (rel, target).
 * Use for links that open in a new tab.
 */
export function ExternalLink({
	className = EXTERNAL_LINK_CLASS,
	rel,
	target = '_blank',
	...props
}: ExternalLinkProps): React.ReactElement {
	return <a className={className} rel={rel ?? EXTERNAL_LINK_REL} target={target} {...props} />;
}
