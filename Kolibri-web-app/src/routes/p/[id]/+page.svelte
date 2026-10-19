<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Mengarahkan ke Rak Publik | Kolibri</title>
</svelte:head>

<main class="public-page" style="text-align: center; padding-top: 80px;">
	<p style="color: var(--muted); font-size: 14px;">
		Mengarahkan ke <a href={resolve('/public')} style="color: var(--green); font-weight: 600;"
			>/public</a
		>...
	</p>
</main>
