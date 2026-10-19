<script lang="ts">
	import { onMount } from 'svelte';
	import Chart from 'chart.js/auto';
	import Icon, { type IconName } from './Icon.svelte';
	import { formatHours, type Stats } from '../../stats';

	let { stats }: { stats: Stats } = $props();

	const weekdayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
	const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];

	type Tile = { icon: IconName; label: string; value: string; hint?: string };

	let collectionTiles = $derived.by<Tile[]>(() => {
		const c = stats.counts;
		const tiles: Tile[] = [
			{ icon: 'book', label: 'Total buku', value: String(c.books), hint: `${c.reading} dibaca · ${c.finished} tamat · ${c.paused} dijeda` },
			{ icon: 'checkCircle', label: 'Buku tamat', value: String(c.finished), hint: `${c.completionRate}% dari koleksi` },
			{ icon: 'trophy', label: 'Tamat tahun ini', value: String(stats.finishedThisYear), hint: stats.finishedPages ? `${stats.finishedPages.toLocaleString('id-ID')} halaman buku tamat` : undefined }
		];
		if (stats.avgFinishDays > 0) {
			tiles.push({
				icon: 'hourglass',
				label: 'Rata-rata tamat',
				value: `${stats.avgFinishDays} hari`,
				hint: stats.fastest && stats.slowest ? `Tercepat ${stats.fastest.days} hari · terlama ${stats.slowest.days} hari` : undefined
			});
		}
		if (c.books - c.finished > 0) {
			tiles.push({ icon: 'chart', label: 'Progres rata-rata', value: `${stats.avgProgress}%`, hint: 'Pada buku yang belum tamat' });
		}
		tiles.push({
			icon: 'quote',
			label: 'Kutipan',
			value: String(stats.highlights.total),
			hint: `${stats.highlights.withNotes} dengan catatan pribadi`
		});
		return tiles;
	});

	let habitTiles = $derived.by<Tile[]>(() => {
		const tiles: Tile[] = [
			{ icon: 'clock', label: 'Total waktu baca', value: formatHours(stats.totalSeconds), hint: stats.sessionCount ? `${stats.sessionCount.toLocaleString('id-ID')} sesi tercatat` : undefined },
			{ icon: 'page', label: 'Halaman dibaca', value: stats.totalPages.toLocaleString('id-ID'), hint: stats.pagesPerHour ? `≈ ${stats.pagesPerHour} halaman per jam` : undefined },
			{ icon: 'calendar', label: 'Hari aktif', value: String(stats.activeDays), hint: stats.avgMinutesPerActiveDay ? `Rata-rata ${stats.avgMinutesPerActiveDay} menit per hari` : undefined },
			{ icon: 'flame', label: 'Streak saat ini', value: `${stats.currentStreak} hari`, hint: `Terpanjang ${stats.longestStreak} hari` },
			{ icon: 'bolt', label: '7 hari terakhir', value: formatHours(stats.last7), hint: `30 hari terakhir ${formatHours(stats.last30)}` }
		];
		if (stats.longestSession > 0) {
			tiles.push({ icon: 'speed', label: 'Sesi terpanjang', value: formatHours(stats.longestSession), hint: `Rata-rata sesi ${stats.avgSessionMinutes} menit` });
		}
		if (stats.peakHour !== null) {
			tiles.push({
				icon: 'sun',
				label: 'Jam favorit',
				value: `${String(stats.peakHour).padStart(2, '0')}.00`,
				hint: stats.favouriteBucket ? `Paling sering membaca saat ${stats.favouriteBucket.name.toLowerCase()}` : undefined
			});
		}
		if (stats.peakWeekday !== null) {
			tiles.push({ icon: 'calendar', label: 'Hari favorit', value: weekdayNames[stats.peakWeekday], hint: `Terpanjang dalam sehari ${formatHours(stats.longestDay)}` });
		}
		return tiles;
	});

	// ---------- grafik ----------
	type Tab = 'daily' | 'monthly' | 'weekday' | 'hour' | 'finished';
	const tabs: { id: Tab; label: string; caption: string }[] = [
		{ id: 'daily', label: '30 hari', caption: 'Menit membaca per hari selama 30 hari terakhir' },
		{ id: 'monthly', label: '12 bulan', caption: 'Jam membaca per bulan selama 12 bulan terakhir' },
		{ id: 'weekday', label: 'Hari', caption: 'Total menit membaca berdasarkan hari dalam seminggu' },
		{ id: 'hour', label: 'Jam', caption: 'Total menit membaca berdasarkan jam dalam sehari' },
		{ id: 'finished', label: 'Buku tamat', caption: 'Jumlah buku yang tamat per bulan (12 bulan terakhir)' }
	];
	let tab = $state<Tab>('daily');
	let canvas = $state<HTMLCanvasElement>();
	let themeTick = $state(0);
	let hasSessions = $derived(stats.sessionCount > 0);

	function series(t: Tab): { labels: string[]; data: number[]; unit: string } {
		switch (t) {
			case 'daily':
				return { labels: stats.daily30.map((d) => d.label), data: stats.daily30.map((d) => d.minutes), unit: 'menit' };
			case 'monthly':
				return { labels: stats.monthly12.map((m) => m.label), data: stats.monthly12.map((m) => m.hours), unit: 'jam' };
			case 'weekday':
				return {
					labels: weekdayOrder.map((i) => weekdayNames[i].slice(0, 3)),
					data: weekdayOrder.map((i) => Math.round(stats.weekdaySeconds[i] / 60)),
					unit: 'menit'
				};
			case 'hour':
				return {
					labels: stats.hourSeconds.map((_, h) => String(h).padStart(2, '0')),
					data: stats.hourSeconds.map((s) => Math.round(s / 60)),
					unit: 'menit'
				};
			default:
				return { labels: stats.monthly12.map((m) => m.label), data: stats.monthly12.map((m) => m.finished), unit: 'buku' };
		}
	}

	$effect(() => {
		void themeTick;
		if (!canvas) return;
		const t = tab;
		const { labels, data, unit } = series(t);
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
						ticks: { color: color('--md-on-surface-variant'), font, maxTicksLimit: t === 'daily' ? 8 : 24, maxRotation: 0 }
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
				{#each tabs as t (t.id)}
					<button type="button" role="tab" class="md-tab md-state" aria-selected={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
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
