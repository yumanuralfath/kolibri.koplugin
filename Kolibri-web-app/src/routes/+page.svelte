<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import ReadingAnalytics from '../lib/components/ReadingAnalytics.svelte';
	import ThemeToggle from '../lib/components/ThemeToggle.svelte';
	import LocaleSwitch from '../lib/components/m3/LocaleSwitch.svelte';
	import { formatDateTime, formatDateOnly, formatDuration, getReadingDaysCount } from '../lib/utils';
	import { getLocale, t } from '../lib/i18n/i18n.svelte';

	type Highlight = {
		id: string;
		text: string;
		note?: string;
		page?: number;
		createdAt?: string;
		visible: boolean;
	};
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
		visible: boolean;
		highlights: Highlight[];
	};
	type ReadingSession = {
		id: string;
		bookId: string;
		page: number;
		startTime: number;
		duration: number;
		totalPages: number;
	};
	type Library = {
		books: Book[];
		readingSessions: ReadingSession[];
		published: boolean;
		publishId?: string;
		displayName?: string;
	};
	type Cover = { title: string; author: string; url: string };

	let library = $state<Library>({ books: [], readingSessions: [], published: false });
	let locale = $derived(getLocale());
	let displayNameDraft = $state('');
	let authenticated = $state(false);
	let setupRequired = $state(false);
	let loading = $state(true);
	let password = $state('');
	let passwordConfirm = $state('');
	let currentAdminPassword = $state('');
	let newAdminPassword = $state('');
	let newAdminPasswordConfirm = $state('');
	let errorMessage = $state('');
	let successMessage = $state('');
	let coverDrafts = $state<Record<string, string>>({});
	let coverResults = $state<Record<string, Cover[]>>({});
	let pending = $state('');
	let publicUrl = $derived(
		library.published && typeof window !== 'undefined' ? `${window.location.origin}/public` : ''
	);
	let readingBooks = $derived(library.books.filter((book) => book.status === 'reading'));
	let finishedBooks = $derived(library.books.filter((book) => book.status === 'finished'));
	let pausedBooks = $derived(library.books.filter((book) => book.status === 'paused'));
	let highlights = $derived(
		library.books.reduce((total, book) => total + book.highlights.length, 0)
	);
	let pagesRead = $derived(
		library.books.reduce((total, book) => total + (book.totalReadPages ?? book.currentPage), 0)
	);

	// Book Detail Modal State
	let selectedBookId = $state<string | null>(null);
	let selectedBook = $derived(library.books.find((b) => b.id === selectedBookId) ?? null);
	let bookModalHighlightPage = $state(1);
	const bookHighlightsPerPage = 4;

	// Highlight Inline Editing State
	let editingHighlightId = $state<string | null>(null);
	let editHighlightText = $state('');
	let editHighlightNote = $state('');

	// Collected Thoughts (In the Margins) State & Pagination
	let marginBookFilter = $state<string>('all');
	let marginVisibilityFilter = $state<'all' | 'public' | 'private'>('all');
	let marginSearchQuery = $state('');
	let marginHighlightPage = $state(1);
	const marginHighlightsPerPage = 5;

	type DisplayHighlight = Highlight & {
		bookId: string;
		bookTitle: string;
		bookAuthor: string;
	};

	let allFlatHighlights = $derived<DisplayHighlight[]>(
		library.books.flatMap((book) =>
			(book.highlights ?? []).map((h) => ({
				...h,
				bookId: book.id,
				bookTitle: book.title,
				bookAuthor: book.authors[0] ?? ''
			}))
		)
	);

	let filteredMarginHighlights = $derived.by(() => {
		let list = allFlatHighlights;

		if (marginBookFilter !== 'all') {
			list = list.filter((h) => h.bookId === marginBookFilter);
		}

		if (marginVisibilityFilter === 'public') {
			list = list.filter((h) => h.visible !== false);
		} else if (marginVisibilityFilter === 'private') {
			list = list.filter((h) => h.visible === false);
		}

		const query = marginSearchQuery.trim().toLowerCase();
		if (query) {
			list = list.filter(
				(h) =>
					h.text.toLowerCase().includes(query) ||
					(h.note && h.note.toLowerCase().includes(query)) ||
					h.bookTitle.toLowerCase().includes(query)
			);
		}

		return list.sort((a, b) => {
			const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
			const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
			return db - da;
		});
	});

	let totalMarginPages = $derived(
		Math.max(1, Math.ceil(filteredMarginHighlights.length / marginHighlightsPerPage))
	);
	let activeMarginPage = $derived(Math.min(marginHighlightPage, totalMarginPages));

	let paginatedMarginHighlights = $derived(
		filteredMarginHighlights.slice(
			(activeMarginPage - 1) * marginHighlightsPerPage,
			activeMarginPage * marginHighlightsPerPage
		)
	);

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

	type ShelfFilter = 'all' | 'reading' | 'finished' | 'paused';
	let shelfFilter = $state<ShelfFilter>('all');
	let shelfSearch = $state('');
	let shelfSortBy = $state<'progress-desc' | 'recent' | 'title' | 'progress-asc'>('progress-desc');
	let shelfPage = $state(1);
	const booksPerPage = 6;

	let processedBooks = $derived.by(() => {
		let books = [...library.books];

		if (shelfFilter !== 'all') {
			books = books.filter((b) => b.status === shelfFilter);
		}

		const query = shelfSearch.trim().toLowerCase();
		if (query) {
			books = books.filter(
				(b) =>
					b.title.toLowerCase().includes(query) ||
					b.authors.some((author) => author.toLowerCase().includes(query))
			);
		}

		if (shelfSortBy === 'progress-desc') {
			books.sort(
				(a, b) =>
					(b.progress ?? 0) - (a.progress ?? 0) ||
					new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime()
			);
		} else if (shelfSortBy === 'progress-asc') {
			books.sort(
				(a, b) =>
					(a.progress ?? 0) - (b.progress ?? 0) ||
					new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime()
			);
		} else if (shelfSortBy === 'recent') {
			books.sort((a, b) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime());
		} else if (shelfSortBy === 'title') {
			books.sort((a, b) => a.title.localeCompare(b.title));
		}

		return books;
	});

	let totalShelfPages = $derived(Math.max(1, Math.ceil(processedBooks.length / booksPerPage)));
	let activeShelfPage = $derived(Math.min(shelfPage, totalShelfPages));

	let paginatedBooks = $derived(
		processedBooks.slice((activeShelfPage - 1) * booksPerPage, activeShelfPage * booksPerPage)
	);

	function goToShelfPage(page: number) {
		shelfPage = Math.max(1, Math.min(page, totalShelfPages));
	}

	async function loadLibrary() {
		const response = await fetch('/api/manage');
		if (response.status === 401) {
			authenticated = false;
			return;
		}
		if (!response.ok) throw new Error('Tidak bisa memuat pustaka.');
		library = await response.json();
		displayNameDraft = library.displayName ?? '';
		authenticated = true;
	}

	onMount(async () => {
		try {
			const response = await fetch('/api/auth');
			const status = await response.json();
			setupRequired = Boolean(status.setupRequired);
			authenticated = Boolean(status.authenticated);
			if (authenticated) await loadLibrary();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Terjadi kesalahan.';
		} finally {
			loading = false;
		}
	});

	async function login(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = '';
		if (setupRequired && password !== passwordConfirm) {
			errorMessage = 'Password dan konfirmasi tidak sama.';
			return;
		}
		const response = await fetch('/api/auth', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password, setup: setupRequired })
		});
		const result = await response.json();
		if (!response.ok) {
			errorMessage = result.error ?? 'Gagal masuk.';
			return;
		}
		password = '';
		passwordConfirm = '';
		await loadLibrary();
	}

	async function save(patch: {
		bookId?: string;
		visible?: boolean;
		coverUrl?: string | null;
		published?: boolean;
		displayName?: string | null;
		status?: 'reading' | 'finished' | 'paused';
		finishedAt?: string;
	}) {
		pending = patch.bookId ?? (patch.displayName !== undefined ? 'display-name' : 'publish');
		try {
			const response = await fetch('/api/manage', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(patch)
			});
			if (!response.ok) throw new Error('Perubahan tidak tersimpan.');
			library = await response.json();
			if (patch.displayName !== undefined) {
				displayNameDraft = library.displayName ?? '';
				successMessage = t('settingsSaved');
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Terjadi kesalahan.';
		} finally {
			pending = '';
		}
	}

	async function updateHighlight(
		bookId: string,
		highlightId: string,
		patch: { visible?: boolean; note?: string; text?: string }
	) {
		pending = `hl-${highlightId}`;
		errorMessage = '';
		try {
			const response = await fetch('/api/manage', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					bookId,
					highlightId,
					highlight: patch
				})
			});
			if (!response.ok) throw new Error('Gagal memperbarui catatan.');
			library = await response.json();
			if (editingHighlightId === highlightId) {
				editingHighlightId = null;
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Terjadi kesalahan.';
		} finally {
			pending = '';
		}
	}

	async function setAllBookHighlightsVisible(bookId: string, visible: boolean) {
		pending = `all-hl-${bookId}`;
		errorMessage = '';
		try {
			const response = await fetch('/api/manage', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					bookId,
					setAllHighlightsVisible: visible
				})
			});
			if (!response.ok) throw new Error('Gagal memperbarui catatan.');
			library = await response.json();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Terjadi kesalahan.';
		} finally {
			pending = '';
		}
	}

	async function deleteHighlight(bookId: string, highlightId: string) {
		if (!confirm('Hapus catatan ini?')) return;
		pending = `del-hl-${highlightId}`;
		errorMessage = '';
		try {
			const response = await fetch('/api/manage', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					bookId,
					deleteHighlightId: highlightId
				})
			});
			if (!response.ok) throw new Error('Gagal menghapus catatan.');
			library = await response.json();
			if (editingHighlightId === highlightId) {
				editingHighlightId = null;
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Terjadi kesalahan.';
		} finally {
			pending = '';
		}
	}

	async function deleteBook(book: Book) {
		if (
			!confirm(
				`Hapus "${book.title}" dari web app?\n\nSemua statistik buku ini (halaman, durasi baca, riwayat sesi, dan catatan) ikut dihapus dan buku tidak akan muncul lagi saat sync berikutnya. Buku di perangkat KOReader tidak terpengaruh.`
			)
		)
			return;
		pending = `del-book-${book.id}`;
		errorMessage = '';
		try {
			const response = await fetch('/api/manage', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ bookId: book.id })
			});
			if (!response.ok) throw new Error('Gagal menghapus buku.');
			library = await response.json();
			selectedBookId = null;
			successMessage = `"${book.title}" dihapus beserta seluruh statistiknya.`;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Terjadi kesalahan.';
		} finally {
			pending = '';
		}
	}

	async function changeAdminPassword(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = '';
		successMessage = '';
		if (newAdminPassword !== newAdminPasswordConfirm) {
			errorMessage = 'Password baru dan konfirmasi tidak sama.';
			return;
		}
		const response = await fetch('/api/auth', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ currentPassword: currentAdminPassword, newPassword: newAdminPassword })
		});
		const result = await response.json();
		if (!response.ok) {
			errorMessage = result.error ?? 'Password tidak berhasil diganti.';
			return;
		}
		currentAdminPassword = '';
		newAdminPassword = '';
		newAdminPasswordConfirm = '';
		successMessage = 'Password berhasil diganti. Gunakan password baru di KOReader.';
	}

	function toDateInput(iso?: string): string {
		if (!iso) return '';
		const d = new Date(iso);
		if (isNaN(d.getTime())) return '';
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	async function setStatus(book: Book, status: Book['status']) {
		if (book.status === status) return;
		await save({ bookId: book.id, status });
	}

	async function setFinishedDate(book: Book, value: string) {
		if (!value) return;
		// pukul 12 siang lokal agar tanggal tidak bergeser karena zona waktu
		await save({ bookId: book.id, finishedAt: new Date(`${value}T12:00:00`).toISOString() });
	}

	async function shrinkImage(file: File): Promise<Blob> {
		// perkecil di browser (maks 800px sisi terpanjang) agar unggahan ringan; GIF dikirim apa adanya
		if (file.type === 'image/gif') return file;
		try {
			const bitmap = await createImageBitmap(file);
			const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(bitmap.width * scale);
			canvas.height = Math.round(bitmap.height * scale);
			const ctx = canvas.getContext('2d');
			if (!ctx) return file;
			ctx.fillStyle = '#fff';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, 'image/jpeg', 0.88)
			);
			return blob ?? file;
		} catch {
			return file;
		}
	}

	async function uploadCover(book: Book, file: File | undefined) {
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			errorMessage = 'File harus berupa gambar (JPG, PNG, WebP, GIF).';
			return;
		}
		pending = `upload-${book.id}`;
		errorMessage = '';
		try {
			const body = await shrinkImage(file);
			const response = await fetch(`/api/covers/upload?bookId=${encodeURIComponent(book.id)}`, {
				method: 'POST',
				body
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error ?? 'Upload sampul gagal.');
			library = result;
			successMessage = 'Sampul berhasil diperbarui.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Upload sampul gagal.';
		} finally {
			pending = '';
		}
	}

	async function findCovers(book: Book) {
		pending = `cover-${book.id}`;
		try {
			const response = await fetch(`/api/covers?q=${encodeURIComponent(book.title)}`);
			const result = await response.json();
			coverResults[book.id] = result.covers ?? [];
			if (!coverResults[book.id].length)
				errorMessage = 'Sampul tidak ditemukan. Coba judul lain atau isi URL manual.';
		} catch {
			errorMessage = 'Pencarian sampul gagal. Periksa koneksi internet.';
		} finally {
			pending = '';
		}
	}

	async function fetchBulkCovers() {
		pending = 'bulk-covers';
		errorMessage = '';
		successMessage = '';
		try {
			const response = await fetch('/api/covers', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ overwriteAll: false })
			});
			const result = await response.json();
			if (!response.ok) {
				throw new Error(result.error ?? 'Gagal mengambil sampul.');
			}
			if (result.library) {
				library = result.library;
			}
			successMessage = `Berhasil mendapatkan ${result.updatedCount} sampul buku otomatis!`;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Gagal memperbarui sampul.';
		} finally {
			pending = '';
		}
	}

	async function logout() {
		await fetch('/api/auth', { method: 'DELETE' });
		authenticated = false;
		library = { books: [], readingSessions: [], published: false };
	}
