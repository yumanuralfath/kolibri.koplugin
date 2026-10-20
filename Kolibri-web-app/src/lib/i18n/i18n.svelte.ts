import { messages, type Locale, type MessageKey } from './messages';

const STORAGE_KEY = 'kolibri-locale';

function readStored(): Locale {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'en' || stored === 'id') return stored;
	} catch {
		/* ignore */
	}
	return 'id';
}

let locale = $state<Locale>(typeof window !== 'undefined' ? readStored() : 'id');

export function getLocale(): Locale {
	return locale;
}

export function getLocaleTag(): string {
	return locale === 'en' ? 'en-US' : 'id-ID';
}

export function setLocale(next: Locale): void {
	if (next !== 'id' && next !== 'en') return;
	locale = next;
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {
		/* ignore */
	}
	if (typeof document !== 'undefined') {
		document.documentElement.lang = next === 'en' ? 'en' : 'id';
	}
}

export function initLocale(preferred?: string | null): Locale {
	const next: Locale =
		preferred === 'en' || preferred === 'id' ? preferred : typeof window !== 'undefined' ? readStored() : 'id';
	locale = next;
	if (typeof document !== 'undefined') {
		document.documentElement.lang = next === 'en' ? 'en' : 'id';
	}
	return next;
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
	// Read locale so callers inside $derived re-run when language changes.
	const table = messages[locale] ?? messages.id;
	let text: string = table[key] ?? messages.id[key] ?? key;
	if (vars) {
		for (const [name, value] of Object.entries(vars)) {
			text = text.replaceAll(`{${name}}`, String(value));
		}
	}
	return text;
}

export type { Locale, MessageKey };
