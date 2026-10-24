'use client';

/**
 * Last-resort error page, shown when the root layout itself fails. It replaces
 * the root layout, so there is no intl provider and no global CSS here. The
 * strings mirror the `error` namespace of messages/*.json; importing those
 * files would add ~400 KB to the root bundle for a page that almost never shows.
 */
import { useEffect, useState } from 'react';

const STRINGS = {
	en: {
		title: 'Something went wrong',
		body: 'Please try refreshing the page or contact support if the problem persists.',
		refresh: 'Refresh Page',
	},
	hr: {
		title: 'Nešto je pošlo krivo',
		body: 'Pokušajte osvježiti stranicu ili kontaktirajte podršku ako se problem nastavi.',
		refresh: 'Osvježi stranicu',
	},
	de: {
		title: 'Etwas ist schiefgelaufen',
		body: 'Bitte versuche, die Seite zu aktualisieren, oder kontaktiere den Support, wenn das Problem weiterhin besteht.',
		refresh: 'Seite aktualisieren',
	},
	it: {
		title: 'Qualcosa è andato storto',
		body: 'Prova ad aggiornare la pagina o contatta il supporto se il problema persiste.',
		refresh: 'Aggiorna pagina',
	},
} as const;

type Lang = keyof typeof STRINGS;

/** Same source as ClientIntlProvider: the locale the user picked, else English. */
function storedLang(): Lang {
	try {
		const stored = localStorage.getItem('cldt-map-locale');
		return stored && stored in STRINGS ? (stored as Lang) : 'en';
	} catch {
		return 'en';
	}
}

export default function GlobalError({ error }: { error: unknown; retry: () => void }): React.ReactElement {
	const [lang] = useState<Lang>(storedLang);
	const t = STRINGS[lang];

	useEffect(() => {
		console.error('Root layout error:', error);
	}, [error]);

	return (
		<html lang={lang}>
			<body
				style={{
					margin: 0,
					minHeight: '100vh',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
					background: '#f8fafc',
					color: '#0f172a',
				}}
			>
				<main style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
					<h1 style={{ fontSize: 22, marginBottom: 12 }}>{t.title}</h1>
					<p style={{ marginBottom: 20, color: '#475569' }}>{t.body}</p>
					<button
						style={{
							padding: '10px 18px',
							border: 0,
							borderRadius: 6,
							background: '#00a6c7',
							color: '#fff',
							fontSize: 16,
							cursor: 'pointer',
						}}
						type="button"
						onClick={() => window.location.reload()}
					>
						{t.refresh}
					</button>
				</main>
			</body>
		</html>
	);
}
