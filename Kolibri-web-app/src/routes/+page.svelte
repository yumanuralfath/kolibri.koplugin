<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import ReadingAnalytics from '../lib/components/ReadingAnalytics.svelte';

	type Highlight = { text: string; note?: string; page?: number; createdAt?: string };
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
		lastReadAt: string;
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
	};
	type Cover = { title: string; author: string; url: string };

	let library = $state<Library>({ books: [], readingSessions: [], published: false });
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
		library.publishId && typeof window !== 'undefined'
			? `${window.location.origin}${resolve('/p/[id]', { id: library.publishId })}`
			: ''
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
	let latestHighlights = $derived(
		library.books
			.flatMap((book) => book.highlights.map((highlight) => ({ ...highlight, title: book.title })))
			.slice(-5)
			.reverse()
	);

	async function loadLibrary() {
		const response = await fetch('/api/manage');
		if (response.status === 401) {
			authenticated = false;
			return;
		}
		if (!response.ok) throw new Error('Tidak bisa memuat pustaka.');
		library = await response.json();
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
	}) {
		pending = patch.bookId ?? 'publish';
		try {
			const response = await fetch('/api/manage', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(patch)
			});
			if (!response.ok) throw new Error('Perubahan tidak tersimpan.');
			library = await response.json();
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
			{#if library.published && publicUrl}
				<div class="publish-link">
					<span>PUBLIC LINK</span><a
						href={resolve('/p/[id]', { id: library.publishId ?? '' })}
						target="_blank"
						rel="noreferrer">{publicUrl}</a
					><button onclick={() => navigator.clipboard.writeText(publicUrl)}>Copy link</button>
				</div>
			{/if}
			{#if errorMessage}<p class="inline-error">
					{errorMessage}<button aria-label="Dismiss" onclick={() => (errorMessage = '')}>×</button>
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
						<span class="shelf-total">{pausedBooks.length} on pause</span>
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
						<div class="book-list">
							{#each library.books as book (book.id)}
								<article class="book-row">
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
											<span class="status-dot status-dot--{book.status}"></span>
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
										<details class="cover-editor">
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
										onclick={() => save({ bookId: book.id, visible: !book.visible })}
										><span>{book.visible ? '◉' : '○'}</span></button
									>
								</article>
							{/each}
						</div>
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
					{#if latestHighlights.length}
						<div class="quote-list">
							{#each latestHighlights as note, index (note.title + note.text + index)}<blockquote
									class="quote-item"
								>
									<span class="quote-mark">“</span>
									<p>{note.text}</p>
									<footer>
										<span>{note.title}</span><span
											>{note.page ? `P. ${note.page}` : `0${index + 1}`}</span
										>
									</footer>
								</blockquote>{/each}
						</div>
					{:else}
						<div class="notes-empty">
							<span>“</span>
							<p>Your highlights will find a home here.</p>
							<small>Mark a passage in KOReader to save it.</small>
						</div>
					{/if}
					<div class="reading-stamp">
						<span>KEEP TURNING</span><strong>READ<br />SLOWLY<span>.</span></strong><small
							>A good book leaves a trace.</small
						>
					</div>
				</aside>
			</div>
			<footer class="page-footer">
				<span>KO · LIBRI <i>✳</i> YOUR READING, REMEMBERED</span><span>PRIVATE BY DEFAULT</span>
			</footer>
		</main>
	</div>
{/if}
