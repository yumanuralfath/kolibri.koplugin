<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import '../../lib/styles/m3.css';
	import Icon from '../../lib/components/m3/Icon.svelte';
	import Pagination from '../../lib/components/m3/Pagination.svelte';
	import ThemeSwitch from '../../lib/components/m3/ThemeSwitch.svelte';
	import InsightsPanel from '../../lib/components/m3/InsightsPanel.svelte';
	import { computeStats, formatHours } from '../../lib/stats';
	import { formatDateOnly, formatDateTime, formatDuration, getReadingDaysCount } from '../../lib/utils';

	type Highlight = { id?: string; text: string; note?: string; page?: number; createdAt?: string };
	type Book = {
		id: string;
		title: string;
		authors: string[];
		series?: string;
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
		coverUrl?: string;
		highlights: Highlight[];
	};

	let { data }: { data: PageData } = $props();

	let books = $derived(data.books as Book[]);
	let stats = $derived(computeStats(books, data.readingSessions ?? []));

	// ---------- util ----------
	const statusLabel = { finished: 'Selesai', reading: 'Sedang dibaca', paused: 'Dijeda' } as const;
	const time = (iso?: string) => (iso ? Date.parse(iso) || 0 : 0);
	const authorsOf = (b: Book) => b.authors.join(', ') || 'Penulis tidak diketahui';

	function relative(iso?: string): string {
		const t = time(iso);
		if (!t) return '—';
		const diff = Math.max(0, Date.now() - t);
		const min = Math.floor(diff / 60_000);
		if (min < 1) return 'baru saja';
		if (min < 60) return `${min} menit lalu`;
		const h = Math.floor(min / 60);
		if (h < 24) return `${h} jam lalu`;
		const d = Math.floor(h / 24);
		if (d < 30) return `${d} hari lalu`;
		const mo = Math.floor(d / 30);
		return mo < 12 ? `${mo} bulan lalu` : `${Math.floor(mo / 12)} tahun lalu`;
	}

	let scrolled = $state(false);

	// ---------- rak buku ----------
	type Filter = 'all' | 'reading' | 'finished' | 'paused';
	type Sort = 'recent' | 'finished' | 'oldest' | 'progress' | 'time';
	const sortOptions: { id: Sort; label: string }[] = [
		{ id: 'recent', label: 'Terakhir dibaca' },
		{ id: 'finished', label: 'Baru selesai' },
		{ id: 'oldest', label: 'Terlama dibaca' },
		{ id: 'progress', label: 'Progres tertinggi' },
		{ id: 'time', label: 'Waktu baca terbanyak' }
	];

	let filter = $state<Filter>('all');
	let query = $state('');
	let sort = $state<Sort>('recent');
	let bookPage = $state(1);
	let bookPerPage = $state(12);
	let shelfEl = $state<HTMLElement>();
	let quotesEl = $state<HTMLElement>();

	const sorters: Record<Sort, (a: Book, b: Book) => number> = {
		recent: (a, b) => time(b.lastReadAt) - time(a.lastReadAt),
		// yang sudah selesai di depan (terbaru dulu), sisanya menurut terakhir dibaca
		finished: (a, b) => {
			const fa = a.status === 'finished' ? 1 : 0;
			const fb = b.status === 'finished' ? 1 : 0;
			if (fa !== fb) return fb - fa;
			if (fa) return time(b.finishedAt ?? b.lastReadAt) - time(a.finishedAt ?? a.lastReadAt);
			return time(b.lastReadAt) - time(a.lastReadAt);
		},
		oldest: (a, b) => time(a.lastReadAt) - time(b.lastReadAt),
		progress: (a, b) => (b.progress ?? 0) - (a.progress ?? 0) || time(b.lastReadAt) - time(a.lastReadAt),
		time: (a, b) => (b.totalReadTime ?? 0) - (a.totalReadTime ?? 0) || time(b.lastReadAt) - time(a.lastReadAt)
	};

	let filteredBooks = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return books
			.filter((b) => filter === 'all' || b.status === filter)
			.filter((b) => !q || b.title.toLowerCase().includes(q) || b.authors.some((a) => a.toLowerCase().includes(q)))
			.sort(sorters[sort]);
	});
	let bookPages = $derived(Math.max(1, Math.ceil(filteredBooks.length / bookPerPage)));
	let pagedBooks = $derived(
		filteredBooks.slice((Math.min(bookPage, bookPages) - 1) * bookPerPage, Math.min(bookPage, bookPages) * bookPerPage)
	);

	let readingNow = $derived(
		books
			.filter((b) => b.status === 'reading')
			.sort((a, b) => time(b.lastReadAt) - time(a.lastReadAt))
			.slice(0, 3)
	);

	const filters = $derived<{ id: Filter; label: string; count: number }[]>([
		{ id: 'all', label: 'Semua', count: stats.counts.books },
		{ id: 'reading', label: 'Sedang dibaca', count: stats.counts.reading },
		{ id: 'finished', label: 'Selesai', count: stats.counts.finished },
		...(stats.counts.paused ? [{ id: 'paused' as const, label: 'Dijeda', count: stats.counts.paused }] : [])
	]);

	// ---------- kutipan ----------
	type QSort = 'newest' | 'oldest' | 'book';
	let qQuery = $state('');
	let qBook = $state('all');
	let qSort = $state<QSort>('newest');
	let qNotesOnly = $state(false);
	let qPage = $state(1);
	let qPerPage = $state(6);

	let allQuotes = $derived(
		books.flatMap((b) =>
			b.highlights.map((h, i) => ({ ...h, key: `${b.id}:${h.id ?? i}`, bookId: b.id, bookTitle: b.title, ts: time(h.createdAt) }))
		)
	);
	let quoteBooks = $derived(books.filter((b) => b.highlights.length > 0).sort((a, b) => a.title.localeCompare(b.title)));
	let filteredQuotes = $derived.by(() => {
		const q = qQuery.trim().toLowerCase();
		return allQuotes
			.filter((h) => qBook === 'all' || h.bookId === qBook)
			.filter((h) => !qNotesOnly || !!h.note?.trim())
			.filter((h) => !q || h.text.toLowerCase().includes(q) || (h.note ?? '').toLowerCase().includes(q) || h.bookTitle.toLowerCase().includes(q))
			.sort((a, b) =>
				qSort === 'newest' ? b.ts - a.ts : qSort === 'oldest' ? a.ts - b.ts : a.bookTitle.localeCompare(b.bookTitle) || (a.page ?? 0) - (b.page ?? 0)
			);
	});
	let quotePages = $derived(Math.max(1, Math.ceil(filteredQuotes.length / qPerPage)));
	let pagedQuotes = $derived(
		filteredQuotes.slice((Math.min(qPage, quotePages) - 1) * qPerPage, Math.min(qPage, quotePages) * qPerPage)
	);

	// ---------- dialog detail buku ----------
	let dialogEl = $state<HTMLDialogElement>();
	let selectedId = $state<string | null>(null);
	let modalPage = $state(1);
	let modalPerPage = $state(4);
	let selected = $derived(books.find((b) => b.id === selectedId) ?? null);
	let modalQuotes = $derived.by(() => {
		if (!selected) return [];
		const pages = Math.max(1, Math.ceil(selected.highlights.length / modalPerPage));
		const current = Math.min(modalPage, pages);
		return selected.highlights.slice((current - 1) * modalPerPage, current * modalPerPage);
	});
	let selectedInfo = $derived.by(() => {
		if (!selected) return null;
		const sessions = (data.readingSessions ?? []).filter((s) => s.bookId === selected!.id);
		const seconds = selected.totalReadTime ?? 0;
		const pages = selected.totalReadPages ?? 0;
		const pph = seconds > 0 && pages > 0 ? Math.round(pages / (seconds / 3600)) : 0;
		const remaining = Math.max(0, (selected.totalPages || 0) - selected.currentPage);
		const eta = pph > 0 && selected.status !== 'finished' && remaining > 0 ? (remaining / pph) * 3600 : 0;
		return {
			sessions: sessions.length,
			pph,
			eta,
			days: getReadingDaysCount(selected.startedAt, selected.finishedAt || selected.lastReadAt)
		};
	});

	async function openBook(id: string) {
		selectedId = id;
		modalPage = 1;
		await tick(); // pastikan isi dialog sudah dirender agar fokus awal benar
		dialogEl?.showModal();
	}
	function closeBook() {
		dialogEl?.close();
	}
	function toTop(el?: HTMLElement) {
		el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}
