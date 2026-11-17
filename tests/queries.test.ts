import { describe, expect, test } from "vitest";
import { normalize_query } from "@/queries";

describe("normalize_query", () => {
    test.each([
        ["(min-width: 768px)", "(min-width:768px)"],
        ["  ( MIN-WIDTH :  768PX )  ", "(min-width:768px)"],
        ["screen   and\n\t(min-width: 768px)", "screen and (min-width:768px)"],
        ["ONLY Screen AND (Orientation: Landscape)", "only screen and (orientation:landscape)"],
        ["screen /* comment */ and (min-width: 768px)", "screen and (min-width:768px)"],
        ["screen , print", "screen,print"],
        ["(width >= 768px)", "(width>=768px)"],
        ["(768px <= width < 1024px)", "(768px<=width<1024px)"],
        ["(width </* comment */= 768px)", "(width<=768px)"],
        ["(width < = 768px)", "(width< =768px)"],
        ["(width> =768px)", "(width> =768px)"],
        ["(width < /* comment */ = 768px)", "(width< =768px)"],
        ["(width = = 768px)", "(width==768px)"],
        ["(aspect-ratio: 16 / 9)", "(aspect-ratio:16/9)"],
        ["(--Custom-Media)", "(--Custom-Media)"],
        ["(not (width < 640px))", "(not (width<640px))"],
        ["(min-width: CALC(100px + 1em))", "(min-width:calc(100px + 1em))"],
        ["(foo: \"Bar  Baz\")", "(foo:\"Bar  Baz\")"]
    ])("%j", (query, expected) => {
        expect(normalize_query(query)).toBe(expected);
    });
});
