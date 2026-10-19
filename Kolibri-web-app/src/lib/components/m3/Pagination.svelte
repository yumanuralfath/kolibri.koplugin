<script lang="ts">
	import Icon from './Icon.svelte';

	let {
		page = $bindable(1),
		total,
		perPage = $bindable(12),
		options = [12, 24, 48],
		label = 'item',
		onchange
	}: {
		page: number;
		total: number;
		perPage: number;
		options?: number[];
		label?: string;
		onchange?: () => void;
	} = $props();

	let pageCount = $derived(Math.max(1, Math.ceil(total / perPage)));
	let current = $derived(Math.min(Math.max(1, page), pageCount));
	let from = $derived(total === 0 ? 0 : (current - 1) * perPage + 1);
	let to = $derived(Math.min(total, current * perPage));

	// 1 … 4 5 [6] 7 8 … 20
	let items = $derived.by(() => {
		if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
		const set = new Set([1, pageCount, current - 1, current, current + 1]);
		if (current <= 3) [2, 3, 4].forEach((n) => set.add(n));
		if (current >= pageCount - 2) [pageCount - 1, pageCount - 2, pageCount - 3].forEach((n) => set.add(n));
		const sorted = [...set].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
		const out: (number | 'gap')[] = [];
		sorted.forEach((n, i) => {
			if (i > 0 && n - sorted[i - 1] > 1) out.push('gap');
			out.push(n);
		});
		return out;
	});

	function go(n: number) {
		page = Math.min(Math.max(1, n), pageCount);
		onchange?.();
	}
</script>

{#if total > 0}
	<nav class="md-pagination" aria-label="Paginasi {label}">
		<div class="md-body-m md-num">
			{from}–{to} dari {total} {label}
		</div>

		<div class="md-pages">
			<button type="button" class="md-icon-btn md-state" disabled={current <= 1} onclick={() => go(current - 1)} aria-label="Halaman sebelumnya">
				<Icon name="left" />
			</button>
			{#each items as item, i (i)}
				{#if item === 'gap'}
					<span class="md-page-gap" aria-hidden="true">…</span>
				{:else}
					<button
						type="button"
						class="md-page-btn md-state"
						aria-current={item === current ? 'page' : undefined}
						aria-label="Halaman {item}"
						onclick={() => go(item)}
					>
						{item}
					</button>
				{/if}
			{/each}
			<button type="button" class="md-icon-btn md-state" disabled={current >= pageCount} onclick={() => go(current + 1)} aria-label="Halaman berikutnya">
				<Icon name="right" />
			</button>
		</div>

		<label class="md-select">
			<span>Per halaman</span>
			<select
				value={perPage}
				onchange={(e) => {
					perPage = Number(e.currentTarget.value);
					go(1);
				}}
			>
				{#each options as o (o)}
					<option value={o}>{o}</option>
				{/each}
			</select>
			<Icon name="down" size={18} />
		</label>
	</nav>
{/if}
