import { describe, expect, test } from "vitest";
import { format, pack } from "./helpers";

describe("nesting", () => {
    test("moves media queries out of style rules", async () => {
        const { css } = await pack(`
            .card { padding: 1rem; @media (width >= 768px) { padding: 2rem } }
            .button { color: red; @media (width >= 768px) { color: blue } }
        `);

        expect(css).toBe(format(`
            .card { padding: 1rem }
            .button { color: red }
            @media (width >= 768px) { .card { padding: 2rem } .button { color: blue } }
        `));
    });

    test("keeps nested selectors relative to their parents", async () => {
        const { css } = await pack(`
            .card {
                color: black;
                .title { @media (width >= 768px) { font-size: 2rem; & + p { margin: 0 } } }
                @media (width >= 768px) { &:hover { color: red } > .icon { width: 2rem } }
            }
        `);

        expect(css).toBe(format(`
            .card { color: black }
            @media (width >= 768px) {
                .card {
                    .title { font-size: 2rem; & + p { margin: 0 } }
                    &:hover { color: red }
                    > .icon { width: 2rem }
                }
            }
        `));
    });

    test("keeps selector lists and pseudo-elements of the parent rule", async () => {
        const { css } = await pack(`
            .a, #b::before { content: ""; @media (min-width: 768px) { color: red } }
        `);

        expect(css).toBe(format(`
            .a, #b::before { content: "" }
            @media (min-width: 768px) { .a, #b::before { color: red } }
        `));
    });

    test("merges pieces of the same rule back together", async () => {
        const { css } = await pack(`
            .a {
                @media (min-width: 768px) { color: red }
                padding: 0;
                @media (min-width: 768px) { margin: 0 }
            }
        `);

        expect(css).toBe(format(`
            .a { padding: 0 }
            @media (min-width: 768px) { .a { color: red; margin: 0 } }
        `));
    });

    test("does not merge different rules with the same selector", async () => {
        const { css } = await pack(`
            .a { @media (min-width: 768px) { color: red } }
            .b { color: blue }
            .a { @media (min-width: 768px) { margin: 0 } }
        `);

        expect(css).toBe(format(`
            .b { color: blue }
            @media (min-width: 768px) { .a { color: red } .a { margin: 0 } }
        `));
    });

    test("removes rules that become empty", async () => {
        const { css } = await pack(`
            .a { .b { @media (min-width: 768px) { color: red } } }
            .c { @media (min-width: 768px) { color: red } /* keep */ }
        `);

        expect(css).toBe(format(`
            .c { /* keep */ }
            @media (min-width: 768px) { .a { .b { color: red } } .c { color: red } }
        `));
    });

    test("does not copy the wrappers of empty media queries", async () => {
        const { css } = await pack(`
            .a { color: red; @media (min-width: 768px) {} }
            .b { @media (min-width: 768px) { color: blue } }
            @supports (display: grid) { .c { @media (min-width: 768px) {} } }
            .d { @media (min-width: 1024px) {} }
        `);

        expect(css).toBe(format(`
            .a { color: red }
            @media (min-width: 768px) { .b { color: blue } }
            @media (min-width: 1024px) {}
        `));
    });

    test.each(["supports (display: grid)", "container card (min-width: 400px)", "scope (.card) to (.content)", "starting-style"])(
        "moves media queries out of @%s",
        async wrapper => {
            const { css } = await pack(`
                @${wrapper} { .a { color: red } @media (min-width: 768px) { .a { color: blue } } }
                @media (min-width: 768px) { .b { color: green } }
            `);

            expect(css).toBe(format(`
                @${wrapper} { .a { color: red } }
                @media (min-width: 768px) { @${wrapper} { .a { color: blue } } .b { color: green } }
            `));
        });

    test("moves media queries out of several nested wrappers", async () => {
        const { css } = await pack(`
            @supports (display: grid) {
                .grid {
                    @container (min-width: 400px) {
                        @media (min-width: 768px) { display: grid }
                    }
                }
            }
        `);

        expect(css).toBe(format(`
            @media (min-width: 768px) {
                @supports (display: grid) { .grid { @container (min-width: 400px) { display: grid } } }
            }
        `));
    });

    test("packs nested media queries inside the packed media query", async () => {
        const { css } = await pack(`
            @media screen { .a { @media (min-width: 768px) { color: red } } }
            @media screen { .b { color: blue; @media (min-width: 768px) { color: green } } }
        `);

        expect(css).toBe(format(`
            @media screen {
                .b { color: blue }
                @media (min-width: 768px) { .a { color: red } .b { color: green } }
            }
        `));
    });

    test("does not combine nested media query lists", async () => {
        const { css } = await pack(`
            @media screen, print { @media (min-width: 768px) { .a { color: red } } }
        `);

        expect(css).toBe(format(`
            @media screen, print { @media (min-width: 768px) { .a { color: red } } }
        `));
    });

    test("leaves media queries inside unknown at-rules untouched", async () => {
        const input = `
            @mixin tablet { @media (min-width: 768px) { color: red } }
            @-moz-document url-prefix() { @media (min-width: 768px) { .a { color: red } } }
            .b { color: red }
        `;

        const { css } = await pack(input);
        expect(css).toBe(format(input));
    });

    test("keeps the trailing semicolon of the declaration that becomes the last one", async () => {
        const { raw } = await pack(".a{color:red;@media (x){color:blue}}");
        expect(raw).toBe(".a{color:red;}@media (x){.a{color:blue}}");
    });

    test("keeps the trailing semicolon when the emptied wrappers are removed", async () => {
        const { raw } = await pack(".a{color:red;.b{@supports (y){@media (x){color:blue}}}}");
        expect(raw).toBe(".a{color:red;}@media (x){.a{.b{@supports (y){color:blue}}}}");
    });

    test("keeps the trailing semicolon when only comments follow the declaration", async () => {
        const before = await pack(".a{color:red;/* c */@media (x){color:blue}}");
        expect(before.raw).toBe(".a{color:red;/* c */}@media (x){.a{color:blue}}");

        const after = await pack(".a{color:red;.b{@media (x){color:blue}}/* c */}");
        expect(after.raw).toBe(".a{color:red;/* c */}@media (x){.a{.b{color:blue}}}");
    });

    test("preserves the indentation of nested CSS", async () => {
        const { raw } = await pack([
            ".card {",
            "    padding: 1rem;",
            "",
            "    @media (width >= 768px) {",
            "        padding: 2rem;",
            "    }",
            "",
            "    .title {",
            "        font-size: 1rem;",
            "",
            "        @media (width >= 768px) {",
            "            font-size: 2rem;",
            "        }",
            "    }",
            "}",
            ""
        ].join("\n"));

        expect(raw).toBe([
            ".card {",
            "    padding: 1rem;",
            "",
            "    .title {",
            "        font-size: 1rem;",
            "    }",
            "}",
            "",
            "@media (width >= 768px) {",
            "    .card {",
            "        padding: 2rem;",
            "",
            "        .title {",
            "            font-size: 2rem;",
            "        }",
            "    }",
            "}",
            ""
        ].join("\n"));
    });

    test("takes the closing whitespace of the packed rule from the outermost wrapper", async () => {
        const { raw } = await pack([
            ".a { color: red }",
            ".card {",
            "    @media (width >= 768px) {",
            "        padding: 2rem;",
            "    }",
            "}",
            ""
        ].join("\n"));

        expect(raw).toBe([
            ".a { color: red }",
            "@media (width >= 768px) {",
            "    .card {",
            "        padding: 2rem;",
            "    }",
            "}",
            ""
        ].join("\n"));
    });

    test("moves the comments before a nested media query with its content", async () => {
        const { raw } = await pack([
            ".card {",
            "    padding: 1rem;",
            "",
            "    /* Wider padding on tablets */",
            "    @media (width >= 768px) {",
            "        padding: 2rem;",
            "    }",
            "}",
            ""
        ].join("\n"));

        expect(raw).toBe([
            ".card {",
            "    padding: 1rem;",
            "}",
            "@media (width >= 768px) {",
            "    .card {",
            "        /* Wider padding on tablets */",
            "        padding: 2rem;",
            "    }",
            "}",
            ""
        ].join("\n"));
    });

    test("preserves CRLF line endings", async () => {
        const { raw } = await pack([
            ".a {",
            "    color: red;",
            "",
            "    .b {",
            "        @media (x) {",
            "            color: blue;",
            "        }",
            "    }",
            "}",
            ""
        ].join("\r\n"));

        expect(raw).toBe([
            ".a {",
            "    color: red;",
            "}",
            "@media (x) {",
            "    .a {",
            "        .b {",
            "            color: blue;",
            "        }",
            "    }",
            "}",
            ""
        ].join("\r\n"));
    });
});
