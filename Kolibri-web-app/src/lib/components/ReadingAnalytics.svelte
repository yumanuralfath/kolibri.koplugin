<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import Chart from 'chart.js/auto';

	type ReadingSession = {
		id: string;
		bookId: string;
		page: number;
		startTime: number;
		duration: number;
		totalPages: number;
	};
	type Book = { totalReadPages?: number; totalReadTime?: number };
	let { sessions, books }: { sessions: ReadingSession[]; books: Book[] } = $props();

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

	function durationLabel(seconds: number): string {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.round((seconds % 3600) / 60);
		return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
	}

	onMount(() => {
		const shared = {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: { display: false },
				tooltip: {
					backgroundColor: '#20231f',
					padding: 10,
					titleFont: { family: 'DM Mono' },
					bodyFont: { family: 'DM Sans' }
				}
			},
			scales: {
				x: {
					grid: { display: false },
					border: { display: false },
					ticks: { color: '#777b72', maxTicksLimit: 7, font: { family: 'DM Mono', size: 9 } }
				},
				y: {
					beginAtZero: true,
					grid: { color: '#dedfd6' },
					border: { display: false },
					ticks: { color: '#777b72', precision: 0, font: { family: 'DM Mono', size: 9 } }
				}
			}
		};
		const dailyChart = new Chart('daily-reading-chart', {
			type: 'line',
			data: {
				labels: aggregated.daily.map((item) => item.label),
				datasets: [
					{
						data: aggregated.daily.map((item) => item.pages),
						borderColor: '#3b6b53',
						backgroundColor: '#3b6b5326',
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
		const monthlyChart = new Chart('monthly-reading-chart', {
			type: 'bar',
			data: {
				labels: aggregated.monthly.map((item) => item.label),
				datasets: [
					{
						data: aggregated.monthly.map((item) => item.hours),
						backgroundColor: '#dc6a45',
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
		const weekdayChart = new Chart('weekday-reading-chart', {
			type: 'bar',
			data: {
				labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
				datasets: [
					{
						data: aggregated.weekdays.map((item) => Math.round(item.seconds / 60)),
						backgroundColor: '#718f73',
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
		return () => {
			dailyChart.destroy();
			monthlyChart.destroy();
			weekdayChart.destroy();
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
	{#if sessions.length}
		<div class="chart-grid">
			<article class="chart-panel chart-panel--wide">
				<div>
					<h3>Pages read</h3>
					<p>Daily activity · last 30 days</p>
				</div>
				<div class="chart-canvas"><canvas id="daily-reading-chart"></canvas></div>
			</article>
			<article class="chart-panel">
				<div>
					<h3>Reading time</h3>
					<p>Hours by month · last 12 months</p>
				</div>
				<div class="chart-canvas"><canvas id="monthly-reading-chart"></canvas></div>
			</article>
			<article class="chart-panel">
				<div>
					<h3>Your week</h3>
					<p>Minutes by weekday</p>
				</div>
				<div class="chart-canvas"><canvas id="weekday-reading-chart"></canvas></div>
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
