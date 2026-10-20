<script lang="ts">
	import { onMount } from 'svelte';
	import Chart from 'chart.js/auto';
	import Icon, { type IconName } from './Icon.svelte';
	import { formatHours, type Stats } from '../../stats';
	import { getLocale, t } from '../../i18n/i18n.svelte';

	let { stats }: { stats: Stats } = $props();

	const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
	let locale = $derived(getLocale());
	let localeTag = $derived(locale === 'en' ? 'en-US' : 'id-ID');
	let weekdayNames = $derived([
		t('weekdaySun'),
		t('weekdayMon'),
		t('weekdayTue'),
		t('weekdayWed'),
		t('weekdayThu'),
		t('weekdayFri'),
		t('weekdaySat')
	]);

	type Tile = { icon: IconName; label: string; value: string; hint?: string };

	let collectionTiles = $derived.by<Tile[]>(() => {
		const c = stats.counts;
		const tiles: Tile[] = [
			{
				icon: 'book',
				label: t('totalBooks'),
				value: String(c.books),
				hint: t('collectionHint', { reading: c.reading, finished: c.finished, paused: c.paused })
			},
			{
				icon: 'checkCircle',
				label: t('booksFinishedLabel'),
				value: String(c.finished),
				hint: t('completionHint', { n: c.completionRate })
			},
			{
				icon: 'trophy',
				label: t('finishedThisYear'),
				value: String(stats.finishedThisYear),
				hint: stats.finishedPages
					? t('finishedPagesHint', { n: stats.finishedPages.toLocaleString(localeTag) })
					: undefined
			}
		];
		if (stats.avgFinishDays > 0) {
			tiles.push({
				icon: 'hourglass',
				label: t('avgFinish'),
				value: `${stats.avgFinishDays} ${t('days')}`,
				hint:
					stats.fastest && stats.slowest
						? t('fastSlowHint', { fast: stats.fastest.days, slow: stats.slowest.days })
						: undefined
			});
		}
		if (c.books - c.finished > 0) {
			tiles.push({
				icon: 'chart',
				label: t('avgProgress'),
				value: `${stats.avgProgress}%`,
				hint: t('avgProgressHint')
			});
		}
		tiles.push({
			icon: 'quote',
			label: t('quotes'),
			value: String(stats.highlights.total),
			hint: t('quotesHint', { n: stats.highlights.withNotes })
		});
		return tiles;
	});

	let habitTiles = $derived.by<Tile[]>(() => {
		const tiles: Tile[] = [
			{
				icon: 'clock',
				label: t('totalReadTime'),
				value: formatHours(stats.totalSeconds, locale),
				hint: stats.sessionCount
					? t('sessionsHint', { n: stats.sessionCount.toLocaleString(localeTag) })
					: undefined
			},
			{
				icon: 'page',
				label: t('pagesRead'),
				value: stats.totalPages.toLocaleString(localeTag),
				hint: stats.pagesPerHour ? t('pagesPerHourHint', { n: stats.pagesPerHour }) : undefined
			},
			{
				icon: 'calendar',
				label: t('activeDays'),
				value: String(stats.activeDays),
				hint: stats.avgMinutesPerActiveDay
					? t('avgMinutesHint', { n: stats.avgMinutesPerActiveDay })
					: undefined
			},
			{
				icon: 'flame',
				label: t('currentStreak'),
				value: `${stats.currentStreak} ${t('days')}`,
				hint: t('longestStreakHint', { n: stats.longestStreak })
			},
			{
				icon: 'bolt',
				label: t('last7Days'),
				value: formatHours(stats.last7, locale),
				hint: t('last30Hint', { n: formatHours(stats.last30, locale) })
			}
		];
		if (stats.longestSession > 0) {
			tiles.push({
				icon: 'speed',
				label: t('longestSession'),
				value: formatHours(stats.longestSession, locale),
				hint: t('avgSessionHint', { n: stats.avgSessionMinutes })
			});
		}
		if (stats.peakHour !== null) {
			tiles.push({
				icon: 'sun',
				label: t('favouriteHour'),
				value: `${String(stats.peakHour).padStart(2, '0')}.00`,
				hint: stats.favouriteBucket
					? t('bucketHint', { name: stats.favouriteBucket.name.toLowerCase() })
					: undefined
			});
		}
		if (stats.peakWeekday !== null) {
			tiles.push({
				icon: 'calendar',
				label: t('favouriteDay'),
				value: weekdayNames[stats.peakWeekday],
				hint: t('longestDayHint', { n: formatHours(stats.longestDay, locale) })
			});
		}
		return tiles;
	});

	// ---------- grafik ----------
	type Tab = 'daily' | 'monthly' | 'weekday' | 'hour' | 'finished';
	const tabs = $derived<{ id: Tab; label: string; caption: string }[]>([
		{ id: 'daily', label: t('tabDaily'), caption: t('tabDailyCap') },
		{ id: 'monthly', label: t('tabMonthly'), caption: t('tabMonthlyCap') },
		{ id: 'weekday', label: t('tabWeekday'), caption: t('tabWeekdayCap') },
		{ id: 'hour', label: t('tabHour'), caption: t('tabHourCap') },
		{ id: 'finished', label: t('tabFinished'), caption: t('tabFinishedCap') }
	]);
	let tab = $state<Tab>('daily');
	let canvas = $state<HTMLCanvasElement>();
	let themeTick = $state(0);
	let hasSessions = $derived(stats.sessionCount > 0);

	function series(tabId: Tab): { labels: string[]; data: number[]; unit: string } {
		switch (tabId) {
			case 'daily':
				return {
					labels: stats.daily30.map((d) => d.label),
					data: stats.daily30.map((d) => d.minutes),
					unit: t('unitMinutes')
				};
			case 'monthly':
				return {
					labels: stats.monthly12.map((m) => m.label),
					data: stats.monthly12.map((m) => m.hours),
					unit: t('unitHours')
				};
			case 'weekday':
				return {
					labels: weekdayOrder.map((i) => weekdayNames[i].slice(0, 3)),
					data: weekdayOrder.map((i) => Math.round(stats.weekdaySeconds[i] / 60)),
					unit: t('unitMinutes')
				};
			case 'hour':
				return {
					labels: stats.hourSeconds.map((_, h) => String(h).padStart(2, '0')),
					data: stats.hourSeconds.map((s) => Math.round(s / 60)),
					unit: t('unitMinutes')
				};
			default:
				return {
					labels: stats.monthly12.map((m) => m.label),
					data: stats.monthly12.map((m) => m.finished),
					unit: t('unitBooks')
				};
		}
	}

	$effect(() => {
		void themeTick;
		void locale;
		if (!canvas) return;
		const activeTab = tab;
		const { labels, data, unit } = series(activeTab);
		const css = getComputedStyle(canvas);
		const color = (name: string) => css.getPropertyValue(name).trim();
		const font = { family: 'Roboto Flex, Roboto, sans-serif', size: 12 };

		const chart = new Chart(canvas, {
			type: 'bar',
			data: {
				labels,
				datasets: [
					{
						data,
						backgroundColor: color('--md-primary'),
						hoverBackgroundColor: color('--md-on-primary-container'),
						borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 },
						maxBarThickness: 28
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: { duration: 250 },
				plugins: {
					legend: { display: false },
					tooltip: {
						backgroundColor: color('--md-on-surface'),
						titleColor: color('--md-surface'),
						bodyColor: color('--md-surface'),
						cornerRadius: 8,
						padding: 10,
						displayColors: false,
						titleFont: font,
						bodyFont: font,
						callbacks: { label: (c) => `${c.parsed.y} ${unit}` }
					}
				},
				scales: {
					x: {
						grid: { display: false },
						border: { display: false },
						ticks: {
							color: color('--md-on-surface-variant'),
							font,
							maxTicksLimit: activeTab === 'daily' ? 8 : 24,
							maxRotation: 0
						}
					},
					y: {
						beginAtZero: true,
						border: { display: false },
						grid: { color: color('--md-outline-variant') },
						ticks: { color: color('--md-on-surface-variant'), font, precision: 0, maxTicksLimit: 5 }
					}
				}
			}
		});
		return () => chart.destroy();
	});

	let heatScroll = $state<HTMLDivElement>();
	let hovered = $state<(typeof stats.heatmap.weeks)[number]['cells'][number]>(null);

	onMount(() => {
		if (heatScroll) heatScroll.scrollLeft = heatScroll.scrollWidth;
		const observer = new MutationObserver(() => themeTick++);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		return () => observer.disconnect();
	});

	let bucketList = $derived.by(() => {
		const defs = [
			['Pagi', 5, 11],
			['Siang', 11, 15],
			['Sore', 15, 18],
			['Malam', 18, 29]
		] as const;
		return defs.map(([name, from, to]) => {
			let sec = 0;
			for (let h = from; h < to; h++) sec += stats.hourSeconds[h % 24];
			return { name, seconds: sec, range: `${String(from).padStart(2, '0')}–${String(to % 24).padStart(2, '0')}` };
		});
	});
	let bucketMax = $derived(Math.max(1, ...bucketList.map((b) => b.seconds)));
</script>

<div class="insights">
	<div class="group">
		<h3 class="md-title-m">Koleksi</h3>
		<div class="tiles">
			{#each collectionTiles as t (t.label)}
				<div class="tile md-card">
					<span class="tile-icon"><Icon name={t.icon} size={20} /></span>
					<span class="md-label-l md-variant">{t.label}</span>
					<strong class="md-headline-s md-num">{t.value}</strong>
					{#if t.hint}<span class="md-body-s md-variant">{t.hint}</span>{/if}
				</div>
			{/each}
		</div>
	</div>

	<div class="group">
		<h3 class="md-title-m">Kebiasaan membaca</h3>
		<div class="tiles">
			{#each habitTiles as t (t.label)}
				<div class="tile md-card">
					<span class="tile-icon"><Icon name={t.icon} size={20} /></span>
					<span class="md-label-l md-variant">{t.label}</span>
					<strong class="md-headline-s md-num">{t.value}</strong>
					{#if t.hint}<span class="md-body-s md-variant">{t.hint}</span>{/if}
				</div>
			{/each}
		</div>
	</div>

	{#if hasSessions}
		<section class="md-card md-card--outlined panel" aria-label="Grafik aktivitas">
			<div class="md-tabs" role="tablist">
				{#each tabs as item (item.id)}
					<button type="button" role="tab" class="md-tab md-state" aria-selected={tab === item.id} onclick={() => (tab = item.id)}>{item.label}</button>
				{/each}
			</div>
			<p class="md-body-m md-variant caption">{tabs.find((t) => t.id === tab)?.caption}</p>
			<div class="chart-box"><canvas bind:this={canvas}></canvas></div>
		</section>

		<section class="md-card md-card--outlined panel" aria-label="Kalender aktivitas">
			<div class="panel-head">
				<div>
					<h3 class="md-title-m">Kalender membaca</h3>
					<p class="md-body-m md-variant">
						{stats.heatmap.yearDays} hari aktif · {formatHours(stats.heatmap.yearSeconds)} dalam 12 bulan terakhir
					</p>
				</div>
			</div>
			<div class="heat-scroll" bind:this={heatScroll}>
				<div class="heat-months" aria-hidden="true">
					{#each stats.heatmap.weeks as w, i (i)}<span>{w.month ?? ''}</span>{/each}
				</div>
				<div class="heat-grid" role="grid" aria-label="Aktivitas membaca harian">
					{#each stats.heatmap.weeks as w, i (i)}
						<div class="heat-col" role="row">
							{#each w.cells as c, j (j)}
								{#if c}
									<div
										class="heat-cell lv{c.level}"
										class:future={c.future}
										class:today={c.today}
										role="gridcell"
										tabindex="-1"
										aria-label="{c.label}: {c.seconds ? formatHours(c.seconds) : 'tidak membaca'}"
										onmouseenter={() => (hovered = c)}
										onmouseleave={() => (hovered = null)}
									></div>
								{/if}
							{/each}
						</div>
					{/each}
				</div>
			</div>
			<div class="heat-foot">
				<span class="md-body-m md-variant heat-info" aria-live="polite">
					{#if hovered}
						<strong>{hovered.label}</strong> ·
						{hovered.seconds ? `${formatHours(hovered.seconds)}, ${hovered.pages} halaman` : 'tidak membaca'}
					{:else}
						Arahkan kursor ke kotak untuk melihat rinciannya.
					{/if}
				</span>
				<span class="legend md-body-s md-variant" aria-hidden="true">
					Sedikit
					{#each [0, 1, 2, 3, 4] as l (l)}<i class="heat-cell lv{l}"></i>{/each}
					Banyak
				</span>
			</div>
		</section>
	{:else}
		<div class="md-empty">
			<Icon name="chart" size={28} />
			<p class="md-title-s">Grafik aktivitas belum tersedia</p>
			<p class="md-body-m">Grafik muncul setelah KOReader menyinkronkan riwayat sesi membaca.</p>
		</div>
	{/if}

	<div class="rank-grid">
		{#if stats.topBooks.length}
			<section class="md-card md-card--outlined panel" aria-label="Buku dengan waktu baca terlama">
				<h3 class="md-title-m">Waktu baca terbanyak</h3>
				<ol class="rank">
					{#each stats.topBooks as r (r.book.id)}
						<li>
							<div class="rank-row">
								<span class="md-body-m rank-name">{r.book.title}</span>
								<span class="md-label-l md-num">{formatHours(r.seconds)}</span>
							</div>
							<div class="md-progress"><span style="width: {(r.seconds / stats.topBooks[0].seconds) * 100}%"></span></div>
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		{#if stats.topAuthors.length}
			<section class="md-card md-card--outlined panel" aria-label="Penulis terbanyak">
				<h3 class="md-title-m">Penulis teratas</h3>
				<ol class="rank">
					{#each stats.topAuthors as a (a.name)}
						<li>
							<div class="rank-row">
								<span class="md-body-m rank-name">{a.name}</span>
								<span class="md-label-l md-num">{a.books} buku</span>
							</div>
							<div class="md-progress"><span style="width: {(a.books / stats.topAuthors[0].books) * 100}%"></span></div>
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		{#if stats.favouriteBucket}
			<section class="md-card md-card--outlined panel" aria-label="Waktu membaca dalam sehari">
				<h3 class="md-title-m">Kapan biasanya membaca</h3>
				<ol class="rank">
					{#each bucketList as b (b.name)}
						<li>
							<div class="rank-row">
								<span class="md-body-m rank-name">{b.name} <span class="md-variant md-body-s">({b.range})</span></span>
								<span class="md-label-l md-num">{formatHours(b.seconds)}</span>
							</div>
							<div class="md-progress"><span style="width: {(b.seconds / bucketMax) * 100}%"></span></div>
						</li>
					{/each}
				</ol>
			</section>
		{/if}
	</div>
</div>

<style>
	.insights {
		display: grid;
		gap: 28px;
	}
	.group {
		display: grid;
		gap: 12px;
	}
	.group h3,
	.panel h3 {
		margin: 0;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
	}
	.tile {
		display: grid;
		align-content: start;
		gap: 2px;
		padding: 16px;
		background: var(--md-surface-low);
	}
	.tile-icon {
		display: grid;
		width: 36px;
		height: 36px;
		margin-bottom: 8px;
		place-items: center;
		border-radius: var(--md-shape-full);
		background: var(--md-secondary-container);
		color: var(--md-on-secondary-container);
	}
	.tile strong {
		font-weight: 500;
	}
	.panel {
		padding: 20px 20px 16px;
	}
	.panel > .md-tabs {
		margin: -4px -8px 0;
	}
	.caption {
		margin: 12px 0 8px;
	}
	.chart-box {
		position: relative;
		height: 260px;
	}
	.panel-head {
		margin-bottom: 12px;
	}
	.panel-head p {
		margin: 2px 0 0;
	}

	/* heatmap */
	.heat-scroll {
		overflow-x: auto;
		padding-bottom: 8px;
	}
	.heat-months,
	.heat-grid {
		display: flex;
		gap: 3px;
		width: max-content;
	}
	.heat-months span {
		width: 13px;
		overflow: visible;
		white-space: nowrap;
		font-size: 11px;
		line-height: 16px;
		color: var(--md-on-surface-variant);
	}
	.heat-col {
		display: grid;
		gap: 3px;
	}
	.heat-cell {
		display: block;
		width: 13px;
		height: 13px;
		border-radius: 3px;
		background: var(--md-surface-highest);
	}
	.heat-cell.lv1 { background: color-mix(in srgb, var(--md-primary) 28%, var(--md-surface-highest)); }
	.heat-cell.lv2 { background: color-mix(in srgb, var(--md-primary) 52%, var(--md-surface-highest)); }
	.heat-cell.lv3 { background: color-mix(in srgb, var(--md-primary) 76%, var(--md-surface-highest)); }
	.heat-cell.lv4 { background: var(--md-primary); }
	.heat-cell.future { visibility: hidden; }
	.heat-cell.today { outline: 2px solid var(--md-tertiary); outline-offset: 1px; }
	.heat-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 16px;
		margin-top: 8px;
	}
	.legend {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.legend .heat-cell {
		display: inline-block;
	}

	/* peringkat */
	.rank-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 16px;
	}
	.rank {
		display: grid;
		gap: 16px;
		margin: 16px 0 0;
		padding: 0;
		list-style: none;
	}
	.rank-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 6px;
	}
	.rank-grid > section,
	.rank li,
	.tile {
		min-width: 0;
	}
	.rank-row > :last-child {
		flex: none;
		white-space: nowrap;
	}
	.rank-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (max-width: 600px) {
		.tiles {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.tile {
			padding: 12px;
		}
		.tile strong {
			font-size: 20px;
			line-height: 28px;
		}
	}
</style>