</script>

<svelte:head>
	<title>Kolibri | Reading room</title>
	<meta name="description" content="Reading statistics and a private book library." />
</svelte:head>

{#if loading}
	<main class="loading-screen">
		<span class="brand-mark">K</span><span>Opening your reading room</span>
	</main>
{:else if !authenticated}
	<main class="login-shell">
		<div class="login-art" aria-hidden="true">
			<div class="art-caption"><span>YOUR READING LIFE</span><span>NO. 01 / PRIVATE</span></div>
			<div class="book-stack">
				<div class="stack-book stack-book--green"><span>THE SHAPE OF THINGS</span><i>01</i></div>
				<div class="stack-book stack-book--orange"><span>NOTES FROM THE QUIET</span><i>02</i></div>
				<div class="stack-book stack-book--ink"><span>A FIELD GUIDE TO WONDER</span><i>03</i></div>
			</div>
			<p class="art-note">A little room for<br />the books that stay.</p>
		</div>
		<section class="login-panel">
			<a class="wordmark" href={resolve('/')} aria-label="Kolibri home"
				><span class="brand-mark">K</span><span>kolibri</span></a
			>
			<div class="login-copy">
				<p class="eyebrow">{setupRequired ? 'FIRST-TIME SETUP' : 'YOUR PRIVATE LIBRARY'}</p>
				<h1>
					{#if setupRequired}Make this<br />space yours.{:else}Good to<br />see you again.{/if}
				</h1>
				<p>
					{setupRequired
						? 'Create a password to protect your reading room. Your settings stay on this device.'
						: 'Enter your password to open your reading room.'}
				</p>
				<form onsubmit={login}>
					<label for="password">Password</label>
					<input
						id="password"
						type="password"
						bind:value={password}
						autocomplete={setupRequired ? 'new-password' : 'current-password'}
						minlength={setupRequired ? 12 : undefined}
						required
					/>
					{#if setupRequired}
						<label for="password-confirm">Confirm password</label>
						<input
							id="password-confirm"
							type="password"
							bind:value={passwordConfirm}
							autocomplete="new-password"
							minlength="12"
							required
						/>
					{/if}
					{#if errorMessage}<p class="form-error">{errorMessage}</p>{/if}
					<button class="button button--dark button--wide" type="submit"
						>{setupRequired ? 'Create password' : 'Open reading room'} <span>→</span></button
					>
				</form>
			</div>
			<p class="login-foot">KOReader, meet your bookshelf.</p>
		</section>
	</main>
{:else}
	<div class="app-shell">
		<header class="topbar">
			<a class="wordmark" href={resolve('/')} aria-label="Kolibri"
				><span class="brand-mark">K</span><span>kolibri</span></a
			>
			<div class="topbar-right">
				<LocaleSwitch />
				<ThemeToggle />
				<span class="connection"><i></i> KOReader connected</span>
				<details class="sync-settings">
					<summary>Account & sync</summary>
					<div class="sync-popover">
						<strong>KOReader uses your admin password</strong>
						<p>
							Enter the same password in the Kolibri plugin. Server URL: <code
								>{typeof window !== 'undefined' ? window.location.origin : ''}</code
							>
						</p>
						<form class="password-change" onsubmit={changeAdminPassword}>
							<label for="current-admin-password">Current password</label>
							<input
								id="current-admin-password"
								type="password"
								bind:value={currentAdminPassword}
								autocomplete="current-password"
								required
							/>
							<label for="new-admin-password">New password</label>
							<input
								id="new-admin-password"
								type="password"
								bind:value={newAdminPassword}
								autocomplete="new-password"
								minlength="12"
								required
							/>
							<label for="new-admin-password-confirm">Confirm new password</label>
							<input
								id="new-admin-password-confirm"
								type="password"
								bind:value={newAdminPasswordConfirm}
								autocomplete="new-password"
								minlength="12"
								required
							/>
							{#if errorMessage}<p class="form-error">{errorMessage}</p>{/if}
							{#if successMessage}<p class="form-success">{successMessage}</p>{/if}
							<button class="small-button" type="submit">Change password</button>
						</form>
						<small
							>Use HTTPS when syncing outside a trusted local network. Automatic sync runs when a
							book opens and periodically while reading.</small
						>
					</div>
				</details>
				<button class="text-button" onclick={logout}>Lock library <span>↗</span></button>
			</div>
		</header>

		<main class="dashboard">
			<section class="welcome-row">
				<div>
					<p class="eyebrow">MONDAY, YOUR READING ROOM</p>
					<h1>The story so far<span>.</span></h1>
				</div>
				<div class="publish-control">
					<div>
						<strong>{library.published ? 'Public shelf is live' : 'Private shelf'}</strong><small
							>{library.published
								? 'Anyone with your link can visit.'
								: 'Choose what the world can see.'}</small
						>
					</div>
					<button
						class:active={library.published}
						class="publish-toggle"
						aria-label={library.published ? 'Unpublish bookshelf' : 'Publish bookshelf'}
						aria-pressed={library.published}
						onclick={() => save({ published: !library.published })}
					>
						<span></span>
					</button>
				</div>
			</section>
			<section class="personalize-row">
				<label class="display-name-field">
					<span>{t('displayNameLabel')}</span>
					<small>{t('displayNameHint', { name: displayNameDraft.trim() || 'Alex' })}</small>
					<div class="display-name-input">
						<input
							type="text"
							maxlength="80"
							placeholder={t('displayNamePlaceholder')}
							bind:value={displayNameDraft}
						/>
						<button
							type="button"
							class="small-button"
							disabled={pending === 'display-name' || displayNameDraft.trim() === (library.displayName ?? '')}
							onclick={() => save({ displayName: displayNameDraft.trim() || null })}
						>
							{t('saveSettings')}
						</button>
					</div>
				</label>
			</section>
			{#if library.published && publicUrl}
				<div class="publish-link">
					<span>PUBLIC LINK</span><a href={resolve('/public')} target="_blank" rel="noreferrer"
						>{publicUrl}</a
					><button onclick={() => navigator.clipboard.writeText(publicUrl)}>Copy link</button>
				</div>
			{/if}
			{#if errorMessage}<p class="inline-error">
					{errorMessage}<button aria-label="Dismiss" onclick={() => (errorMessage = '')}>×</button>
				</p>{/if}
			{#if successMessage}<p
					class="inline-error"
					style="background: rgba(59, 107, 83, 0.15); border-color: var(--green); color: var(--green);"
				>
					{successMessage}<button aria-label="Dismiss" onclick={() => (successMessage = '')}
						>×</button
					>
				</p>{/if}

			<section class="stat-grid" aria-label="Reading statistics">
				<div class="stat-cell stat-cell--featured">
					<span class="stat-label">PAGES TURNED</span><strong>{pagesRead.toLocaleString()}</strong
					><span class="stat-note"
						>across {library.books.length} {library.books.length === 1 ? 'book' : 'books'}</span
					><span class="stat-spark" aria-hidden="true">↗</span>
				</div>
				<div class="stat-cell">
					<span class="stat-label">READING NOW</span><strong
						>{readingBooks.length.toString().padStart(2, '0')}</strong
					><span class="stat-note"
						>{readingBooks.length ? 'keep the chapter going' : 'ready for a new chapter'}</span
					>
				</div>
				<div class="stat-cell">
					<span class="stat-label">FINISHED</span><strong
						>{finishedBooks.length.toString().padStart(2, '0')}</strong
					><span class="stat-note">books from cover to cover</span>
				</div>
				<div class="stat-cell">
					<span class="stat-label">MARGIN NOTES</span><strong
						>{highlights.toString().padStart(2, '0')}</strong
					><span class="stat-note">highlights worth keeping</span>
				</div>
			</section>

			<ReadingAnalytics sessions={library.readingSessions ?? []} books={library.books} />

			<div class="content-grid">
				<section class="shelf-section">
					<div class="section-heading">
						<div>
							<p class="eyebrow">THE COLLECTION</p>
							<h2>Your bookshelf <span>{library.books.length}</span></h2>
						</div>
						<div style="display: flex; align-items: center; gap: 10px;">
							<button
								type="button"
								class="small-button"
								disabled={pending === 'bulk-covers'}
								onclick={fetchBulkCovers}
								title="Cari sampul untuk semua buku secara otomatis"
							>
								{pending === 'bulk-covers'
									? '⏳ Mencari sampul...'
									: '📚 Dapatkan Semua Sampul Otomatis'}
							</button>
							<span class="shelf-total">{pausedBooks.length} on pause</span>
						</div>
					</div>
					{#if library.books.length === 0}
						<div class="empty-shelf">
							<div class="empty-icon">↗</div>
							<h3>Your first chapter starts here.</h3>
							<p>
								Open a book in KOReader. Kolibri will bring it here with your progress and
								highlights.
							</p>
						</div>
					{:else}
						<div class="shelf-toolbar">
							<div class="shelf-toolbar-left">
								<div class="shelf-filter-group" role="tablist">
									<button
										type="button"
										class="shelf-filter-btn"
										class:active={shelfFilter === 'all'}
										onclick={() => { shelfFilter = 'all'; shelfPage = 1; }}
									>
										Semua ({library.books.length})
									</button>
									<button
										type="button"
										class="shelf-filter-btn"
										class:active={shelfFilter === 'reading'}
										onclick={() => { shelfFilter = 'reading'; shelfPage = 1; }}
									>
										Sedang Dibaca ({readingBooks.length})
									</button>
									<button
										type="button"
										class="shelf-filter-btn"
										class:active={shelfFilter === 'finished'}
										onclick={() => { shelfFilter = 'finished'; shelfPage = 1; }}
									>
										Selesai ({finishedBooks.length})
									</button>
									{#if pausedBooks.length > 0}
										<button
											type="button"
											class="shelf-filter-btn"
											class:active={shelfFilter === 'paused'}
											onclick={() => { shelfFilter = 'paused'; shelfPage = 1; }}
										>
											Dijeda ({pausedBooks.length})
										</button>
									{/if}
								</div>
							</div>
							<div class="shelf-toolbar-right">
								<div class="shelf-search">
									<input
										type="search"
										placeholder="Cari buku atau penulis..."
										bind:value={shelfSearch}
										oninput={() => { shelfPage = 1; }}
										aria-label="Cari buku"
									/>
								</div>
								<select
									class="shelf-sort-select"
									bind:value={shelfSortBy}
									onchange={() => { shelfPage = 1; }}
									aria-label="Urutkan rak buku"
								>
									<option value="progress-desc">📊 Persen Tertinggi (Default)</option>
									<option value="recent">⏱ Terakhir Dibaca</option>
									<option value="title">🔤 Judul (A-Z)</option>
									<option value="progress-asc">📉 Persen Terendah</option>
								</select>
							</div>
						</div>

						{#if processedBooks.length === 0}
							<div class="empty-shelf" style="min-height: 180px;">
								<div class="empty-icon">🔍</div>
								<h3>Tidak ada buku yang cocok.</h3>
								<p>Coba sesuaikan filter status atau kata kunci pencarian Anda.</p>
							</div>
						{:else}
							<div class="book-list">
								{#each paginatedBooks as book (book.id)}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
									<article
										class="book-row book-row-clickable"
										onclick={() => { selectedBookId = book.id; bookModalHighlightPage = 1; }}
										role="button"
										tabindex="0"
										aria-label="Buka detail membaca untuk {book.title}"
									>
										<div class="cover-frame">
											{#if book.coverUrl}<img
													src={book.coverUrl}
													alt="Cover of {book.title}"
												/>{:else}<div class="cover-placeholder">
													<span>{book.title.split(/\s+/).slice(0, 3).join(' ')}</span><i
														>{book.authors[0] ?? 'KOReader'}</i
													>
												</div>{/if}
										</div>
										<div class="book-info">
											<div class="book-title-line">
												<h3>{book.title}</h3>
												<div style="display: flex; align-items: center; gap: 8px;">
													<span
														style="font-size: 10px; font-family: var(--mono); color: var(--green); background: var(--paper-featured); padding: 2px 6px; border-radius: 3px; border: 1px solid var(--line);"
														title="Klik untuk melihat statistik detail membaca"
													>
														Statistik ↗
													</span>
													<span class="status-dot status-dot--{book.status}"></span>
												</div>
											</div>
											<p class="book-author">{book.authors.join(', ') || 'Unknown author'}</p>
											<div class="progress-line">
												<div class="progress-track">
													<span style={`width: ${book.progress}%`}></span>
												</div>
												<span>{book.progress}%</span>
											</div>
											<div class="book-meta">
												<span
													>{book.status === 'finished'
														? 'Finished'
														: book.status === 'paused'
															? 'On pause'
															: 'Reading'}</span
												><span
													>{book.currentPage.toLocaleString()}{book.totalPages
														? ` / ${book.totalPages.toLocaleString()} pages`
														: ' pages'}</span
												><span>{book.highlights.length} notes</span>
												{#if book.totalReadTime}<span>{Math.round(book.totalReadTime / 60)} min</span
													>{/if}
											</div>
											<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
											<details class="cover-editor" onclick={(e) => e.stopPropagation()}>
												<summary>Change cover</summary>
												<div class="cover-tools">
													<button
														class="small-button"
														disabled={pending === `cover-${book.id}`}
														onclick={() => findCovers(book)}
														>{pending === `cover-${book.id}`
															? 'Searching…'
															: 'Find automatically'}</button
													>
													<div class="manual-cover">
														<input
															aria-label={`Cover image URL for ${book.title}`}
															placeholder="https:// image URL"
															bind:value={coverDrafts[book.id]}
														/><button
															class="small-button"
															onclick={() =>
																save({ bookId: book.id, coverUrl: coverDrafts[book.id] || null })}
															>Save URL</button
														>
													</div>
													{#if coverResults[book.id]?.length}<div class="cover-options">
															{#each coverResults[book.id] as cover (cover.url)}<button
																	class="cover-option"
																	title={`${cover.title} — ${cover.author}`}
																	onclick={() => {
																		coverDrafts[book.id] = cover.url;
																		save({ bookId: book.id, coverUrl: cover.url });
																		coverResults[book.id] = [];
																	}}><img src={cover.url} alt="" /><span>{cover.title}</span></button
																>{/each}
														</div>{/if}
												</div>
											</details>
										</div>
										<button
											class:visible={book.visible}
											class="visibility-button"
											title={book.visible ? 'Shown on public shelf' : 'Hidden from public shelf'}
											aria-label={`${book.visible ? 'Hide' : 'Show'} ${book.title} on public shelf`}
											aria-pressed={book.visible}
											onclick={(e) => { e.stopPropagation(); save({ bookId: book.id, visible: !book.visible }); }}
											><span>{book.visible ? '◉' : '○'}</span></button
										>
									</article>
								{/each}
							</div>

							{#if totalShelfPages > 1}
								<div class="shelf-pagination">
									<span>
										Menampilkan {(activeShelfPage - 1) * booksPerPage + 1} - {Math.min(activeShelfPage * booksPerPage, processedBooks.length)} dari {processedBooks.length} buku
									</span>
									<div class="pagination-controls">
										<button
											type="button"
											class="pagination-btn"
											disabled={activeShelfPage <= 1}
											onclick={() => goToShelfPage(activeShelfPage - 1)}
											title="Halaman sebelumnya"
										>
											‹
										</button>
										{#each Array.from({ length: totalShelfPages }, (_, i) => i + 1) as pageNum}
											{#if totalShelfPages <= 7 || Math.abs(pageNum - activeShelfPage) <= 1 || pageNum === 1 || pageNum === totalShelfPages}
												<button
													type="button"
													class="pagination-btn"
													class:active={pageNum === activeShelfPage}
													onclick={() => goToShelfPage(pageNum)}
												>
													{pageNum}
												</button>
											{:else if pageNum === 2 || pageNum === totalShelfPages - 1}
												<span style="padding: 0 4px; color: var(--muted);">…</span>
											{/if}
										{/each}
										<button
											type="button"
											class="pagination-btn"
											disabled={activeShelfPage >= totalShelfPages}
											onclick={() => goToShelfPage(activeShelfPage + 1)}
											title="Halaman berikutnya"
										>
											›
										</button>
									</div>
								</div>
							{/if}
						{/if}
					{/if}
					<div class="shelf-foot">
						<span>RECENTLY OPENED</span><span
							>{library.books.length
								? new Date(library.books[0].lastReadAt).toLocaleDateString()
								: '—'}</span
						>
					</div>
				</section>

				<aside class="notes-section">
					<div class="section-heading section-heading--notes">
						<div>
							<p class="eyebrow">COLLECTED THOUGHTS</p>
							<h2>In the margins</h2>
						</div>
						<span class="note-count">{highlights.toString().padStart(2, '0')}</span>
					</div>

					<!-- Filter per book, filter visibility, search -->
					<div class="notes-controls">
						<select
							class="notes-book-select"
							bind:value={marginBookFilter}
							onchange={() => (marginHighlightPage = 1)}
							aria-label="Filter kutipan per buku"
						>
							<option value="all">📚 Semua Buku ({allFlatHighlights.length})</option>
							{#each library.books.filter((b) => b.highlights && b.highlights.length > 0) as b}
								<option value={b.id}>{b.title} ({b.highlights.length})</option>
							{/each}
						</select>

						<div class="notes-filter-row">
							<select
								class="notes-book-select"
								style="width: 45%;"
								bind:value={marginVisibilityFilter}
								onchange={() => (marginHighlightPage = 1)}
								aria-label="Filter visibilitas"
							>
								<option value="all">Semua Status</option>
								<option value="public">◉ Publik Saja</option>
								<option value="private">○ Privat Saja</option>
							</select>
							<input
								type="search"
								class="notes-search-input"
								placeholder="Cari kutipan..."
								bind:value={marginSearchQuery}
								oninput={() => (marginHighlightPage = 1)}
								aria-label="Cari catatan"
							/>
						</div>
					</div>

					{#if filteredMarginHighlights.length}
						<div class="quote-list">
							{#each paginatedMarginHighlights as note, index (note.bookId + note.id + index)}
								<blockquote class="quote-item">
									<span class="quote-mark">“</span>
									<p>{note.text}</p>
									{#if note.note}
										<p style="font-size: 11px; color: var(--muted); margin-top: -6px; margin-bottom: 8px;">
											<i>Catatan: {note.note}</i>
										</p>
									{/if}
									<footer>
										<button
											type="button"
											class="text-button"
											style="text-align: left; padding: 0; font-size: 11px; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
											onclick={() => { selectedBookId = note.bookId; bookModalHighlightPage = 1; }}
											title="Klik untuk membuka detail buku {note.bookTitle}"
										>
											<strong>{note.bookTitle}</strong>
										</button>
										<div style="display: flex; align-items: center; gap: 6px;">
											<span style="font-size: 10px; font-family: var(--mono);">{note.page ? `Hlm. ${note.page}` : ''}</span>
											<button
												type="button"
												class="highlight-visibility-badge {note.visible !== false ? 'is-public' : 'is-private'}"
												title={note.visible !== false ? 'Ditampilkan di publik (Klik untuk sembunyikan)' : 'Disembunyikan dari publik (Klik untuk publikasikan)'}
												onclick={() => updateHighlight(note.bookId, note.id, { visible: note.visible === false })}
											>
												{note.visible !== false ? '◉' : '○'}
											</button>
										</div>
									</footer>
								</blockquote>
							{/each}
						</div>

						<!-- Pagination for Highlights in the margins -->
						{#if totalMarginPages > 1}
							<div class="shelf-pagination" style="padding-top: 12px; margin-bottom: 16px;">
								<span style="font-size: 10px;">
									{(activeMarginPage - 1) * marginHighlightsPerPage + 1} - {Math.min(activeMarginPage * marginHighlightsPerPage, filteredMarginHighlights.length)} dari {filteredMarginHighlights.length}
								</span>
								<div class="pagination-controls">
									<button
										type="button"
										class="pagination-btn"
										style="min-width: 26px; height: 26px; font-size: 10px; padding: 0 6px;"
										disabled={activeMarginPage <= 1}
										onclick={() => (marginHighlightPage = activeMarginPage - 1)}
									>
										‹
									</button>
									<span style="font-family: var(--mono); font-size: 10px; padding: 0 4px;">
										{activeMarginPage} / {totalMarginPages}
									</span>
									<button
										type="button"
										class="pagination-btn"
										style="min-width: 26px; height: 26px; font-size: 10px; padding: 0 6px;"
										disabled={activeMarginPage >= totalMarginPages}
										onclick={() => (marginHighlightPage = activeMarginPage + 1)}
									>
										›
									</button>
								</div>
							</div>
						{/if}
					{:else}
						<div class="notes-empty">
							<span>“</span>
							<p>{marginSearchQuery || marginBookFilter !== 'all' ? 'Tidak ada kutipan yang cocok dengan filter.' : 'Your highlights will find a home here.'}</p>
							<small>{marginSearchQuery || marginBookFilter !== 'all' ? 'Coba ganti filter buku atau kata kunci pencarian.' : 'Mark a passage in KOReader to save it.'}</small>
						</div>
					{/if}
					<div class="reading-stamp">
						<span>KEEP TURNING</span><strong>READ<br />SLOWLY<span>.</span></strong><small
							>A good book leaves a trace.</small
						>
					</div>
				</aside>
			</div>

			<!-- Book Detail Modal -->
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
										<img src={selectedBook.coverUrl} alt="Cover of {selectedBook.title}" />
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
											{selectedBook.status === 'finished'
												? t('statusFinishedReading')
												: selectedBook.status === 'paused'
													? t('statusPaused')
													: t('statusReading')}
										</small>
									</div>
									<h2>{selectedBook.title}</h2>
									<p>{selectedBook.authors.join(', ') || t('unknownAuthor')}</p>
									<button
										type="button"
										class="highlight-visibility-badge {selectedBook.visible ? 'is-public' : 'is-private'}"
										onclick={() => save({ bookId: selectedBook.id, visible: !selectedBook.visible })}
									>
										{selectedBook.visible ? t('shownOnPublicShelf') : t('hiddenFromPublic')}
									</button>
									<div class="status-control" role="group" aria-label={t('statusReadingLabel')}>
										<span class="status-control-label">{t('statusReadingLabel')}</span>
										<div class="status-switch">
											{#each [
												['reading', t('statusReading')],
												['paused', t('statusPaused')],
												['finished', `✓ ${t('statusFinished')}`]
											] as [value, label] (value)}
												<button
													type="button"
													class="status-switch-btn"
													class:active={selectedBook.status === value}
													aria-pressed={selectedBook.status === value}
													disabled={pending === selectedBook.id}
													onclick={() => setStatus(selectedBook, value as Book['status'])}
												>
													{label}
												</button>
											{/each}
										</div>
										{#if selectedBook.status === 'finished'}
											<label class="status-date">
												<span>{t('finishDate')}</span>
												<input
													type="date"
													value={toDateInput(selectedBook.finishedAt ?? selectedBook.lastReadAt)}
													max={toDateInput(new Date().toISOString())}
													onchange={(e) => setFinishedDate(selectedBook, e.currentTarget.value)}
												/>
											</label>
										{/if}
									</div>
									<div class="modal-cover-editor">
										<span class="status-control-label">{t('bookCover')}</span>
										<div class="manual-cover">
											<input
												aria-label={`${t('imageUrl')} ${selectedBook.title}`}
												placeholder={`https:// ${t('imageUrl')}`}
												bind:value={coverDrafts[selectedBook.id]}
											/><button
												type="button"
												class="small-button"
												disabled={!coverDrafts[selectedBook.id]?.trim() || pending === selectedBook.id}
												onclick={() => {
													const url = coverDrafts[selectedBook.id].trim();
													if (!/^https?:\/\//i.test(url)) {
														errorMessage = 'URL harus diawali http:// atau https://';
														return;
													}
													save({ bookId: selectedBook.id, coverUrl: url });
												}}>{t('saveUrl')}</button
											>
										</div>
										<div class="cover-tools-row">
											<label class="small-button upload-btn" class:disabled={pending === `upload-${selectedBook.id}`}>
												{pending === `upload-${selectedBook.id}` ? t('uploading') : t('uploadImage')}
												<input
													type="file"
													accept="image/jpeg,image/png,image/webp,image/gif"
													hidden
													disabled={pending === `upload-${selectedBook.id}`}
													onchange={(e) => {
														uploadCover(selectedBook, e.currentTarget.files?.[0]);
														e.currentTarget.value = '';
													}}
												/>
											</label>
											<button
												type="button"
												class="small-button"
												disabled={pending === `cover-${selectedBook.id}`}
												onclick={() => findCovers(selectedBook)}
												>{pending === `cover-${selectedBook.id}` ? t('searching') : t('autoSearch')}</button
											>
											{#if selectedBook.coverUrl}<button
													type="button"
													class="small-button"
													onclick={() => {
														coverDrafts[selectedBook.id] = '';
														save({ bookId: selectedBook.id, coverUrl: null });
													}}>{t('removeCover')}</button
												>{/if}
										</div>
										{#if coverResults[selectedBook.id]?.length}<div class="cover-options">
												{#each coverResults[selectedBook.id] as cover (cover.url)}<button
														type="button"
														class="cover-option"
														title={`${cover.title} — ${cover.author}`}
														onclick={() => {
															coverDrafts[selectedBook.id] = cover.url;
															save({ bookId: selectedBook.id, coverUrl: cover.url });
															coverResults[selectedBook.id] = [];
														}}><img src={cover.url} alt="" /><span>{cover.title}</span></button
													>{/each}
											</div>{/if}
									</div>
									<button
										type="button"
										class="book-delete-btn"
										disabled={pending === `del-book-${selectedBook.id}`}
										onclick={() => deleteBook(selectedBook)}
									>
										{t('deleteBook')}
									</button>
								</div>
							</div>
							<button
								type="button"
								class="modal-close-btn"
								onclick={() => (selectedBookId = null)}
								aria-label={t('closeBookDetail')}
							>
								×
							</button>
						</header>

						<div class="modal-body">
							<!-- Detailed reading info grid -->
							<div class="detail-stats-grid">
								<div class="detail-stat-card detail-stat-card--highlight">
									<span class="stat-caption">{t('progressCaption')}</span>
									<strong
										>{t('page')} {selectedBook.currentPage} / {selectedBook.totalPages || '?'}</strong
									>
									<div class="progress-line" style="margin: 4px 0;">
										<div class="progress-track" style="height: 6px;">
											<span style="width: {selectedBook.progress}%"></span>
										</div>
										<span style="font-size: 11px;">{selectedBook.progress}%</span>
									</div>
									<small>
										{t('pagesRecorded', {
											n: selectedBook.totalReadPages ?? selectedBook.currentPage
										})}
									</small>
								</div>

								<div class="detail-stat-card">
									<span class="stat-caption">{t('startedCaption')}</span>
									<strong>{formatDateTime(selectedBook.startedAt, locale)}</strong>
									<small>{t('startedHint')}</small>
								</div>

								<div class="detail-stat-card">
									<span class="stat-caption">{t('durationCaption')}</span>
									<strong>{formatDuration(selectedBook.totalReadTime, locale)}</strong>
									<small>{t('durationHint')}</small>
								</div>

								<div class="detail-stat-card">
									<span class="stat-caption">{t('daysCaption')}</span>
									<strong>
										{getReadingDaysCount(
											selectedBook.startedAt,
											selectedBook.finishedAt || selectedBook.lastReadAt
										)}
										{t('days')}
									</strong>
									<small>
										{selectedBook.status === 'finished'
											? t('daysFinishedHint')
											: t('daysReadingHint')}
									</small>
								</div>

								{#if selectedBook.status === 'finished' || selectedBook.finishedAt}
									<div class="detail-stat-card" style="background: rgba(220, 106, 69, 0.08); border-color: var(--orange);">
										<span class="stat-caption" style="color: var(--orange);">{t('finishedCaption')}</span>
										<strong
											>{t('finishedOn', {
												date: formatDateTime(
													selectedBook.finishedAt || selectedBook.lastReadAt,
													locale
												)
											})}</strong
										>
										<small>
											{t('finishedTook', {
												days: getReadingDaysCount(selectedBook.startedAt, selectedBook.finishedAt),
												duration: formatDuration(selectedBook.totalReadTime, locale)
											})}
										</small>
									</div>
								{:else}
									<div class="detail-stat-card">
										<span class="stat-caption">{t('lastReadCaption')}</span>
										<strong>{formatDateTime(selectedBook.lastReadAt, locale)}</strong>
										<small>{t('lastReadHint')}</small>
									</div>
								{/if}
							</div>

							<!-- Highlights per book & Public Highlight setting -->
							<div class="modal-highlights-section">
								<div class="modal-highlights-header">
									<div>
										<h3>{t('notesAndHighlights', { n: selectedBook.highlights.length })}</h3>
										<small style="color: var(--muted); font-size: 11px;">
											{t('notesVisibilityHint')}
										</small>
									</div>
									{#if selectedBook.highlights.length > 0}
										<div style="display: flex; gap: 6px;">
											<button
												type="button"
												class="small-button"
												onclick={() => setAllBookHighlightsVisible(selectedBook.id, true)}
												title="Tampilkan semua highlight buku ini di publik"
											>
												Tampilkan Semua
											</button>
											<button
												type="button"
												class="small-button"
												onclick={() => setAllBookHighlightsVisible(selectedBook.id, false)}
												title="Sembunyikan semua highlight buku ini dari publik"
											>
												Sembunyikan Semua
											</button>
										</div>
									{/if}
								</div>

								{#if selectedBook.highlights.length === 0}
									<div style="padding: 24px; text-align: center; background: var(--paper-subtle); border-radius: 6px; border: 1px dashed var(--line); color: var(--muted); font-size: 12px;">
										Belum ada highlight atau catatan untuk buku ini. Buat highlight di KOReader untuk menyimpannya di sini.
									</div>
								{:else}
									{#each paginatedBookModalHighlights as hl (hl.id || hl.text)}
										<div class="modal-highlight-item" class:is-private={hl.visible === false}>
											{#if editingHighlightId === hl.id}
												<div style="display: flex; flex-direction: column; gap: 8px;">
													<label for="edit-hl-text-{hl.id}" style="font-size: 11px; font-weight: 600;">Teks Kutipan:</label>
													<textarea
														id="edit-hl-text-{hl.id}"
														rows="3"
														bind:value={editHighlightText}
														style="width: 100%; padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px; font-size: 12px; font-family: var(--serif);"
													></textarea>
													<label for="edit-hl-note-{hl.id}" style="font-size: 11px; font-weight: 600;">Catatan Pribadi (opsional):</label>
													<input
														id="edit-hl-note-{hl.id}"
														type="text"
														bind:value={editHighlightNote}
														placeholder="Tulis catatan..."
														style="width: 100%; padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px; font-size: 11px;"
													/>
													<div style="display: flex; gap: 6px; justify-content: flex-end; margin-top: 4px;">
														<button
															type="button"
															class="small-button"
															onclick={() => (editingHighlightId = null)}
														>
															Batal
														</button>
														<button
															type="button"
															class="small-button button--dark"
															onclick={() => updateHighlight(selectedBook.id, hl.id, { text: editHighlightText, note: editHighlightNote })}
														>
															Simpan
														</button>
													</div>
												</div>
											{:else}
												<p class="modal-highlight-text">“{hl.text}”</p>
												{#if hl.note}
													<div class="modal-highlight-note">
														<strong>Catatan:</strong> {hl.note}
													</div>
												{/if}
												<div class="modal-highlight-footer">
													<span>
														{hl.page ? `Halaman ${hl.page}` : 'Catatan'}
														{#if hl.createdAt} · {formatDateTime(hl.createdAt)}{/if}
													</span>
													<div style="display: flex; align-items: center; gap: 6px;">
														<button
															type="button"
															class="highlight-visibility-badge {hl.visible !== false ? 'is-public' : 'is-private'}"
															title="Klik untuk mengubah visibilitas publik"
															onclick={() => updateHighlight(selectedBook.id, hl.id, { visible: hl.visible === false })}
														>
															{hl.visible !== false ? '◉ Publik' : '○ Privat (Disembunyikan)'}
														</button>
														<button
															type="button"
															class="small-button"
															style="padding: 2px 7px; font-size: 10px;"
															onclick={() => {
																editingHighlightId = hl.id;
																editHighlightText = hl.text;
																editHighlightNote = hl.note ?? '';
															}}
														>
															Edit
														</button>
														<button
															type="button"
															class="small-button"
															style="padding: 2px 7px; font-size: 10px; color: var(--orange);"
															onclick={() => deleteHighlight(selectedBook.id, hl.id)}
															title="Hapus highlight ini"
														>
															Hapus
														</button>
													</div>
												</div>
											{/if}
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
				<span>KO · LIBRI <i>✳</i> YOUR READING, REMEMBERED</span><span>PRIVATE BY DEFAULT</span>
			</footer>
		</main>
	</div>
{/if}
