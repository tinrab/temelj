if (import.meta.main) {
  await Deno.remove("npm", { recursive: true });
}
