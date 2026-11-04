import { expect, test } from "bun:test";
import { compile } from "svelte/compiler";

for (const [file, count] of [
  ["screens/Band.svelte", 2],
  ["screens/PlayedForm.svelte", 1],
] as const) {
  test(`${file} compiles currency patterns that accept CZK and EUR`, async () => {
    const source = await Bun.file(new URL(file, import.meta.url)).text();
    const { js } = compile(source, { generate: "client" });
    const patterns = [...js.code.matchAll(/'pattern', "([^"]*)"/g)];
    expect(patterns).toHaveLength(count);
    for (const match of patterns) {
      const pattern = new RegExp(`^(?:${match[1]})$`, "v");
      for (const value of ["CZK", "EUR", "czk"])
        expect(pattern.test(value)).toBe(true);
      for (const value of ["C3", "CZ", "CZKK", "123"])
        expect(pattern.test(value)).toBe(false);
    }
  });
}
