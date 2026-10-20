<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';
	import { t } from '../../i18n/i18n.svelte';

	type Theme = 'light' | 'sepia' | 'dark';
	let theme = $state<Theme>('light');

	onMount(() => {
		const current = document.documentElement.getAttribute('data-theme');
		if (current === 'light' || current === 'sepia' || current === 'dark') theme = current;
	});

	function set(next: Theme) {
		theme = next;
		document.documentElement.setAttribute('data-theme', next);
		try {
			localStorage.setItem('kolibri-theme', next);
		} catch {
			/* penyimpanan tidak tersedia */
		}
	}
</script>

<div class="md-segmented" role="group" aria-label={t('themeGroup')}>
	<button type="button" class="md-state" aria-pressed={theme === 'light'} onclick={() => set('light')} aria-label={t('themeLight')}>
		<Icon name="sun" size={18} /><span>{t('themeLight')}</span>
	</button>
	<button type="button" class="md-state" aria-pressed={theme === 'sepia'} onclick={() => set('sepia')} aria-label={t('themeSepia')}>
		<Icon name="book" size={18} /><span>{t('themeSepia')}</span>
	</button>
	<button type="button" class="md-state" aria-pressed={theme === 'dark'} onclick={() => set('dark')} aria-label={t('themeDark')}>
		<Icon name="moon" size={18} /><span>{t('themeDark')}</span>
	</button>
</div>
