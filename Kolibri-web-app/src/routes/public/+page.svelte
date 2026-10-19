<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import ReadingAnalytics from '../../lib/components/ReadingAnalytics.svelte';
	import ThemeToggle from '../../lib/components/ThemeToggle.svelte';
	import { formatDateTime, formatDateOnly, formatDuration, getReadingDaysCount } from '../../lib/utils';

	type Highlight = { id?: string; text: string; note?: string; page?: number; createdAt?: string; visible?: boolean };
	type Book = {
		id: string;
		title: string;
		authors: string[];
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
		visible: boolean;
		highlights: Highlight[];
	};

	let { data }: { data: PageData } = $props();

	type FilterType = 'all' | 'reading' | 'finished' | 'paused';
	let activeFilter = $state<FilterType>('all');
	let searchQuery = $state('');
	let expandedBookId = $state<string | null>(null);

	// Book Detail Modal State
	let selectedBookId = $state<string | null>(null);
	let selectedBook = $derived((data.books as Book[]).find((b) => b.id === selectedBookId) ?? null);
	let bookModalHighlightPage = $state(1);
	const bookHighlightsPerPage = 4;

	let bookModalHighlights = $derived(selectedBook?.highlights ?? []);
	let totalBookModalHighlightPages = $derived(
		Math.max(1, Math.ceil(bookModalHighlights.length / bookHighlightsPerPage))
	);
	let activeBookModalHighlightPage = $derived(
		Math.min(bookModalHighlightPage, totalBookModalHighlightPages)
	);
	let paginatedBookModalHighlights = $derived(
		bookModalHighlights.slice(
			(activeBookModalHighlightPage - 1) * bookHighlightsPerPage,
			activeBookModalHighlightPage * bookHighlightsPerPage
		)
	);

	let finishedBooks = $derived((data.books as Book[]).filter((b: Book) => b.status === 'finished'));
	let readingBooks = $derived((data.books as Book[]).filter((b: Book) => b.status === 'reading'));
	let pausedBooks = $derived((data.books as Book[]).filter((b: Book) => b.status === 'paused'));

	let totalPagesRead = $derived(
		(data.books as Book[]).reduce(
			(total: number, b: Book) => total + (b.totalReadPages ?? b.currentPage ?? 0),
			0
		)
	);

	let totalReadingSeconds = $derived(
		(data.books as Book[]).reduce((total: number, b: Book) => total + (b.totalReadTime ?? 0), 0)
	);

	let completionRate = $derived(
		data.books.length > 0 ? Math.round((finishedBooks.length / data.books.length) * 100) : 0
	);

	let allHighlights = $derived(
		(data.books as Book[]).flatMap((book: Book) =>
			(book.highlights ?? []).map((h: Highlight) => ({
				...h,
				bookTitle: book.title,
				bookAuthor: book.authors.join(', ') || 'Unknown author',
				bookId: book.id
			}))
		)
	);

	let recentlyFinished = $derived(
		[...finishedBooks]
			.sort((a, b) => {
				const dateA = a.finishedAt ? new Date(a.finishedAt).getTime() : 0;
				const dateB = b.finishedAt ? new Date(b.finishedAt).getTime() : 0;
				return dateB - dateA;
			})
			.slice(0, 4)
	);

	let filteredBooks = $derived(
		(data.books as Book[])
			.filter((book: Book) => {
				const matchesFilter =
					activeFilter === 'all'
						? true
						: activeFilter === 'reading'
							? book.status === 'reading'
							: activeFilter === 'finished'
								? book.status === 'finished'
								: book.status === 'paused';

				const query = searchQuery.trim().toLowerCase();
				const matchesSearch =
					!query ||
					book.title.toLowerCase().includes(query) ||
					book.authors.some((author: string) => author.toLowerCase().includes(query));

				return matchesFilter && matchesSearch;
			})
			.sort(
				(a, b) =>
					(b.progress ?? 0) - (a.progress ?? 0) ||
					new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime()
			)
	);

	function toggleHighlights(bookId: string) {
		expandedBookId = expandedBookId === bookId ? null : bookId;
	}
</script>

<svelte:head>
	<title>Rak Bacaan Publik | Kolibri</title>
	<meta name="description" content="Rak buku dan catatan bacaan yang dibagikan secara terbuka." />
	<meta property="og:title" content="Rak Bacaan Kolibri" />
	<meta
		property="og:description"
		content="Buku, statistik progres baca, dan kutipan catatan bacaan."
	/>
