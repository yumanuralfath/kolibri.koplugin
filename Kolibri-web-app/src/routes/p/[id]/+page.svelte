<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let finished = $derived(data.books.filter((book) => book.status === 'finished').length);
	let reading = $derived(data.books.filter((book) => book.status === 'reading').length);
</script>

<svelte:head>
	<title>Reading shelf | Kolibri</title>
	<meta name="description" content="A public shelf of books being read and remembered." />
	<meta property="og:title" content="A reading shelf on Kolibri" />
	<meta property="og:description" content="Books, pages, and reading notes worth keeping." />
</svelte:head>

<main class="public-page">
	<header class="public-header">
		<a class="wordmark" href={resolve('/')} aria-label="Kolibri"
			><span class="brand-mark">K</span><span>kolibri</span></a
		>
		<span>AN OPEN BOOKSHELF · SHARED WITH CARE</span>
	</header>
	<section class="public-intro">
		<div>
			<p class="eyebrow">A PERSONAL READING LOG</p>
			<h1>Books leave<br />their mark<span>.</span></h1>
		</div>
		<p>A small collection of stories in progress and stories carried to the last page.</p>
	</section>
	<div class="public-stats" aria-label="Public bookshelf statistics">
		<div class="public-stat">
			<strong>{data.books.length.toString().padStart(2, '0')}</strong><span>BOOKS SHARED</span>
		</div>
		<div class="public-stat">
			<strong>{reading.toString().padStart(2, '0')}</strong><span>READING NOW</span>
		</div>
		<div class="public-stat">
			<strong>{finished.toString().padStart(2, '0')}</strong><span>FINISHED</span>
		</div>
	</div>
	{#if data.books.length}
		<section class="public-books" aria-label="Shared books">
			{#each data.books as book (book.id)}
				<article class="public-book">
					<div class="public-book-cover">
						{#if book.coverUrl}<img src={book.coverUrl} alt="Cover of {book.title}" />{:else}<div
								class="public-book-placeholder"
							>
								<span>{book.title}</span><small>{book.authors.join(', ') || 'KOReader'}</small>
							</div>{/if}
					</div>
					<h2>{book.title}</h2>
					<p>{book.authors.join(', ') || 'Unknown author'}</p>
					<div class="public-progress" aria-label={`${book.progress}% read`}>
						<span style={`width: ${book.progress}%`}></span>
					</div>
				</article>
			{/each}
		</section>
	{:else}
		<div class="public-empty">No books are on this shelf yet.</div>
	{/if}
	<footer class="page-footer">
		<span>KO · LIBRI <i>✳</i> YOUR READING, REMEMBERED</span><span
			>SHARED FROM A PRIVATE LIBRARY</span
		>
	</footer>
</main>