</script>

<svelte:head>
	<title>Rak Bacaan Publik · Kolibri</title>
	<meta name="description" content="Buku yang sedang dibaca, yang sudah tamat, statistik membaca, dan kutipan favorit." />
	<meta property="og:title" content="Rak Bacaan Kolibri" />
	<meta property="og:description" content="Buku, statistik progres baca, dan kutipan catatan bacaan." />
</svelte:head>

<svelte:window onscroll={() => (scrolled = window.scrollY > 8)} />

<div class="md-root">
	<header class="md-appbar" data-scrolled={scrolled}>
		<div class="md-container md-appbar-inner">
			<a class="md-brand" href={resolve('/')} aria-label="Kolibri">
				<span class="md-brand-mark">K</span>
				<span class="md-title-l">Kolibri</span>
			</a>
			<ThemeSwitch />
		</div>
	</header>

	{#if !data.published}
		<main class="md-container private">
			<div class="md-empty private-card">
				<span class="private-icon"><Icon name="lock" size={28} /></span>
				<h1 class="md-headline-s">Rak bacaan ini privat</h1>
				<p class="md-body-l md-variant">Pemilik belum membuka rak bacaannya untuk umum. Jika ini milikmu, masuk untuk membuka ruang baca pribadi.</p>
				<a class="md-btn md-btn--filled md-state" href={resolve('/')}>Masuk ke ruang baca</a>
			</div>
		</main>
	{:else}
		<main class="md-container">
			<!-- ===== Hero ===== -->
			<section class="hero">
				<h1 class="hero-title">Rak bacaan</h1>
				<p class="md-body-l md-variant hero-text">
					Buku yang sedang dibaca, yang sudah tamat, dan kutipan yang layak diingat. Diperbarui otomatis dari KOReader.
				</p>
				<div class="hero-facts md-chips">
					<span class="md-badge md-badge--finished"><Icon name="checkCircle" size={16} />{stats.counts.finished} buku tamat</span>
					<span class="md-badge md-badge--reading"><Icon name="book" size={16} />{stats.counts.reading} sedang dibaca</span>
					{#if stats.currentStreak > 0}
						<span class="md-badge md-badge--paused"><Icon name="flame" size={16} />{stats.currentStreak} hari beruntun</span>
					{/if}
				</div>
			</section>

			<!-- ===== Sedang dibaca ===== -->
			{#if readingNow.length}
				<section class="md-section" aria-labelledby="now-title">
					<div class="md-section-head">
						<h2 id="now-title" class="md-title-l">Sedang dibaca</h2>
					</div>
					<div class="now-grid">
						{#each readingNow as b (b.id)}
							<button type="button" class="now md-card md-state" onclick={() => openBook(b.id)}>
								<span class="now-cover">
									{#if b.coverUrl}<img src={b.coverUrl} alt="" loading="lazy" />{:else}<span class="ph">{b.title.slice(0, 1)}</span>{/if}
								</span>
								<span class="now-body">
									<span class="md-title-m clamp-2">{b.title}</span>
									<span class="md-body-s md-variant clamp-1">{authorsOf(b)}</span>
									<span class="md-progress now-progress"><span style="width: {b.progress}%"></span></span>
									<span class="md-body-s md-variant md-num">
										{b.progress}% · hlm {b.currentPage}{b.totalPages ? `/${b.totalPages}` : ''} · {relative(b.lastReadAt)}
									</span>
								</span>
							</button>
						{/each}
					</div>
				</section>
			{/if}

			<!-- ===== Statistik ===== -->
			<section class="md-section" aria-labelledby="stats-title">
				<div class="md-section-head">
					<div>
						<h2 id="stats-title" class="md-title-l">Statistik membaca</h2>
						<p class="md-body-m">Ringkasan koleksi dan kebiasaan membaca dari {stats.sessionCount.toLocaleString('id-ID')} sesi tercatat.</p>
					</div>
				</div>
				<InsightsPanel {stats} />
			</section>

			<!-- ===== Rak buku ===== -->
			<section class="md-section anchor" bind:this={shelfEl} aria-labelledby="shelf-title">
				<div class="md-section-head">
					<div>
						<h2 id="shelf-title" class="md-title-l">Rak buku</h2>
						<p class="md-body-m md-num">{filteredBooks.length} dari {books.length} buku</p>
					</div>
				</div>

				<div class="toolbar">
					<label class="md-search">
						<Icon name="search" />
						<input
							type="search"
							placeholder="Cari judul atau penulis"
							aria-label="Cari buku"
							bind:value={query}
							oninput={() => (bookPage = 1)}
						/>
					</label>
					<div class="toolbar-row">
						<div class="md-chips" role="group" aria-label="Filter status">
							{#each filters as f (f.id)}
								<button
									type="button"
									class="md-chip md-state"
									aria-pressed={filter === f.id}
									onclick={() => {
										filter = f.id;
										bookPage = 1;
									}}
								>
									{#if filter === f.id}<Icon name="check" size={16} />{/if}
									{f.label} <small>{f.count}</small>
								</button>
							{/each}
						</div>
						<label class="md-select">
							<span>Urutkan</span>
							<select bind:value={sort} onchange={() => (bookPage = 1)}>
								{#each sortOptions as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
							</select>
							<Icon name="down" size={18} />
						</label>
					</div>
				</div>

				{#if pagedBooks.length}
					<ul class="book-grid">
						{#each pagedBooks as b (b.id)}
							<li>
								<button type="button" class="book md-state" onclick={() => openBook(b.id)} aria-label="Lihat detail {b.title}">
									<span class="cover">
										{#if b.coverUrl}
											<img src={b.coverUrl} alt="Sampul {b.title}" loading="lazy" />
										{:else}
											<span class="cover-ph">
												<span class="md-title-s clamp-4">{b.title}</span>
											</span>
										{/if}
									</span>
									<span class="book-meta">
										<span class="badges">
											<span class="md-badge md-badge--{b.status}">
												<Icon name={b.status === 'finished' ? 'checkCircle' : b.status === 'paused' ? 'pause' : 'book'} size={14} />
												{statusLabel[b.status]}
											</span>
											{#if b.highlights.length}
												<span class="md-badge md-badge--paused"><Icon name="quote" size={14} />{b.highlights.length}</span>
											{/if}
										</span>
										<span class="md-title-s clamp-2">{b.title}</span>
										<span class="md-body-s md-variant clamp-1">{authorsOf(b)}</span>
										<span class="md-progress"><span style="width: {b.progress}%"></span></span>
										<span class="md-body-s md-variant md-num line">
											<span>{b.progress}%</span>
											<span>hlm {b.currentPage}{b.totalPages ? `/${b.totalPages}` : ''}</span>
											{#if b.totalReadTime}<span>{formatDuration(b.totalReadTime)}</span>{/if}
										</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
					<Pagination
						bind:page={bookPage}
						bind:perPage={bookPerPage}
						total={filteredBooks.length}
						options={[12, 24, 48]}
						label="buku"
						onchange={() => toTop(shelfEl)}
					/>
				{:else}
					<div class="md-empty">
						<Icon name="search" size={28} />
						<p class="md-title-s">Tidak ada buku yang cocok</p>
						<p class="md-body-m">Coba ubah kata kunci atau filter status.</p>
					</div>
				{/if}
			</section>

			<!-- ===== Kutipan ===== -->
			{#if allQuotes.length}
				<section class="md-section anchor" bind:this={quotesEl} aria-labelledby="quotes-title">
					<div class="md-section-head">
						<div>
							<h2 id="quotes-title" class="md-title-l">Kutipan &amp; catatan</h2>
							<p class="md-body-m md-num">{filteredQuotes.length} dari {allQuotes.length} kutipan yang dibagikan</p>
						</div>
					</div>

					<div class="toolbar">
						<label class="md-search">
							<Icon name="search" />
							<input
								type="search"
								placeholder="Cari isi kutipan, catatan, atau judul"
								aria-label="Cari kutipan"
								bind:value={qQuery}
								oninput={() => (qPage = 1)}
							/>
						</label>
						<div class="toolbar-row">
							<div class="md-chips">
								<button
									type="button"
									class="md-chip md-state"
									aria-pressed={qNotesOnly}
									onclick={() => {
										qNotesOnly = !qNotesOnly;
										qPage = 1;
									}}
								>
									{#if qNotesOnly}<Icon name="check" size={16} />{/if}
									Ada catatan
								</button>
							</div>
							<div class="selects">
								<label class="md-select">
									<span>Buku</span>
									<select bind:value={qBook} onchange={() => (qPage = 1)}>
										<option value="all">Semua</option>
										{#each quoteBooks as b (b.id)}<option value={b.id}>{b.title}</option>{/each}
									</select>
									<Icon name="down" size={18} />
								</label>
								<label class="md-select">
									<span>Urutkan</span>
									<select bind:value={qSort} onchange={() => (qPage = 1)}>
										<option value="newest">Terbaru</option>
										<option value="oldest">Terlama</option>
										<option value="book">Judul buku</option>
									</select>
									<Icon name="down" size={18} />
								</label>
							</div>
						</div>
					</div>

					{#if pagedQuotes.length}
						<ul class="quote-grid">
							{#each pagedQuotes as q (q.key)}
								<li class="quote md-card md-card--filled">
									<span class="quote-mark"><Icon name="quote" size={20} /></span>
									<blockquote class="md-body-l">{q.text}</blockquote>
									{#if q.note}
										<p class="note md-body-m"><Icon name="note" size={16} /><span>{q.note}</span></p>
									{/if}
									<footer>
										<button type="button" class="link md-label-l md-state" onclick={() => openBook(q.bookId)}>{q.bookTitle}</button>
										<span class="md-body-s md-variant md-num">
											{q.page ? `Hlm ${q.page}` : ''}{q.page && q.createdAt ? ' · ' : ''}{q.createdAt ? formatDateOnly(q.createdAt) : ''}
										</span>
									</footer>
								</li>
							{/each}
						</ul>
						<Pagination
							bind:page={qPage}
							bind:perPage={qPerPage}
							total={filteredQuotes.length}
							options={[6, 12, 24]}
							label="kutipan"
							onchange={() => toTop(quotesEl)}
						/>
					{:else}
						<div class="md-empty">
							<Icon name="quote" size={28} />
							<p class="md-title-s">Tidak ada kutipan yang cocok</p>
							<p class="md-body-m">Coba ubah pencarian atau filter.</p>
						</div>
					{/if}
				</section>
			{/if}

			<footer class="foot md-body-s md-variant">
				<span>Dibagikan dari pustaka pribadi · Kolibri</span>
			</footer>
		</main>
	{/if}

	<!-- ===== Dialog detail buku ===== -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<dialog
		class="md-dialog"
		bind:this={dialogEl}
		aria-labelledby="dlg-title"
		onclose={() => (selectedId = null)}
		onclick={(e) => {
			if (e.target === e.currentTarget) closeBook();
		}}
	>
		{#if selected && selectedInfo}
			<header class="dlg-head">
				<span class="dlg-cover">
					{#if selected.coverUrl}<img src={selected.coverUrl} alt="Sampul {selected.title}" />{:else}<span class="ph">{selected.title.slice(0, 1)}</span>{/if}
				</span>
				<div class="dlg-title">
					<span class="md-badge md-badge--{selected.status}">{statusLabel[selected.status]}</span>
					<h2 id="dlg-title" class="md-headline-s">{selected.title}</h2>
					<p class="md-body-m md-variant">
						{authorsOf(selected)}{selected.series ? ` · ${selected.series}` : ''}
					</p>
				</div>
				<button type="button" class="md-icon-btn md-state close" onclick={closeBook} aria-label="Tutup"><Icon name="close" /></button>
			</header>

			<div class="dlg-body">
				<div class="dlg-progress md-card">
					<div class="line-between">
						<span class="md-title-s">Halaman {selected.currentPage}{selected.totalPages ? ` dari ${selected.totalPages}` : ''}</span>
						<span class="md-title-s md-num">{selected.progress}%</span>
					</div>
					<div class="md-progress"><span style="width: {selected.progress}%"></span></div>
					<span class="md-body-s md-variant">
						{selected.totalReadPages ?? selected.currentPage} halaman tercatat dibaca
						{#if selectedInfo.eta > 0} · perkiraan {formatHours(selectedInfo.eta)} lagi untuk tamat{/if}
					</span>
				</div>

				<dl class="facts">
					<div><dt>Mulai dibaca</dt><dd>{formatDateOnly(selected.startedAt)}</dd></div>
					{#if selected.status === 'finished'}
						<div><dt>Tamat</dt><dd>{formatDateOnly(selected.finishedAt ?? selected.lastReadAt)}</dd></div>
					{:else}
						<div><dt>Terakhir dibaca</dt><dd>{formatDateTime(selected.lastReadAt)}</dd></div>
					{/if}
					<div><dt>Total waktu baca</dt><dd>{formatDuration(selected.totalReadTime)}</dd></div>
					<div><dt>Rentang membaca</dt><dd>{selectedInfo.days} hari</dd></div>
					{#if selectedInfo.sessions}<div><dt>Sesi membaca</dt><dd>{selectedInfo.sessions}</dd></div>{/if}
					{#if selectedInfo.pph}<div><dt>Kecepatan</dt><dd>{selectedInfo.pph} halaman/jam</dd></div>{/if}
					{#if selected.language}<div><dt>Bahasa</dt><dd>{selected.language.toUpperCase()}</dd></div>{/if}
				</dl>

				<h3 class="md-title-m">Kutipan &amp; catatan ({selected.highlights.length})</h3>
				{#if selected.highlights.length === 0}
					<div class="md-empty"><p class="md-body-m">Belum ada kutipan yang dibagikan dari buku ini.</p></div>
				{:else}
					<ul class="dlg-quotes">
						{#each modalQuotes as h, i (h.id ?? `${i}-${h.text}`)}
							<li class="quote md-card md-card--filled">
								<blockquote class="md-body-m">{h.text}</blockquote>
								{#if h.note}<p class="note md-body-m"><Icon name="note" size={16} /><span>{h.note}</span></p>{/if}
								<span class="md-body-s md-variant md-num">
									{h.page ? `Hlm ${h.page}` : ''}{h.page && h.createdAt ? ' · ' : ''}{h.createdAt ? formatDateTime(h.createdAt) : ''}
								</span>
							</li>
						{/each}
					</ul>
					<Pagination bind:page={modalPage} bind:perPage={modalPerPage} total={selected.highlights.length} options={[4, 8, 12]} label="kutipan" />
				{/if}
			</div>
		{/if}
	</dialog>
</div>

<style>
	.anchor {
		scroll-margin-top: 72px;
	}
	.clamp-1,
	.clamp-2,
	.clamp-4 {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.clamp-1 { -webkit-line-clamp: 1; line-clamp: 1; }
	.clamp-2 { -webkit-line-clamp: 2; line-clamp: 2; }
	.clamp-4 { -webkit-line-clamp: 4; line-clamp: 4; }

	/* hero */
	.hero {
		padding: 32px 0 8px;
	}
	.hero-title {
		margin: 0;
		font-size: clamp(40px, 7vw, 57px);
		line-height: 1.12;
		font-weight: 400;
		letter-spacing: -0.01em;
	}
	.hero-text {
		max-width: 56ch;
		margin: 12px 0 20px;
	}

	/* sedang dibaca */
	.now-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 12px;
	}
	.now {
		display: flex;
		gap: 16px;
		padding: 12px;
		border: 0;
		text-align: left;
		cursor: pointer;
		background: var(--md-surface-container);
	}
	.now-cover {
		flex: none;
		width: 72px;
		aspect-ratio: 2 / 3;
		border-radius: var(--md-shape-s);
		overflow: hidden;
		background: var(--md-primary-container);
	}
	.now-cover img,
	.cover img,
	.dlg-cover img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.ph {
		display: grid;
		height: 100%;
		place-items: center;
		background: var(--md-primary-container);
		color: var(--md-on-primary-container);
		font-size: 24px;
		font-weight: 500;
	}
	.now-body {
		display: grid;
		flex: 1;
		min-width: 0;
		align-content: center;
		gap: 4px;
	}
	.now-progress {
		margin: 8px 0 4px;
	}

	/* toolbar */
	.toolbar {
		display: grid;
		gap: 12px;
		margin-bottom: 20px;
	}
	.toolbar-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.selects {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.selects :global(.md-select select) {
		max-width: 180px;
	}

	/* grid buku */
	.book-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
		gap: 24px 16px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.book {
		display: grid;
		width: 100%;
		gap: 12px;
		padding: 8px;
		border: 0;
		border-radius: var(--md-shape-l);
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.cover {
		display: block;
		aspect-ratio: 2 / 3;
		border-radius: var(--md-shape-m);
		overflow: hidden;
		background: var(--md-surface-high);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.18);
	}
	.cover-ph {
		display: grid;
		height: 100%;
		padding: 16px;
		place-items: center;
		background: var(--md-primary-container);
		color: var(--md-on-primary-container);
		text-align: center;
	}
	.book-meta {
		display: grid;
		gap: 4px;
		padding: 0 4px 4px;
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 4px;
	}
	.book-meta .md-progress {
		margin: 6px 0 2px;
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 8px;
	}

	/* kutipan */
	.quote-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
		gap: 16px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.quote {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px;
		background: var(--md-surface-low);
	}
	.quote-mark {
		display: grid;
		width: 36px;
		height: 36px;
		place-items: center;
		border-radius: var(--md-shape-full);
		background: var(--md-primary-container);
		color: var(--md-on-primary-container);
	}
	.quote blockquote {
		margin: 0;
		flex: 1;
		white-space: pre-line;
	}
	.note {
		display: flex;
		gap: 8px;
		margin: 0;
		padding: 10px 12px;
		border-radius: var(--md-shape-m);
		background: var(--md-secondary-container);
		color: var(--md-on-secondary-container);
	}
	.note :global(svg) {
		flex: none;
		margin-top: 2px;
	}
	.quote footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 4px 12px;
	}
	.link {
		max-width: 100%;
		margin: 0 -8px;
		padding: 4px 8px;
		overflow: hidden;
		border: 0;
		border-radius: var(--md-shape-full);
		background: transparent;
		color: var(--md-primary);
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	/* privat */
	.private {
		display: grid;
		min-height: 60vh;
		place-items: center;
	}
	.private-card {
		max-width: 440px;
		padding: 40px 28px;
	}
	.private-card h1,
	.private-card p {
		margin: 0;
	}
	.private-icon {
		display: grid;
		width: 56px;
		height: 56px;
		margin-bottom: 8px;
		place-items: center;
		border-radius: var(--md-shape-full);
		background: var(--md-secondary-container);
		color: var(--md-on-secondary-container);
	}
	.private-card .md-btn {
		margin-top: 16px;
	}

	.foot {
		padding: 56px 0 40px;
		text-align: center;
	}

	/* dialog */
	.dlg-head {
		display: flex;
		gap: 16px;
		align-items: flex-start;
		padding: 24px 16px 16px 24px;
	}
	.dlg-cover {
		flex: none;
		width: 88px;
		aspect-ratio: 2 / 3;
		border-radius: var(--md-shape-m);
		overflow: hidden;
		background: var(--md-primary-container);
	}
	.dlg-title {
		display: grid;
		flex: 1;
		min-width: 0;
		gap: 4px;
		justify-items: start;
	}
	.dlg-title h2,
	.dlg-title p {
		margin: 0;
	}
	.close {
		flex: none;
	}
	.dlg-body {
		display: grid;
		gap: 16px;
		padding: 0 24px 24px;
		overflow-y: auto;
		align-content: start;
	}
	.dlg-body h3 {
		margin: 8px 0 0;
	}
	.dlg-progress {
		display: grid;
		gap: 8px;
		padding: 16px;
		background: var(--md-surface-high);
	}
	.line-between {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 8px 16px;
		margin: 0;
	}
	.facts div {
		padding: 12px 16px;
		border: 1px solid var(--md-outline-variant);
		border-radius: var(--md-shape-m);
	}
	.facts dt {
		color: var(--md-on-surface-variant);
		font-size: 12px;
		line-height: 16px;
	}
	.facts dd {
		margin: 2px 0 0;
		font-size: 16px;
		line-height: 24px;
		font-weight: 500;
	}
	.dlg-quotes {
		display: grid;
		gap: 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.dlg-quotes .quote {
		padding: 16px;
		background: var(--md-surface-high);
	}
	.dlg-body :global(.md-pagination) {
		padding-top: 4px;
	}

	@media (max-width: 600px) {
		.book-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 16px 8px;
		}
		.quote-grid,
		.now-grid {
			grid-template-columns: 1fr;
		}
		.dlg-head {
			padding: 16px 8px 8px 16px;
		}
		.dlg-body {
			padding: 0 16px 16px;
		}
	}
</style>
