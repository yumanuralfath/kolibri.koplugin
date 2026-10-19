<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteDate, SvelteMap } from 'svelte/reactivity';
	import Chart from 'chart.js/auto';

	type ReadingSession = {
		id: string;
		bookId: string;
		page: number;
		startTime: number;
		duration: number;
		totalPages: number;
	};
	type Book = {
		id: string;
		title: string;
		authors?: string[];
		coverUrl?: string;
		totalReadPages?: number;
		totalReadTime?: number;
	};
	let { sessions, books }: { sessions: ReadingSession[]; books: Book[] } = $props();
	let dailyCanvas = $state<HTMLCanvasElement>();
	let monthlyCanvas = $state<HTMLCanvasElement>();
	let weekdayCanvas = $state<HTMLCanvasElement>();

	let dailyChartInstance: Chart | null = null;
	let monthlyChartInstance: Chart | null = null;
	let weekdayChartInstance: Chart | null = null;

	function dayKey(date: Date): string {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	}

	function dateLabel(date: Date): string {
		return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
	}

	let aggregated = $derived.by(() => {
		const days = new SvelteMap<string, { pages: Set<string>; seconds: number }>();
		const weekdays = Array.from({ length: 7 }, () => ({ pages: 0, seconds: 0 }));
		const months = new SvelteMap<string, number>();
		let totalSeconds = 0;
		for (const session of sessions) {
			if (!session.startTime) continue;
			const date = new Date(session.startTime * 1000);
			const key = dayKey(date);
			const day = days.get(key) ?? { pages: new Set<string>(), seconds: 0 };
			day.pages.add(`${session.bookId}:${session.page}`);
			day.seconds += session.duration;
			days.set(key, day);
			weekdays[date.getDay()].pages += 1;
			weekdays[date.getDay()].seconds += session.duration;
			const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
			months.set(monthKey, (months.get(monthKey) ?? 0) + session.duration);
			totalSeconds += session.duration;
		}

		const today = new Date();
		const daily = Array.from({ length: 30 }, (_, offset) => {
			const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29 + offset);
			const data = days.get(dayKey(date));
			return {
				label: dateLabel(date),
				pages: data?.pages.size ?? 0,
				minutes: Math.round((data?.seconds ?? 0) / 60)
			};
		});
		const monthly = Array.from({ length: 12 }, (_, offset) => {
			const date = new Date(today.getFullYear(), today.getMonth() - 11 + offset, 1);
			const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
			return {
				label: new Intl.DateTimeFormat('en', { month: 'short' }).format(date),
				hours: Math.round(((months.get(key) ?? 0) / 3600) * 10) / 10
			};
		});
		const activeDays = [...days.values()].filter((day) => day.seconds > 0).length;
		const longestDay = Math.max(0, ...[...days.values()].map((day) => day.seconds));
		const bestPagesDay = Math.max(0, ...[...days.values()].map((day) => day.pages.size));
		const lastWeek = Array.from({ length: 7 }, (_, offset) => {
			const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
			return days.get(dayKey(date))?.seconds ?? 0;
		}).reduce((sum, duration) => sum + duration, 0);
		const historyPages = new Set(sessions.map((session) => `${session.bookId}:${session.page}`))
			.size;
		const bookPages = books.reduce((sum, book) => sum + (book.totalReadPages ?? 0), 0);
		const bookSeconds = books.reduce((sum, book) => sum + (book.totalReadTime ?? 0), 0);
		return {
			daily,
			monthly,
			weekdays,
			totalSeconds: Math.max(totalSeconds, bookSeconds),
			totalPages: Math.max(historyPages, bookPages),
			activeDays,
			longestDay,
			bestPagesDay,
			lastWeek,
			averageMinutes: activeDays ? Math.round((totalSeconds / activeDays / 60) * 10) / 10 : 0
		};
	});

	type CalendarCell = {
		date: Date;
		dateStr: string;
		label: string;
		seconds: number;
		minutes: number;
		hours: number;
		pages: number;
		level: 0 | 1 | 2 | 3 | 4;
		isFuture: boolean;
		isToday: boolean;
	};

	type CalendarWeek = {
		days: (CalendarCell | null)[];
		monthLabel?: string;
	};

	let hoveredCell = $state<CalendarCell | null>(null);
	let selectedDateStr = $state<string | null>(null);

	// day -> book -> { seconds, pages }. Only books present in `books` are listed, so
	// sessions of hidden/deleted books never leak into the day detail.
	let booksByDay = $derived.by(() => {
		const titles = new Map(books.map((book) => [book.id, book]));
		const days = new SvelteMap<string, Map<string, { seconds: number; pages: Set<number> }>>();
		for (const session of sessions) {
			if (!session.startTime || !titles.has(session.bookId)) continue;
			const key = dayKey(new Date(session.startTime * 1000));
			const perBook = days.get(key) ?? new SvelteMap();
			const entry = perBook.get(session.bookId) ?? { seconds: 0, pages: new Set<number>() };
			entry.seconds += session.duration;
			entry.pages.add(session.page);
			perBook.set(session.bookId, entry);
			days.set(key, perBook);
		}
		return days;
	});

	let selectedDay = $derived.by(() => {
		if (!selectedDateStr) return null;
		const cell = calendarData.weeks
			.flatMap((week) => week.days)
			.find((day) => day?.dateStr === selectedDateStr);
		if (!cell) return null;
		const perBook = booksByDay.get(selectedDateStr);
		const list = [...(perBook?.entries() ?? [])]
			.map(([bookId, entry]) => ({
				book: books.find((book) => book.id === bookId)!,
				seconds: entry.seconds,
				pages: entry.pages.size
			}))
			.sort((a, b) => b.seconds - a.seconds);
		return { cell, list };
	});

	function selectDay(day: CalendarCell) {
		if (day.isFuture) return;
		selectedDateStr = selectedDateStr === day.dateStr ? null : day.dateStr;
	}

	let calendarData = $derived.by(() => {
		const daysMap = new SvelteMap<string, { seconds: number; pages: Set<string> }>();
		for (const session of sessions) {
			if (!session.startTime) continue;
			const d = new Date(session.startTime * 1000);
			const k = dayKey(d);
			const entry = daysMap.get(k) ?? { seconds: 0, pages: new Set<string>() };
			entry.seconds += session.duration;
			entry.pages.add(`${session.bookId}:${session.page}`);
			daysMap.set(k, entry);
		}

		const today = new SvelteDate();
		today.setHours(0, 0, 0, 0);
		const todayKey = dayKey(today);

		// GitHub standard: 53 weeks ending on the current week's Saturday
		const endDayOfWeek = today.getDay(); // 0 is Sun, 6 is Sat
		const daysUntilSaturday = 6 - endDayOfWeek;
		const endDate = new SvelteDate(today);
		endDate.setDate(today.getDate() + daysUntilSaturday);

		const startDate = new SvelteDate(endDate);
		startDate.setDate(endDate.getDate() - (53 * 7 - 1));

		const weeks: CalendarWeek[] = [];
		let currentWeekDays: (CalendarCell | null)[] = [];
		let lastMonth = -1;

		let maxStreak = 0;
		let currentRunningStreak = 0;
		let yearTotalSeconds = 0;
		let yearActiveDays = 0;

		const iterDate = new SvelteDate(startDate);
		while (iterDate <= endDate) {
			const dayOfWeek = iterDate.getDay();
			const dateStr = dayKey(iterDate);
			const isToday = dateStr === todayKey;
			const isFuture = iterDate > today;
			const data = daysMap.get(dateStr);
			const seconds = !isFuture && data ? data.seconds : 0;
			const minutes = Math.round(seconds / 60);
			const hours = Math.round((seconds / 3600) * 10) / 10;
			const pages = !isFuture && data ? data.pages.size : 0;

			let level: 0 | 1 | 2 | 3 | 4 = 0;
			if (seconds > 0) {
				if (seconds <= 900) level = 1;
				else if (seconds <= 2700) level = 2;
				else if (seconds <= 5400) level = 3;
				else level = 4;
			}

			if (!isFuture) {
				yearTotalSeconds += seconds;
				if (seconds > 0) {
					yearActiveDays++;
					currentRunningStreak++;
					if (currentRunningStreak > maxStreak) maxStreak = currentRunningStreak;
				} else {
					currentRunningStreak = 0;
				}
			}

			const formattedDate = new Intl.DateTimeFormat('id-ID', {
				weekday: 'long',
				day: 'numeric',
				month: 'short',
				year: 'numeric'
			}).format(iterDate);

			const cell: CalendarCell = {
				date: new Date(iterDate),
				dateStr,
				label: formattedDate,
				seconds,
				minutes,
				hours,
				pages,
				level,
				isFuture,
				isToday
			};

			currentWeekDays.push(cell);

			if (dayOfWeek === 6) {
				let monthLabel: string | undefined = undefined;
				const firstInWeek = currentWeekDays.find(
					(c) => c && c.date.getDate() <= 7 && c.date.getMonth() !== lastMonth
				);
				if (firstInWeek) {
					monthLabel = new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(
						firstInWeek.date
					);
					lastMonth = firstInWeek.date.getMonth();
				}
				weeks.push({
					days: currentWeekDays,
					monthLabel
				});
				currentWeekDays = [];
			}

			iterDate.setDate(iterDate.getDate() + 1);
		}

		let activeStreak = 0;
		const checkDate = new SvelteDate(today);
		while (true) {
			const k = dayKey(checkDate);
			const s = daysMap.get(k)?.seconds ?? 0;
			if (s > 0) {
				activeStreak++;
				checkDate.setDate(checkDate.getDate() - 1);
			} else if (k === todayKey) {
				checkDate.setDate(checkDate.getDate() - 1);
				const yestKey = dayKey(checkDate);
				if ((daysMap.get(yestKey)?.seconds ?? 0) === 0) break;
			} else {
				break;
			}
		}

		return {
			weeks,
			maxStreak,
			currentStreak: activeStreak,
			yearTotalSeconds,
			yearActiveDays,
			yearTotalHours: Math.round((yearTotalSeconds / 3600) * 10) / 10
		};
	});

	function durationLabel(seconds: number): string {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.round((seconds % 3600) / 60);
		return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
	}

	function getThemeColors() {
		if (typeof document === 'undefined') {
			return {
				grid: '#dedfd6',
				ticks: '#777b72',
				tooltipBg: '#20231f',
				tooltipText: '#f5f5ef',
				lineBorder: '#3b6b53',
				lineBg: '#3b6b5326',
				barMonthly: '#dc6a45',
				barWeekday: '#718f73'
			};
		}
		const theme = document.documentElement.getAttribute('data-theme') || 'light';
		if (theme === 'dark') {
			return {
				grid: '#2b312a',
				ticks: '#8e958a',
				tooltipBg: '#1f241f',
				tooltipText: '#e8eae5',
				lineBorder: '#529976',
				lineBg: '#52997633',
				barMonthly: '#e07450',
				barWeekday: '#529976'
			};
		}
		if (theme === 'sepia') {
			return {
				grid: '#ded0b4',
				ticks: '#826e59',
				tooltipBg: '#3b2c1d',
				tooltipText: '#fbf7ee',
				lineBorder: '#4f6f4d',
				lineBg: '#4f6f4d26',
				barMonthly: '#cc603d',
				barWeekday: '#758866'
			};
		}
		return {
			grid: '#dedfd6',
			ticks: '#777b72',
			tooltipBg: '#20231f',
			tooltipText: '#f5f5ef',
			lineBorder: '#3b6b53',
			lineBg: '#3b6b5326',
			barMonthly: '#dc6a45',
			barWeekday: '#718f73'
		};
	}

	function buildCharts() {
		if (!dailyCanvas || !monthlyCanvas || !weekdayCanvas) return;
		destroyCharts();

		const colors = getThemeColors();
		const shared = {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: { display: false },
				tooltip: {
					backgroundColor: colors.tooltipBg,
					titleColor: colors.tooltipText,
					bodyColor: colors.tooltipText,
					padding: 10,
					titleFont: { family: 'DM Mono' },
					bodyFont: { family: 'DM Sans' }
				}
			},
			scales: {
				x: {
					grid: { display: false },
					border: { display: false },
					ticks: { color: colors.ticks, maxTicksLimit: 7, font: { family: 'DM Mono', size: 9 } }
				},
				y: {
					beginAtZero: true,
					grid: { color: colors.grid },
					border: { display: false },
					ticks: { color: colors.ticks, precision: 0, font: { family: 'DM Mono', size: 9 } }
				}
			}
		};

		dailyChartInstance = new Chart(dailyCanvas, {
			type: 'line',
			data: {
				labels: aggregated.daily.map((item) => item.label),
				datasets: [
					{
						data: aggregated.daily.map((item) => item.pages),
						borderColor: colors.lineBorder,
						backgroundColor: colors.lineBg,
						fill: true,
						tension: 0.35,
						pointRadius: 2,
						pointHoverRadius: 4,
						borderWidth: 2
					}
				]
			},
			options: {
				...shared,
				plugins: {
					...shared.plugins,
					tooltip: {
						...shared.plugins.tooltip,
						callbacks: { label: (context) => `${context.parsed.y} pages` }
					}
				}
			}
		});

		monthlyChartInstance = new Chart(monthlyCanvas, {
			type: 'bar',
			data: {
				labels: aggregated.monthly.map((item) => item.label),
				datasets: [
					{
						data: aggregated.monthly.map((item) => item.hours),
						backgroundColor: colors.barMonthly,
						borderRadius: 3,
						maxBarThickness: 25
					}
				]
			},
			options: {
				...shared,
				plugins: {
					...shared.plugins,
					tooltip: {
						...shared.plugins.tooltip,
						callbacks: { label: (context) => `${context.parsed.y} hours` }
					}
				}
			}
		});

		weekdayChartInstance = new Chart(weekdayCanvas, {
			type: 'bar',
			data: {
				labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
				datasets: [
					{
						data: aggregated.weekdays.map((item) => Math.round(item.seconds / 60)),
						backgroundColor: colors.barWeekday,
						borderRadius: 3,
						maxBarThickness: 34
					}
				]
			},
			options: {
				...shared,
				plugins: {
					...shared.plugins,
					tooltip: {
						...shared.plugins.tooltip,
						callbacks: { label: (context) => `${context.parsed.y} minutes` }
					}
				}
			}
		});
	}

	function destroyCharts() {
		dailyChartInstance?.destroy();
		monthlyChartInstance?.destroy();
		weekdayChartInstance?.destroy();
		dailyChartInstance = null;
		monthlyChartInstance = null;
		weekdayChartInstance = null;
	}

	onMount(() => {
		buildCharts();

		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.attributeName === 'data-theme') {
					buildCharts();
				}
			}
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme']
		});

		return () => {
			observer.disconnect();
			destroyCharts();
		};
	});