</svelte:head>

{#if !data.published}
	<main class="public-page" style="padding-top: 80px; text-align: center;">
		<header class="public-header" style="justify-content: center; border-bottom: 0;">
			<a class="wordmark" href={resolve('/')} aria-label="Kolibri">
				<span class="brand-mark">K</span><span>kolibri</span>
			</a>
		</header>
		<div
			style="max-width: 440px; margin: 40px auto; padding: 36px 24px; background: var(--paper-card); border: 1px solid var(--line); border-radius: 6px;"
		>
			<span style="font-size: 38px; display: block; margin-bottom: 14px;">🔒</span>
			<h1 style="font-family: var(--serif); font-size: 26px; margin: 0 0 10px; color: var(--ink);">
				Rak Bacaan Bersifat Privat
			</h1>
			<p style="color: var(--muted); font-size: 13px; line-height: 1.6; margin: 0 0 24px;">
				Pemilik pustaka saat ini belum membuka rak bacaan untuk publik. Anda dapat login untuk
				membuka ruang baca pribadi.
			</p>
			<a
				href={resolve('/')}
				class="button button--dark"
				style="display: inline-flex; justify-content: center; text-decoration: none;"
			>
				Login ke Ruang Baca <span>→</span>
			</a>
		</div>
	</main>
{:else}
	<main class="public-page">
		<header class="public-header">
			<a class="wordmark" href={resolve('/')} aria-label="Kolibri">
				<span class="brand-mark">K</span><span>kolibri</span>
			</a>
			<div class="public-header-actions">
				<span class="public-header-badge">RAK BACAAN PUBLIK</span>
				<ThemeToggle />
			</div>
		</header>

		<!-- Hero Section -->
		<section class="public-intro">
			<div>
				<p class="eyebrow">A PERSONAL READING LOG</p>
				<h1>Buku meninggalkan<br />jejak cerita<span>.</span></h1>
			</div>
			<p>
				Koleksi buku yang sedang dibaca, kisah yang telah tuntas, dan catatan-catatan penting yang
				berharga.
			</p>
		</section>

		<!-- Metric Counters -->
		<div class="public-stats" aria-label="Statistik rak bacaan">
			<div class="public-stat">
				<strong>{data.books.length.toString().padStart(2, '0')}</strong>
				<span>TOTAL BUKU</span>
			</div>
			<div class="public-stat">
				<strong>{readingBooks.length.toString().padStart(2, '0')}</strong>
				<span>SEDANG DIBACA</span>
			</div>
			<div class="public-stat">
				<strong>{finishedBooks.length.toString().padStart(2, '0')}</strong>
				<span>SELESAI ({completionRate}%)</span>
			</div>
			{#if totalReadingSeconds > 0}
				<div class="public-stat">
					<strong>{formatDuration(totalReadingSeconds)}</strong>
					<span>WAKTU MEMBACA</span>
				</div>
			{/if}
			<div class="public-stat">
				<strong>{totalPagesRead.toLocaleString()}</strong>
				<span>HALAMAN DIBACA</span>
			</div>
			<div class="public-stat">
				<strong>{allHighlights.length.toString().padStart(2, '0')}</strong>
				<span>KUTIPAN & CATATAN</span>
			</div>
		</div>

		<!-- Reading Rhythm & Analytics Charts -->
		<ReadingAnalytics sessions={data.readingSessions ?? []} books={data.books} />

		<!-- Recently Finished Spotlight (Baru Selesai) -->
		{#if recentlyFinished.length > 0}
			<section class="recently-finished-section" aria-label="Buku yang baru selesai">
				<div class="recently-finished-header">
					<div>
						<p class="eyebrow" style="margin-bottom: 4px;">PENCAPAIAN TERBARU</p>
						<h3>Baru Selesai Dibaca <span>✨</span></h3>
					</div>
					<span class="shelf-total">{finishedBooks.length} buku tamat</span>
				</div>
				<div class="recent-books-row">
					{#each recentlyFinished as book (book.id)}
						<article class="recent-book-card">
							<div class="cover-frame">
								{#if book.coverUrl}
									<img src={book.coverUrl} alt="Sampul {book.title}" />
								{:else}
									<div class="cover-placeholder">
										<span>{book.title.slice(0, 20)}</span>
										<i>{book.authors[0] ?? 'Buku'}</i>
									</div>
								{/if}
							</div>
							<div class="recent-book-details">
								<h4>{book.title}</h4>
								<p>{book.authors.join(', ') || 'Penulis tidak diketahui'}</p>
								<div style="display: flex; align-items: center; gap: 8px;">
									<span class="book-status-badge book-status-badge--finished"> ✓ 100% Tamat </span>
									{#if book.finishedAt}
										<span style="color: var(--muted); font-size: 9px; font-family: var(--mono);">
											{formatDateOnly(book.finishedAt)}
										</span>
									{/if}
								</div>
							</div>
						</article>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Bookshelf Controls: Filters & Search -->
		<div class="public-toolbar">
			<div class="shelf-filter-group" role="tablist">
				<button
					type="button"
					class="shelf-filter-btn"
					class:active={activeFilter === 'all'}
					onclick={() => (activeFilter = 'all')}
				>
					Semua ({data.books.length})
				</button>
				<button
					type="button"
					class="shelf-filter-btn"
					class:active={activeFilter === 'reading'}
					onclick={() => (activeFilter = 'reading')}
				>
					Sedang Dibaca ({readingBooks.length})
				</button>
				<button
					type="button"
					class="shelf-filter-btn"
					class:active={activeFilter === 'finished'}
					onclick={() => (activeFilter = 'finished')}
				>
					Selesai ({finishedBooks.length})
				</button>
				{#if pausedBooks.length > 0}
					<button
						type="button"
						class="shelf-filter-btn"
						class:active={activeFilter === 'paused'}
						onclick={() => (activeFilter = 'paused')}
					>
						Dijeda ({pausedBooks.length})
					</button>
				{/if}
			</div>

			<div class="shelf-search">
				<input
					type="search"
					placeholder="Cari judul buku atau penulis..."
					bind:value={searchQuery}
					aria-label="Cari buku"
				/>
			</div>
		</div>

		<!-- Books Grid -->
		{#if filteredBooks.length > 0}
			<section class="public-books" aria-label="Daftar buku">
				{#each filteredBooks as book (book.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
					<article
						class="public-book book-row-clickable"
						onclick={() => { selectedBookId = book.id; bookModalHighlightPage = 1; }}
						role="button"
						tabindex="0"
						aria-label="Lihat detail membaca untuk {book.title}"
					>
						<div class="public-book-cover">
							{#if book.coverUrl}
								<img src={book.coverUrl} alt="Sampul {book.title}" loading="lazy" />
							{:else}
								<div class="public-book-placeholder">
									<span>{book.title}</span>
									<small>{book.authors.join(', ') || 'KOReader'}</small>
								</div>
							{/if}
						</div>

						<span class="book-status-badge book-status-badge--{book.status}">
							{#if book.status === 'finished'}
								✓ Selesai
							{:else if book.status === 'reading'}
								● Sedang dibaca
							{:else}
								⏸ Dijeda
							{/if}
						</span>

						<h2>{book.title}</h2>
						<p>{book.authors.join(', ') || 'Penulis tidak diketahui'}</p>

						<!-- Progress Bar -->
						<div class="public-progress" aria-label={`${book.progress}% selesai`}>
							<span style={`width: ${book.progress}%`}></span>
						</div>

						<!-- Progress Meta -->
						<div class="public-book-meta">
							<span>{book.progress}%</span>
							<span>
								{book.currentPage}{book.totalPages ? ` / ${book.totalPages} hlm` : ' hlm'}
							</span>
							{#if book.totalReadTime}
								<span>{formatDuration(book.totalReadTime)}</span>
							{/if}
						</div>

						<!-- Highlights Toggle if any -->
						{#if book.highlights && book.highlights.length > 0}
							<button
								type="button"
								class="public-highlights-toggle"
								onclick={(e) => { e.stopPropagation(); toggleHighlights(book.id); }}
							>
								💬 {book.highlights.length} Catatan / Kutipan
							</button>

							{#if expandedBookId === book.id}
								<div class="book-highlights-drawer">
									{#each book.highlights as h, idx (h.text + idx)}
										<div class="drawer-highlight-item">
											<p style="margin: 0;">“{h.text}”</p>
											{#if h.note}
												<div
													style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--line); color: var(--green);"
												>
													📝 {h.note}
												</div>
											{/if}
											<small>
												{h.page ? `Halaman ${h.page}` : `Catatan #${idx + 1}`}
												{#if h.createdAt}
													· {formatDateOnly(h.createdAt)}{/if}
											</small>
										</div>
									{/each}
								</div>
							{/if}
						{/if}
					</article>
				{/each}
			</section>
		{:else}
			<div class="public-empty">
				<p>Tidak ada buku yang sesuai dengan pencarian atau filter.</p>
			</div>
		{/if}

		<!-- Featured Quotes / Margin Notes Section -->
		{#if allHighlights.length > 0}
			<section class="public-quotes-section" aria-label="Kutipan dan Catatan Pilihan">
				<div class="section-heading">
					<div>
						<p class="eyebrow">DARI MARGIN BUKU</p>
						<h2>Catatan & Kutipan Pilihan<span>.</span></h2>
					</div>
					<span class="shelf-total">{allHighlights.length} kutipan tersimpan</span>
				</div>

				<div class="public-quotes-grid">
					{#each allHighlights.slice(0, 9) as quote, idx (quote.bookId + quote.text + idx)}
						<article class="quote-card">
							<blockquote>“{quote.text}”</blockquote>
							{#if quote.note}
								<div class="quote-note">
									<strong>Catatan:</strong>
									{quote.note}
								</div>
							{/if}
							<footer>
								<span
									title={quote.bookTitle}
									style="max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
								>
									{quote.bookTitle}
								</span>
								<span>
									{quote.page ? `Hlm. ${quote.page}` : `#${idx + 1}`}
								</span>
							</footer>
						</article>
					{/each}
				</div>
			</section>
		{/if}

		{#if selectedBook}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="modal-backdrop"
				role="dialog"
				aria-modal="true"
				tabindex="-1"
				onclick={(e) => { if (e.target === e.currentTarget) selectedBookId = null; }}
				onkeydown={(e) => { if (e.key === 'Escape') selectedBookId = null; }}
			>
				<div class="modal-window">
					<header class="modal-header">
						<div class="modal-header-book">
							<div class="modal-cover-frame">
								{#if selectedBook.coverUrl}
									<img src={selectedBook.coverUrl} alt="Sampul {selectedBook.title}" />
								{:else}
									<div class="cover-placeholder" style="height: 100%;">
										<span>{selectedBook.title.split(/\s+/).slice(0, 2).join(' ')}</span>
									</div>
								{/if}
							</div>
							<div class="modal-header-meta">
								<div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
									<span class="status-dot status-dot--{selectedBook.status}"></span>
									<small style="font-family: var(--mono); font-size: 10px; text-transform: uppercase;">
										{selectedBook.status === 'finished' ? 'Selesai Dibaca' : selectedBook.status === 'paused' ? 'Dijeda' : 'Sedang Dibaca'}
									</small>
								</div>
								<h2>{selectedBook.title}</h2>
								<p>{selectedBook.authors.join(', ') || 'Penulis tidak diketahui'}</p>
							</div>
						</div>
						<button
							type="button"
							class="modal-close-btn"
							onclick={() => (selectedBookId = null)}
							aria-label="Tutup detail buku"
						>
							×
						</button>
					</header>

					<div class="modal-body">
						<!-- Detailed stats -->
						<div class="detail-stats-grid">
							<div class="detail-stat-card detail-stat-card--highlight">
								<span class="stat-caption">📖 BACA SAMPAI MANA</span>
								<strong>Halaman {selectedBook.currentPage} / {selectedBook.totalPages || '?'}</strong>
								<div class="progress-line" style="margin: 4px 0;">
									<div class="progress-track" style="height: 6px;">
										<span style="width: {selectedBook.progress}%"></span>
									</div>
									<span style="font-size: 11px;">{selectedBook.progress}%</span>
								</div>
								<small>
									{selectedBook.totalReadPages ?? selectedBook.currentPage} halaman tercatat telah dibaca
								</small>
							</div>

							<div class="detail-stat-card">
								<span class="stat-caption">🗓 MULAI DIBACA</span>
								<strong>{formatDateTime(selectedBook.startedAt)}</strong>
								<small>Tanggal & jam pertama kali buku dibuka</small>
							</div>

							<div class="detail-stat-card">
								<span class="stat-caption">⏱ TOTAL DURASI BACA</span>
								<strong>{formatDuration(selectedBook.totalReadTime)}</strong>
								<small>Total waktu yang dihabiskan untuk membaca</small>
							</div>

							<div class="detail-stat-card">
								<span class="stat-caption">📆 HARI MEMBACA</span>
								<strong>
									{getReadingDaysCount(selectedBook.startedAt, selectedBook.finishedAt || new Date().toISOString())} hari
								</strong>
								<small>
									{selectedBook.status === 'finished' ? 'Hingga selesai dibaca' : 'Sejak awal membaca hingga sekarang'}
								</small>
							</div>

							{#if selectedBook.status === 'finished' || selectedBook.finishedAt}
								<div class="detail-stat-card" style="background: rgba(220, 106, 69, 0.08); border-color: var(--orange);">
									<span class="stat-caption" style="color: var(--orange);">✨ STATUS SELESAI</span>
									<strong>Tamat pada {formatDateTime(selectedBook.finishedAt || selectedBook.lastReadAt)}</strong>
									<small>
										Butuh waktu {getReadingDaysCount(selectedBook.startedAt, selectedBook.finishedAt)} hari
										({formatDuration(selectedBook.totalReadTime)} waktu membaca aktif)
									</small>
								</div>
							{:else}
								<div class="detail-stat-card">
									<span class="stat-caption">🕒 TERAKHIR DIBACA</span>
									<strong>{formatDateTime(selectedBook.lastReadAt)}</strong>
									<small>Sesi membaca terakhir di KOReader</small>
								</div>
							{/if}
						</div>

						<!-- Highlights per book -->
						<div class="modal-highlights-section">
							<div class="modal-highlights-header">
								<div>
									<h3>Catatan & Highlight ({selectedBook.highlights.length})</h3>
									<small style="color: var(--muted); font-size: 11px;">
										Kutipan yang dibagikan dari buku ini
									</small>
								</div>
							</div>

							{#if selectedBook.highlights.length === 0}
								<div style="padding: 24px; text-align: center; background: var(--paper-subtle); border-radius: 6px; border: 1px dashed var(--line); color: var(--muted); font-size: 12px;">
									Tidak ada kutipan yang dibagikan untuk buku ini.
								</div>
							{:else}
								{#each paginatedBookModalHighlights as hl, idx (hl.id || hl.text + idx)}
									<div class="modal-highlight-item">
										<p class="modal-highlight-text">“{hl.text}”</p>
										{#if hl.note}
											<div class="modal-highlight-note">
												<strong>Catatan:</strong> {hl.note}
											</div>
										{/if}
										<div class="modal-highlight-footer">
											<span>
												{hl.page ? `Halaman ${hl.page}` : `Kutipan #${idx + 1}`}
												{#if hl.createdAt} · {formatDateTime(hl.createdAt)}{/if}
											</span>
										</div>
									</div>
								{/each}

								{#if totalBookModalHighlightPages > 1}
									<div class="shelf-pagination" style="padding-top: 10px;">
										<span>
											Halaman {activeBookModalHighlightPage} dari {totalBookModalHighlightPages}
										</span>
										<div class="pagination-controls">
											<button
												type="button"
												class="pagination-btn"
												disabled={activeBookModalHighlightPage <= 1}
												onclick={() => (bookModalHighlightPage = activeBookModalHighlightPage - 1)}
											>
												‹
											</button>
											{#each Array.from({ length: totalBookModalHighlightPages }, (_, i) => i + 1) as p}
												<button
													type="button"
													class="pagination-btn"
													class:active={p === activeBookModalHighlightPage}
													onclick={() => (bookModalHighlightPage = p)}
												>
													{p}
												</button>
											{/each}
											<button
												type="button"
												class="pagination-btn"
												disabled={activeBookModalHighlightPage >= totalBookModalHighlightPages}
												onclick={() => (bookModalHighlightPage = activeBookModalHighlightPage + 1)}
											>
												›
											</button>
										</div>
									</div>
								{/if}
							{/if}
						</div>
					</div>
				</div>
			</div>
		{/if}

		<footer class="page-footer">
			<span>KO · LIBRI <i>✳</i> YOUR READING, REMEMBERED</span>
			<span>DIBAGIKAN DARI PUSTAKA PRIBADI</span>
		</footer>
	</main>
{/if}
