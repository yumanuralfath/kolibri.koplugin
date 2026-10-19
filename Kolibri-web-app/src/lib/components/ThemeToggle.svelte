<script lang="ts">
	import { onMount } from 'svelte';

	type Theme = 'light' | 'dark' | 'sepia';
	let currentTheme = $state<Theme>('light');

	onMount(() => {
		const docTheme = document.documentElement.getAttribute('data-theme') as Theme | null;
		if (docTheme === 'light' || docTheme === 'dark' || docTheme === 'sepia') {
			currentTheme = docTheme;
		} else {
			const saved = localStorage.getItem('kolibri-theme') as Theme | null;
			if (saved === 'light' || saved === 'dark' || saved === 'sepia') {
				currentTheme = saved;
			}
		}
	});

	function setTheme(theme: Theme) {
		currentTheme = theme;
		document.documentElement.setAttribute('data-theme', theme);
		try {
			localStorage.setItem('kolibri-theme', theme);
		} catch {
			// ignore storage access errors
		}
	}
</script>

<div class="theme-switcher" role="group" aria-label="Theme selection">
	<button
		type="button"
		class="theme-btn"
		class:active={currentTheme === 'light'}
		onclick={() => setTheme('light')}
		title="Light / Kertas Cerah"
		aria-label="Light theme"
	>
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<circle cx="12" cy="12" r="5"></circle>
			<line x1="12" y1="1" x2="12" y2="3"></line>
			<line x1="12" y1="21" x2="12" y2="23"></line>
			<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
			<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
			<line x1="1" y1="12" x2="3" y2="12"></line>
			<line x1="21" y1="12" x2="23" y2="12"></line>
			<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
			<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
		</svg>
		<span>Terang</span>
	</button>
	<button
		type="button"
		class="theme-btn"
		class:active={currentTheme === 'sepia'}
		onclick={() => setTheme('sepia')}
		title="Sepia / Kertas Klasik"
		aria-label="Sepia theme"
	>
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
			<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
		</svg>
		<span>Sepia</span>
	</button>
	<button
		type="button"
		class="theme-btn"
		class:active={currentTheme === 'dark'}
		onclick={() => setTheme('dark')}
		title="Dark / Mode Gelap"
		aria-label="Dark theme"
	>
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
		</svg>
		<span>Gelap</span>
	</button>
</div>

<style>
	.theme-switcher {
		display: inline-flex;
		align-items: center;
		padding: 2px;
		background: var(--paper-subtle, #fafaf6);
		border: 1px solid var(--line, #dedfd6);
		border-radius: 20px;
		gap: 2px;
	}
	.theme-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 10px;
		border: none;
		background: transparent;
		color: var(--muted, #777b72);
		font-family: var(--mono, monospace);
		font-size: 10px;
		letter-spacing: 0.04em;
		border-radius: 16px;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.theme-btn:hover {
		color: var(--ink, #20231f);
	}
	.theme-btn.active {
		background: var(--paper-card, #ffffff);
		color: var(--ink, #20231f);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		font-weight: 500;
	}
	@media (max-width: 600px) {
		.theme-btn span {
			display: none;
		}
		.theme-btn {
			padding: 4px 7px;
		}
	}
</style>
