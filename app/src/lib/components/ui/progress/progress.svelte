<script lang="ts">
	import { Progress as ProgressPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

	// value null: indeterminate (a moving segment; static with reduced motion)
	let {
		ref = $bindable(null),
		class: className,
		max = 100,
		value,
		...restProps
	}: WithoutChildrenOrChild<ProgressPrimitive.RootProps> = $props();
</script>

<ProgressPrimitive.Root
	bind:ref
	data-slot="progress"
	class={cn("bg-muted h-1.5 rounded-full relative flex w-full items-center overflow-x-hidden", className)}
	{value}
	{max}
	{...restProps}
>
	{#if value === null}
		<div
			data-slot="progress-indicator"
			class="bg-primary h-full w-1/3 rounded-full animate-[progress-indeterminate_1.4s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40"
		></div>
	{:else}
		<div
			data-slot="progress-indicator"
			class="bg-primary size-full flex-1 transition-all"
			style="transform: translateX(-{100 - (100 * (value ?? 0)) / (max ?? 1)}%)"
		></div>
	{/if}
</ProgressPrimitive.Root>
