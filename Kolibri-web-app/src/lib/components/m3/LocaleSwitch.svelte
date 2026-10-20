<script lang="ts">
	import { getLocale, setLocale, t, type Locale } from '../../i18n/i18n.svelte';

	const locale = $derived(getLocale());

	function set(next: Locale) {
		setLocale(next);
	}
</script>

<div class="locale-switch" role="group" aria-label={t('languageLabel')}>
	<button type="button" aria-pressed={locale === 'id'} onclick={() => set('id')}>ID</button>
	<button type="button" aria-pressed={locale === 'en'} onclick={() => set('en')}>EN</button>
</div>

<style>
	.locale-switch {
		display: inline-flex;
		align-items: stretch;
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 999px;
		overflow: hidden;
		flex-shrink: 0;
	}
	.locale-switch button {
		appearance: none;
		border: 0;
		background: transparent;
		color: inherit;
		min-width: 2.25rem;
		padding: 0.35rem 0.55rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 11px;
		letter-spacing: 0.04em;
		cursor: pointer;
		opacity: 0.65;
	}
	.locale-switch button[aria-pressed='true'] {
		background: color-mix(in srgb, currentColor 14%, transparent);
		opacity: 1;
		font-weight: 600;
	}
</style>
