export function formatDateTime(isoString?: string): string {
	if (!isoString) return '—';
	try {
		const d = new Date(isoString);
		if (isNaN(d.getTime())) return '—';
		return new Intl.DateTimeFormat('id-ID', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(d);
	} catch {
		return '—';
	}
}

export function formatDateOnly(isoString?: string): string {
	if (!isoString) return '—';
	try {
		const d = new Date(isoString);
		if (isNaN(d.getTime())) return '—';
		return new Intl.DateTimeFormat('id-ID', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).format(d);
	} catch {
		return '—';
	}
}

export function formatDuration(seconds?: number): string {
	if (!seconds || seconds <= 0) return '0 menit';
	const h = Math.floor(seconds / 3600);
	const m = Math.round((seconds % 3600) / 60);
	if (h > 0 && m > 0) return `${h} jam ${m} menit`;
	if (h > 0) return `${h} jam`;
	return `${m} menit`;
}

export function getReadingDaysCount(startedAt?: string, endedAt?: string): number {
	if (!startedAt) return 1;
	try {
		const start = new Date(startedAt);
		const end = endedAt ? new Date(endedAt) : new Date();
		const diffTime = Math.max(0, end.getTime() - start.getTime());
		const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
		return Math.max(1, diffDays + 1);
	} catch {
		return 1;
	}
}
