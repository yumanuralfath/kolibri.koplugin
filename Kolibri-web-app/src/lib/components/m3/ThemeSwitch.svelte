<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';

	type Theme = 'light' | 'sepia' | 'dark';
	let theme = $state<Theme>('light');

	onMount(() => {
		const t = document.documentElement.getAttribute('data-theme');
		if (t === 'light' || t === 'sepia' || t === 'dark') theme = t;
	});

	function set(t: Theme) {
		theme = t;
		document.documentElement.setAttribute('data-theme', t);
		try {
			localStorage.setItem('kolibri-theme', t);
		} catch {
			/* penyimpanan tidak tersedia */
		}
	}
</script>

<div class="md-segmented" role="group" aria-label="Pilih tema">
	<button type="button" class="md-state" aria-pressed={theme === 'light'} onclick={() => set('light')} aria-label="Tema terang">
		<Icon name="sun" size={18} /><span>Terang</span>
	</button>
	<button type="button" class="md-state" aria-pressed={theme === 'sepia'} onclick={() => set('sepia')} aria-label="Tema sepia">
		<Icon name="book" size={18} /><span>Sepia</span>
	</button>
	<button type="button" class="md-state" aria-pressed={theme === 'dark'} onclick={() => set('dark')} aria-label="Tema gelap">
		<Icon name="moon" size={18} /><span>Gelap</span>
	</button>
</div>