</script>

<section class="analytics-section" aria-label="Detailed reading analytics">
	<div class="section-heading analytics-heading">
		<div>
			<p class="eyebrow">READING RHYTHM</p>
			<h2>By the numbers<span>.</span></h2>
		</div>
		<span class="shelf-total">{sessions.length.toLocaleString()} logged sessions</span>
	</div>
	<div class="analytics-metrics">
		<div>
			<span>TOTAL READING TIME</span><strong>{durationLabel(aggregated.totalSeconds)}</strong>
		</div>
		<div><span>PAGES READ</span><strong>{aggregated.totalPages.toLocaleString()}</strong></div>
		<div><span>ACTIVE DAYS</span><strong>{aggregated.activeDays.toLocaleString()}</strong></div>
		<div><span>LAST 7 DAYS</span><strong>{durationLabel(aggregated.lastWeek)}</strong></div>
		<div><span>LONGEST DAY</span><strong>{durationLabel(aggregated.longestDay)}</strong></div>
		<div><span>BEST DAY</span><strong>{aggregated.bestPagesDay} pages</strong></div>
	</div>

	<!-- Reading Activity Heatmap Calendar (GitHub style) -->
	<article class="reading-calendar-panel" aria-label="Kalender Aktivitas Membaca">
		<div class="calendar-top-row">
			<div>
				<p class="eyebrow" style="margin-bottom: 2px;">KALENDER BACAAN</p>
				<h3>Aktivitas Membaca 52 Minggu Terakhir</h3>
				<p>Read hours per hari (semakin pekat warna kotak, semakin lama durasi membaca)</p>
			</div>
			<div class="calendar-badges">
				<div class="calendar-badge">
					<span>Waktu:</span>
					<strong>{calendarData.yearTotalHours} jam</strong>
				</div>
				<div class="calendar-badge">
					<span>Hari Aktif:</span>
					<strong>{calendarData.yearActiveDays} hari</strong>
				</div>
				{#if calendarData.currentStreak > 0}
					<div class="calendar-badge">
						<span>Streak Saat Ini:</span>
						<strong>🔥 {calendarData.currentStreak} hari</strong>
					</div>
				{/if}
				{#if calendarData.maxStreak > 0}
					<div class="calendar-badge">
						<span>Streak Terpanjang:</span>
						<strong>🏆 {calendarData.maxStreak} hari</strong>
					</div>
				{/if}
			</div>
		</div>

		<div class="calendar-scroll-wrap">
			<div class="calendar-grid-table">
				<div class="calendar-weekdays-col" aria-hidden="true">
					<span>Sen</span>
					<span>Rab</span>
					<span>Jum</span>
				</div>
				<div class="calendar-weeks-container">
					<div class="calendar-months-row">
						{#each calendarData.weeks as week, weekIndex (weekIndex)}
							<div class="calendar-month-item" style="width: 14px;">
								{week.monthLabel ?? ''}
							</div>
						{/each}
					</div>
					<div class="calendar-cells-matrix">
						{#each calendarData.weeks as week, weekIndex (weekIndex)}
							<div class="calendar-week-col">
								{#each week.days as day, dayIndex (dayIndex)}
									{#if day}
										<div
											class="calendar-cell cal-level-{day.level}"
											class:is-today={day.isToday}
											class:is-future={day.isFuture}
											role="gridcell"
											tabindex="0"
											aria-label="{day.label}: {day.seconds > 0 ? durationLabel(day.seconds) : 'Tidak ada aktivitas'}"
											class:is-selected={day.dateStr === selectedDateStr}
										onclick={() => selectDay(day)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectDay(day);
											}
										}}
										onmouseenter={() => (hoveredCell = day)}
											onmouseleave={() => (hoveredCell = null)}
											onfocus={() => (hoveredCell = day)}
											onblur={() => (hoveredCell = null)}
										></div>
									{:else}
										<div class="calendar-cell" style="opacity: 0;"></div>
									{/if}
								{/each}
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<div class="calendar-info-bar">
			<div class="calendar-hover-text">
				{#if hoveredCell}
					<span>
						📅 <strong>{hoveredCell.label}</strong>:
						{#if hoveredCell.seconds > 0}
							{durationLabel(hoveredCell.seconds)} ({hoveredCell.hours} jam) · {hoveredCell.pages} halaman dibaca
						{:else}
							Tidak ada aktivitas membaca
						{/if}
					</span>
				{:else}
					<span style="color: var(--muted);">Arahkan kursor ke kotak untuk melihat jam baca, klik untuk melihat buku yang dibaca pada hari itu</span>
				{/if}
			</div>

			<div class="calendar-legend">
				<span>Kurang</span>
				<div class="calendar-legend-cells">
					<span class="calendar-legend-cell cal-level-0" title="0 menit"></span>
					<span class="calendar-legend-cell cal-level-1" title="≤ 15 menit"></span>
					<span class="calendar-legend-cell cal-level-2" title="16 - 45 menit"></span>
					<span class="calendar-legend-cell cal-level-3" title="46 - 90 menit"></span>
					<span class="calendar-legend-cell cal-level-4" title="> 90 menit (paling pekat)"></span>
				</div>
				<span>Lebih lama</span>
			</div>
		</div>

		{#if selectedDay}
			<div class="day-detail" aria-live="polite">
				<div class="day-detail-head">
					<strong>📅 {selectedDay.cell.label}</strong>
					<button type="button" class="day-detail-close" onclick={() => (selectedDateStr = null)} aria-label="Tutup rincian hari">×</button>
				</div>
				{#if selectedDay.list.length === 0}
					<p class="day-detail-empty">Tidak ada buku yang dibaca pada hari ini.</p>
				{:else}
					<p class="day-detail-sub">
						{selectedDay.list.length} buku · {durationLabel(selectedDay.list.reduce((sum, item) => sum + item.seconds, 0))}
					</p>
					<ul class="day-detail-list">
						{#each selectedDay.list as item (item.book.id)}
							<li>
								<div class="day-detail-book">
									<strong>{item.book.title}</strong>
									{#if item.book.authors?.length}<small>{item.book.authors.join(', ')}</small>{/if}
								</div>
								<span>{durationLabel(item.seconds)} · {item.pages} halaman</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</article>

	{#if sessions.length}
		<div class="chart-grid">
			<article class="chart-panel chart-panel--wide">
				<div>
					<h3>Pages read</h3>
					<p>Daily activity · last 30 days</p>
				</div>
				<div class="chart-canvas"><canvas bind:this={dailyCanvas}></canvas></div>
			</article>
			<article class="chart-panel">
				<div>
					<h3>Reading time</h3>
					<p>Hours by month · last 12 months</p>
				</div>
				<div class="chart-canvas"><canvas bind:this={monthlyCanvas}></canvas></div>
			</article>
			<article class="chart-panel">
				<div>
					<h3>Your week</h3>
					<p>Minutes by weekday</p>
				</div>
				<div class="chart-canvas"><canvas bind:this={weekdayCanvas}></canvas></div>
			</article>
		</div>
	{:else}
		<div class="analytics-empty">
			<span>30 DAYS / 12 MONTHS / ALL-TIME</span>
			<p>Reading history appears here after KOReader syncs its statistics database.</p>
		</div>
	{/if}
	<p class="analytics-footnote">
		Average {aggregated.averageMinutes} minutes per active day · Session history is read from KOReader
		statistics.
	</p>
</section>

<style>
	.calendar-cell:not(.is-future) {
		cursor: pointer;
	}
	.calendar-cell.is-selected {
		outline: 2px solid var(--orange, #dc6a45);
		outline-offset: 1px;
	}
	.day-detail {
		margin-top: 14px;
		padding: 12px 14px;
		border: 1px solid var(--orange, #dc6a45);
		border-radius: 10px;
	}
	.day-detail-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.day-detail-close {
		border: 0;
		background: transparent;
		color: var(--muted);
		font-size: 20px;
		line-height: 1;
		cursor: pointer;
	}
	.day-detail-sub,
	.day-detail-empty {
		margin: 4px 0 8px;
		color: var(--muted);
		font-size: 12px;
	}
	.day-detail-list {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.day-detail-list li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.day-detail-book {
		display: grid;
	}
	.day-detail-book small,
	.day-detail-list li > span {
		color: var(--muted);
		font-size: 12px;
	}
</style>
