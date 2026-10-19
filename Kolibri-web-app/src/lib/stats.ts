export type StatHighlight = { id?: string; text: string; note?: string; createdAt?: string };
export type StatBook = {
	id: string;
	title: string;
	authors: string[];
	language?: string;
	totalPages: number;
	currentPage: number;
	progress: number;
	totalReadPages?: number;
	totalReadTime?: number;
	status: 'reading' | 'finished' | 'paused';
	startedAt?: string;
	lastReadAt: string;
	finishedAt?: string;
	highlights: StatHighlight[];
};
export type StatSession = {
	id: string;
	bookId: string;
	page: number;
	startTime: number; // epoch detik
	duration: number; // detik
	totalPages: number;
};

export type HeatCell = {
	key: string;
	label: string;
	seconds: number;
	pages: number;
	level: 0 | 1 | 2 | 3 | 4;
	future: boolean;
	today: boolean;
};
export type HeatWeek = { cells: (HeatCell | null)[]; month?: string };

const DAY_MS = 86_400_000;

/** KOReader mengisi "N/A" bila metadata penulis kosong. */
export function isKnownAuthor(name: string): boolean {
	const n = name.trim();
	return n.length > 0 && !/^(n\/?a|unknown|tidak diketahui|-+|—)$/i.test(n);
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}
export function dayKey(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Nomor hari (integer) dari tanggal lokal, aman terhadap DST. */
function dayNumber(d: Date): number {
	return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}
function keyToDayNumber(key: string): number {
	const [y, m, d] = key.split('-').map(Number);
	return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}
function daysBetween(a?: string, b?: string): number | null {
	if (!a || !b) return null;
	const s = new Date(a);
	const e = new Date(b);
	if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
	return Math.max(1, dayNumber(e) - dayNumber(s) + 1);
}

export function formatHours(seconds: number): string {
	if (!seconds || seconds <= 0) return '0 mnt';
	const h = Math.floor(seconds / 3600);
	const m = Math.round((seconds % 3600) / 60);
	if (h > 0 && m > 0) return `${h} j ${m} mnt`;
	if (h > 0) return `${h} j`;
	return `${m} mnt`;
}

export function computeStats(books: StatBook[], sessions: StatSession[], now = new Date()) {
	const valid = sessions.filter((s) => s.startTime > 0 && s.duration > 0);

	// ---------- agregasi sesi ----------
	const days = new Map<string, { seconds: number; pages: Set<string> }>();
	const hourSeconds = Array.from({ length: 24 }, () => 0);
	const weekdaySeconds = Array.from({ length: 7 }, () => 0);
	const monthSeconds = new Map<string, number>();
	const bookSeconds = new Map<string, number>();
	const uniquePages = new Set<string>();
	let sessionSeconds = 0;
	let longestSession = 0;

	for (const s of valid) {
		const d = new Date(s.startTime * 1000);
		const key = dayKey(d);
		const day = days.get(key) ?? { seconds: 0, pages: new Set<string>() };
		day.seconds += s.duration;
		day.pages.add(`${s.bookId}:${s.page}`);
		days.set(key, day);
		hourSeconds[d.getHours()] += s.duration;
		weekdaySeconds[d.getDay()] += s.duration;
		const mk = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
		monthSeconds.set(mk, (monthSeconds.get(mk) ?? 0) + s.duration);
		bookSeconds.set(s.bookId, (bookSeconds.get(s.bookId) ?? 0) + s.duration);
		uniquePages.add(`${s.bookId}:${s.page}`);
		sessionSeconds += s.duration;
		longestSession = Math.max(longestSession, s.duration);
	}

	const booksSeconds = books.reduce((n, b) => n + (b.totalReadTime ?? 0), 0);
	const booksPages = books.reduce((n, b) => n + (b.totalReadPages ?? b.currentPage ?? 0), 0);
	const totalSeconds = Math.max(sessionSeconds, booksSeconds);
	const totalPages = Math.max(uniquePages.size, booksPages);

	// ---------- streak ----------
	const dayNums = [...days.entries()]
		.filter(([, v]) => v.seconds > 0)
		.map(([k]) => keyToDayNumber(k))
		.sort((a, b) => a - b);
	let longestStreak = 0;
	let run = 0;
	for (let i = 0; i < dayNums.length; i++) {
		run = i > 0 && dayNums[i] === dayNums[i - 1] + 1 ? run + 1 : 1;
		longestStreak = Math.max(longestStreak, run);
	}
	const today = dayNumber(now);
	const active = new Set(dayNums);
	let currentStreak = 0;
	let cursor = active.has(today) ? today : today - 1;
	while (active.has(cursor)) {
		currentStreak++;
		cursor--;
	}

	// ---------- jendela waktu ----------
	const sumDays = (n: number) => {
		let total = 0;
		for (let i = 0; i < n; i++) {
			total += days.get(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)))?.seconds ?? 0;
		}
		return total;
	};
	const last7 = sumDays(7);
	const last30 = sumDays(30);

	const daily30 = Array.from({ length: 30 }, (_, i) => {
		const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29 + i);
		const v = days.get(dayKey(d));
		return {
			label: new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(d),
			minutes: Math.round((v?.seconds ?? 0) / 60),
			pages: v?.pages.size ?? 0
		};
	});
	const monthly12 = Array.from({ length: 12 }, (_, i) => {
		const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
		const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
		return {
			key,
			label: new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(d),
			hours: Math.round(((monthSeconds.get(key) ?? 0) / 3600) * 10) / 10,
			finished: 0
		};
	});

	// ---------- buku ----------
	const finished = books.filter((b) => b.status === 'finished');
	const reading = books.filter((b) => b.status === 'reading');
	const paused = books.filter((b) => b.status === 'paused');

	for (const b of finished) {
		if (!b.finishedAt) continue;
		const d = new Date(b.finishedAt);
		const slot = monthly12.find((m) => m.key === `${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
		if (slot) slot.finished++;
	}
	const finishedThisYear = finished.filter(
		(b) => b.finishedAt && new Date(b.finishedAt).getFullYear() === now.getFullYear()
	).length;

	const finishTimes = finished
		.map((b) => ({ book: b, days: daysBetween(b.startedAt, b.finishedAt) }))
		.filter((x): x is { book: StatBook; days: number } => x.days !== null);
	const avgFinishDays = finishTimes.length
		? Math.round((finishTimes.reduce((n, x) => n + x.days, 0) / finishTimes.length) * 10) / 10
		: 0;
	const fastest = finishTimes.length ? finishTimes.reduce((a, b) => (b.days < a.days ? b : a)) : null;
	const slowest = finishTimes.length ? finishTimes.reduce((a, b) => (b.days > a.days ? b : a)) : null;

	const finishedPages = finished.reduce((n, b) => n + (b.totalPages || 0), 0);
	const unfinished = books.filter((b) => b.status !== 'finished');
	const avgProgress = unfinished.length
		? Math.round(unfinished.reduce((n, b) => n + (b.progress ?? 0), 0) / unfinished.length)
		: 0;

	// waktu baca per buku (ambil yang terbesar antara data buku & sesi)
	const topBooks = books
		.map((b) => ({ book: b, seconds: Math.max(b.totalReadTime ?? 0, bookSeconds.get(b.id) ?? 0) }))
		.filter((x) => x.seconds > 0)
		.sort((a, b) => b.seconds - a.seconds)
		.slice(0, 5);

	// penulis
	const authorMap = new Map<string, { books: number; seconds: number; finished: number }>();
	for (const b of books) {
		const sec = Math.max(b.totalReadTime ?? 0, bookSeconds.get(b.id) ?? 0);
		for (const name of b.authors.filter(isKnownAuthor)) {
			const a = authorMap.get(name) ?? { books: 0, seconds: 0, finished: 0 };
			a.books++;
			a.seconds += sec;
			if (b.status === 'finished') a.finished++;
			authorMap.set(name, a);
		}
	}
	const topAuthors = [...authorMap.entries()]
		.map(([name, v]) => ({ name, ...v }))
		.sort((a, b) => b.books - a.books || b.seconds - a.seconds)
		.slice(0, 5);

	// bahasa
	const langMap = new Map<string, number>();
	for (const b of books) {
		const l = (b.language ?? '').trim().toLowerCase();
		if (l) langMap.set(l, (langMap.get(l) ?? 0) + 1);
	}
	const languages = [...langMap.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);

	// ---------- kutipan ----------
	const allHighlights = books.flatMap((b) => b.highlights);
	const withNotes = allHighlights.filter((h) => h.note?.trim()).length;
	const mostQuoted = books.length
		? books.reduce((a, b) => (b.highlights.length > a.highlights.length ? b : a))
		: null;

	// ---------- kebiasaan ----------
	const activeDays = dayNums.length;
	const peakHourSec = Math.max(...hourSeconds);
	const peakHour = peakHourSec > 0 ? hourSeconds.indexOf(peakHourSec) : null;
	const peakWeekdaySec = Math.max(...weekdaySeconds);
	const peakWeekday = peakWeekdaySec > 0 ? weekdaySeconds.indexOf(peakWeekdaySec) : null;
	const longestDay = Math.max(0, ...[...days.values()].map((d) => d.seconds));

	const bucketsDef = [
		{ name: 'Pagi', from: 5, to: 11 },
		{ name: 'Siang', from: 11, to: 15 },
		{ name: 'Sore', from: 15, to: 18 },
		{ name: 'Malam', from: 18, to: 29 }
	];
	const buckets = bucketsDef.map((b) => {
		let sec = 0;
		for (let h = b.from; h < b.to; h++) sec += hourSeconds[h % 24];
		return { name: b.name, seconds: sec };
	});
	const favouriteBucket = buckets.reduce((a, b) => (b.seconds > a.seconds ? b : a));

	// ---------- heatmap 53 minggu ----------
	const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const end = new Date(todayDate);
	end.setDate(end.getDate() + (6 - end.getDay()));
	const start = new Date(end);
	start.setDate(start.getDate() - (53 * 7 - 1));
	const weeks: HeatWeek[] = [];
	let week: (HeatCell | null)[] = [];
	let lastMonth = -1;
	let yearSeconds = 0;
	let yearDays = 0;
	for (const it = new Date(start); it <= end; it.setDate(it.getDate() + 1)) {
		const key = dayKey(it);
		const future = it > todayDate;
		const v = future ? undefined : days.get(key);
		const seconds = v?.seconds ?? 0;
		let level: HeatCell['level'] = 0;
		if (seconds > 0) level = seconds <= 900 ? 1 : seconds <= 2700 ? 2 : seconds <= 5400 ? 3 : 4;
		if (seconds > 0) {
			yearSeconds += seconds;
			yearDays++;
		}
		week.push({
			key,
			label: new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(it),
			seconds,
			pages: v?.pages.size ?? 0,
			level,
			future,
			today: key === dayKey(todayDate)
		});
		if (it.getDay() === 6) {
			const first = week.find((c) => c && !c.future && Number(c.key.slice(8)) <= 7);
			let month: string | undefined;
			if (first) {
				const m = Number(first.key.slice(5, 7)) - 1;
				if (m !== lastMonth) {
					month = new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(new Date(2000, m, 1));
					lastMonth = m;
				}
			}
			weeks.push({ cells: week, month });
			week = [];
		}
	}

	return {
		counts: {
			books: books.length,
			reading: reading.length,
			finished: finished.length,
			paused: paused.length,
			completionRate: books.length ? Math.round((finished.length / books.length) * 100) : 0
		},
		totalSeconds,
		totalPages,
		sessionCount: valid.length,
		activeDays,
		currentStreak,
		longestStreak,
		last7,
		last30,
		longestDay,
		longestSession,
		avgMinutesPerActiveDay: activeDays ? Math.round(sessionSeconds / activeDays / 60) : 0,
		avgSessionMinutes: valid.length ? Math.round(sessionSeconds / valid.length / 60) : 0,
		pagesPerHour: totalSeconds > 0 ? Math.round(totalPages / (totalSeconds / 3600)) : 0,
		finishedThisYear,
		finishedPages,
		avgFinishDays,
		fastest,
		slowest,
		avgProgress,
		topBooks,
		topAuthors,
		languages,
		highlights: { total: allHighlights.length, withNotes, mostQuoted },
		hourSeconds,
		weekdaySeconds,
		peakHour,
		peakWeekday,
		favouriteBucket: favouriteBucket.seconds > 0 ? favouriteBucket : null,
		daily30,
		monthly12,
		heatmap: { weeks, yearSeconds, yearDays }
	};
}

export type Stats = ReturnType<typeof computeStats>;
