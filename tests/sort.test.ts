import { describe, expect, test } from "vitest";
import mqpacker from "@/mqpacker";
import type { Options } from "@/mqpacker";
import { pack } from "./helpers";

async function order(queries: string[], sort: Options["sort"]): Promise<string[]> {
    const input = queries.map((query, i) => `@media ${query} { .a${i} { color: red } }`).join("\n");
    const { raw } = await pack(input, { sort });

    return [...raw.matchAll(/@media ([^{]+?) \{/g)].map(match => match[1]);
}

describe("sorting", () => {
    test("sorts mobile-first by default", async () => {
        const queries = ["(min-width: 1024px)", "print", "(min-width: 768px)"];
        const expected = ["(min-width: 768px)", "(min-width: 1024px)", "print"];

        expect(await order(queries, undefined)).toEqual(expected);
        expect(await order(queries, null)).toEqual(expected);
    });

    test("keeps the order of first appearance with sort: false", async () => {
        const queries = ["(min-width: 1024px)", "print", "(min-width: 768px)"];

        expect(await order(queries, false)).toEqual(queries);
    });

    test("sorts mobile-first", async () => {
        const queries = [
            "print",
            "(max-width: 767px)",
            "(min-width: 1024px)",
            "(prefers-color-scheme: dark)",
            "(max-width: 1023px)",
            "screen and (min-width: 768px)",
            "(min-width: 640px)"
        ];

        const expected = [
            "(min-width: 640px)",
            "screen and (min-width: 768px)",
            "(min-width: 1024px)",
            "print",
            "(max-width: 767px)",
            "(prefers-color-scheme: dark)",
            "(max-width: 1023px)"
        ];

        expect(await order(queries, true)).toEqual(expected);
        expect(await order(queries, "mobile-first")).toEqual(expected);
    });

    test("sorts desktop-first", async () => {
        const queries = [
            "(min-width: 768px)",
            "(max-width: 767px)",
            "print",
            "(max-width: 1023px)",
            "(min-width: 640px)"
        ];

        expect(await order(queries, "desktop-first")).toEqual([
            "(max-width: 1023px)",
            "(max-width: 767px)",
            "(min-width: 768px)",
            "print",
            "(min-width: 640px)"
        ]);
    });

    test("understands range syntax", async () => {
        const queries = [
            "(width >= 1024px)",
            "(768px <= width < 1024px)",
            "(width > 640px)",
            "(width <= 639px)",
            "(400px < width)",
            "(1280px > width)"
        ];

        expect(await order(queries, "mobile-first")).toEqual([
            "(400px < width)",
            "(width > 640px)",
            "(768px <= width < 1024px)",
            "(width >= 1024px)",
            "(width <= 639px)",
            "(1280px > width)"
        ]);

        expect(await order(queries, "desktop-first")).toEqual([
            "(1280px > width)",
            "(768px <= width < 1024px)",
            "(width <= 639px)",
            "(width >= 1024px)",
            "(width > 640px)",
            "(400px < width)"
        ]);
    });

    test("uses an exact width as both bounds", async () => {
        const queries = ["(min-width: 600px)", "(width: 500px)", "(max-width: 400px)", "(width = 700px)", "(min-width: 400px)"];

        expect(await order(queries, "mobile-first")).toEqual([
            "(min-width: 400px)",
            "(width: 500px)",
            "(min-width: 600px)",
            "(width = 700px)",
            "(max-width: 400px)"
        ]);

        expect(await order(queries, "desktop-first")).toEqual([
            "(width = 700px)",
            "(width: 500px)",
            "(max-width: 400px)",
            "(min-width: 600px)",
            "(min-width: 400px)"
        ]);
    });

    test("converts font-relative units to pixels", async () => {
        const queries = ["(min-width: 64em)", "(min-width: 1000px)", "(min-width: 40rem)", "(min-width: 0)"];

        expect(await order(queries, true)).toEqual([
            "(min-width: 0)",
            "(min-width: 40rem)",
            "(min-width: 1000px)",
            "(min-width: 64em)"
        ]);
    });

    test("accepts an explicit plus sign", async () => {
        const queries = ["(min-width: 800px)", "(min-width: +400px)"];

        expect(await order(queries, true)).toEqual(["(min-width: +400px)", "(min-width: 800px)"]);
    });

    test("uses the lowest bound of a query list", async () => {
        const queries = ["(min-width: 1024px)", "print, (min-width: 768px)", "(min-width: 900px), (min-width: 640px)"];

        expect(await order(queries, true)).toEqual([
            "(min-width: 900px), (min-width: 640px)",
            "print, (min-width: 768px)",
            "(min-width: 1024px)"
        ]);
    });

    test("does not sort negated queries and queries with unsupported values", async () => {
        const queries = [
            "not all and (min-width: 768px)",
            "(min-width: calc(100px + 1em))",
            "(min-width: 768px)",
            "(not (width < 640px))",
            "(min-width: 30vw)"
        ];

        expect(await order(queries, true)).toEqual([
            "(min-width: 768px)",
            "not all and (min-width: 768px)",
            "(min-width: calc(100px + 1em))",
            "(not (width < 640px))",
            "(min-width: 30vw)"
        ]);
    });

    test("does not sort queries with or", async () => {
        const queries = [
            "(min-width: 400px) or (orientation: landscape)",
            "(min-width: 400px)or (orientation: landscape)",
            "(min-width: 800px)"
        ];

        expect(await order(queries, true)).toEqual([
            "(min-width: 800px)",
            "(min-width: 400px) or (orientation: landscape)",
            "(min-width: 400px)or (orientation: landscape)"
        ]);
    });

    test("accepts a custom compare function", async () => {
        const queries = ["(min-width: 768px)", "print", "(min-width: 1024px)"];

        expect(await order(queries, (a, b) => b.localeCompare(a))).toEqual([
            "print",
            "(min-width: 768px)",
            "(min-width: 1024px)"
        ]);
    });

    test("sorts nested media queries", async () => {
        const { raw } = await pack(`
            @media screen {
                @media (min-width: 1024px) { .a { color: red } }
                @media (min-width: 768px) { .b { color: red } }
            }
        `, { sort: true });

        expect(raw.indexOf("(min-width: 768px)")).toBeLessThan(raw.indexOf("(min-width: 1024px)"));
    });

    test("throws on an invalid option", () => {
        expect(() => mqpacker({ sort: "ascending" as never })).toThrow(TypeError);
        expect(() => mqpacker({ sort: "" as never })).toThrow(TypeError);
        expect(() => mqpacker({ sort: 0 as never })).toThrow(TypeError);
    });
});
