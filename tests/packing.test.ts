import { describe, expect, test } from "vitest";
import postcss from "postcss";
import type { AtRule, Plugin } from "postcss";
import mqpacker from "@/mqpacker";
import { format, pack } from "./helpers";

describe("packing", () => {
    test("packs identical media queries and moves them to the end", async () => {
        const { css, warnings } = await pack(`
            .a { color: red }
            @media (min-width: 768px) { .a { color: blue } }
            .b { color: green }
            @media (min-width: 1024px) { .a { color: navy } }
            @media (min-width: 768px) { .b { color: lime } }
            .c { color: black }
        `);

        expect(css).toBe(format(`
            .a { color: red }
            .b { color: green }
            .c { color: black }
            @media (min-width: 768px) { .a { color: blue } .b { color: lime } }
            @media (min-width: 1024px) { .a { color: navy } }
        `));
        expect(warnings).toEqual([]);
    });

    test("treats queries that differ only in whitespace, comments and case as identical", async () => {
        const { css } = await pack(`
            @media screen and (min-width:768px) { .a { color: red } }
            @media SCREEN AND ( MIN-WIDTH : 768PX ) { .b { color: red } }
            @media screen /* tablet */ and (min-width: 768px) { .c { color: red } }
        `);

        expect(css).toBe(format(`
            @media screen and (min-width:768px) { .a { color: red } .b { color: red } .c { color: red } }
        `));
    });

    test("treats range syntax with different spacing as identical", async () => {
        const { css } = await pack(`
            @media (width >= 768px) { .a { color: red } }
            @media (width>=768px) { .b { color: red } }
            @media (768px <= width <= 1024px) { .c { color: red } }
            @media (768px<=width<=1024px) { .d { color: red } }
        `);

        expect(css).toBe(format(`
            @media (width >= 768px) { .a { color: red } .b { color: red } }
            @media (768px <= width <= 1024px) { .c { color: red } .d { color: red } }
        `));
    });

    test("does not merge a range operator split by whitespace with a valid one", async () => {
        const { css } = await pack(`
            @media (width < = 768px) { .a { color: red } }
            @media (width <= 768px) { .b { color: red } }
            @media (width </**/= 768px) { .c { color: red } }
            @media (width> =768px) { .d { color: red } }
            @media (width>=768px) { .e { color: red } }
        `, { sort: false });

        expect(css).toBe(format(`
            @media (width < = 768px) { .a { color: red } }
            @media (width <= 768px) { .b { color: red } .c { color: red } }
            @media (width> =768px) { .d { color: red } }
            @media (width>=768px) { .e { color: red } }
        `));
    });

    test("keeps the case of custom media queries", async () => {
        const { css } = await pack(`
            @media (--Small) { .a { color: red } }
            @media (--small) { .b { color: red } }
            @media (--Small) { .c { color: red } }
        `);

        expect(css).toBe(format(`
            @media (--Small) { .a { color: red } .c { color: red } }
            @media (--small) { .b { color: red } }
        `));
    });

    test("does not merge queries that differ semantically", async () => {
        const { css } = await pack(`
            @media screen, print { .a { color: red } }
            @media print, screen { .b { color: red } }
            @media screen and (min-width: 768px) { .c { color: red } }
            @media (min-width: 768px) { .d { color: red } }
        `, { sort: false });

        expect(css).toBe(format(`
            @media screen, print { .a { color: red } }
            @media print, screen { .b { color: red } }
            @media screen and (min-width: 768px) { .c { color: red } }
            @media (min-width: 768px) { .d { color: red } }
        `));
    });

    test("handles @media in any case", async () => {
        const { css } = await pack(`
            @MEDIA (min-width: 768px) { .a { color: red } }
            .b { color: red }
            @media (min-width: 768px) { .c { color: red } }
        `);

        expect(css).toBe(format(`
            .b { color: red }
            @MEDIA (min-width: 768px) { .a { color: red } .c { color: red } }
        `));
    });

    test("keeps the source map annotation at the end", async () => {
        // Vite takes an annotation that ends a source line for the test file's
        // own source map, so the annotation must never end a line here.
        const annotation = "/*# sourceMappingURL=style.css.map */";
        const { raw } = await pack(
            "@media (min-width: 768px) { .a { color: red } }\n"
            + ".b { color: red }\n"
            + annotation + "\n");

        expect(raw.trimEnd().endsWith(annotation)).toBe(true);
        expect(format(raw)).toBe(format(`
            .b { color: red }
            @media (min-width: 768px) { .a { color: red } }
            ${annotation}
        `));
    });

    test("maps the packed rules to their original lines", async () => {
        const source = [
            "/* Cards */",
            ".card {",
            "  padding: 1rem;",
            "  @media (width >= 768px) {",
            "    padding: 2rem;",
            "  }",
            "}",
            "/* Buttons */",
            ".button { color: black }",
            "@media (width >= 768px) {",
            "  .button { color: blue }",
            "}",
            ""
        ].join("\n");

        // The previous map comes from removing the comments, which shifts the lines.
        const options = { inline: false, annotation: false };
        const strip: Plugin = { postcssPlugin: "strip", Comment: comment => { comment.remove(); } };
        const compiled = await postcss([strip]).process(source, { from: "source.css", to: "style.css", map: options });
        const result = await postcss([mqpacker()]).process(compiled.css, {
            from: "style.css",
            to: "packed.css",
            map: { ...options, prev: compiled.map.toString() }
        });

        const output = postcss.parse(result.css, { from: "packed.css", map: { prev: result.map.toString() } });
        const origins: string[] = [];

        output.walk(node => {
            const name = node.type === "decl" ? node.prop : node.type === "rule" ? node.selector : `@${(node as AtRule).name}`;
            const origin = node.source!.input.origin(node.source!.start!.line, node.source!.start!.column);

            origins.push(origin ? `${name} ${origin.url.split("/").pop()}:${origin.line}` : `${name} unmapped`);
        });

        expect(origins).toEqual([
            ".card source.css:2",
            "padding source.css:3",
            ".button source.css:9",
            "color source.css:9",
            "@media source.css:4",
            ".card source.css:2",
            "padding source.css:5",
            ".button source.css:11",
            "color source.css:11"
        ]);
    });

    test("moves the comments before a media query with its content", async () => {
        const { css } = await pack(`
            .a { color: red }
            /* Tablet */
            @media (min-width: 768px) { .a { color: blue } }
            .b { color: red }
            /* Tablet: .b */
            /* Tablet: .b, continued */
            @media (min-width: 768px) { .b { color: blue } }
        `);

        expect(css).toBe(format(`
            .a { color: red }
            .b { color: red }
            @media (min-width: 768px) {
                /* Tablet */ .a { color: blue }
                /* Tablet: .b */ /* Tablet: .b, continued */ .b { color: blue }
            }
        `));
    });

    test("leaves in place the comments that may not describe a media query", async () => {
        const annotation = "/*# sourceMappingURL=style.css.map */";
        const { css } = await pack(`
            /*! License */
            @media (min-width: 768px) { .a { color: blue } }
            /* Section */

            /* Tablet */
            @media (min-width: 768px) { .b { color: blue } }
            .c { color: red } /* About .c */
            @media (min-width: 768px) { .d { color: blue } }
            ${annotation}
            @media (min-width: 768px) { .e { color: blue } }
            .f { color: red }
        `);

        expect(css).toBe(format(`
            /*! License */
            /* Section */
            .c { color: red } /* About .c */
            ${annotation}
            .f { color: red }
            @media (min-width: 768px) {
                .a { color: blue }
                /* Tablet */ .b { color: blue }
                .d { color: blue }
                .e { color: blue }
            }
        `));
    });

    test("leaves inline comments of SCSS and Less in place", async () => {
        const root = postcss.parse("/* inline */\n@media (min-width: 768px) { .a { color: blue } }\n.b { color: red }");
        (root.first!.raws as { inline?: boolean }).inline = true;

        const { css } = await pack(root);
        expect(css).toBe(format("/* inline */ .b { color: red } @media (min-width: 768px) { .a { color: blue } }"));
    });

    test("moves @keyframes and @font-face rules together with the media query", async () => {
        const { css } = await pack(`
            @media (min-width: 768px) {
                @keyframes spin { from { opacity: 0 } }
                @font-face { font-family: A; src: url(a.woff2) }
            }
            @keyframes spin { from { opacity: 1 } }
            .a { animation: spin 1s }
        `);

        expect(css).toBe(format(`
            @keyframes spin { from { opacity: 1 } }
            .a { animation: spin 1s }
            @media (min-width: 768px) {
                @keyframes spin { from { opacity: 0 } }
                @font-face { font-family: A; src: url(a.woff2) }
            }
        `));
    });

    test("keeps empty media queries", async () => {
        const { css } = await pack(`
            @media (min-width: 768px) {}
            .a { color: red }
        `);

        expect(css).toBe(format(`
            .a { color: red }
            @media (min-width: 768px) {}
        `));
    });

    test("handles media queries without params created by other plugins", async () => {
        const root = postcss.parse(`
            @media { .a { color: red } }
            .b { color: red }
            @media (min-width: 768px) { .c { color: red } }
        `);

        // Unlike the parser, PostCSS leaves the params of created at-rules undefined.
        root.prepend(postcss.atRule({ name: "media" }).append(".d { color: red }"));

        const { css } = await pack(root, { sort: true });

        expect(css).toBe(format(`
            .b { color: red }
            @media (min-width: 768px) { .c { color: red } }
            @media { .d { color: red } .a { color: red } }
        `));
    });

    test("keeps statements at the beginning of the stylesheet", async () => {
        const { css } = await pack(`
            @charset "utf-8";
            @import url("base.css") screen;
            @media (min-width: 768px) { .a { color: red } }
            .b { color: red }
        `);

        expect(css).toBe(format(`
            @charset "utf-8";
            @import url("base.css") screen;
            .b { color: red }
            @media (min-width: 768px) { .a { color: red } }
        `));
    });

    test("preserves the formatting of the expanded Sass output", async () => {
        const { raw } = await pack(
            ".a {\n  color: red;\n}\n\n"
            + "@media (min-width: 768px) {\n  .a {\n    color: blue;\n  }\n}\n\n"
            + ".b {\n  color: green;\n}\n\n"
            + "@media (min-width: 768px) {\n  .b {\n    color: lime;\n  }\n}\n");

        expect(raw).toBe(
            ".a {\n  color: red;\n}\n\n"
            + ".b {\n  color: green;\n}\n\n"
            + "@media (min-width: 768px) {\n  .a {\n    color: blue;\n  }\n  .b {\n    color: lime;\n  }\n}\n");
    });

    test("takes the closing whitespace of the packed rule from the media query", async () => {
        const { raw } = await pack([
            ".a { color: red }",
            "@media (min-width: 768px) {",
            "  .a { color: blue }",
            "}",
            ".b { color: red }",
            ""
        ].join("\n"));

        expect(raw).toBe([
            ".a { color: red }",
            ".b { color: red }",
            "@media (min-width: 768px) {",
            "  .a { color: blue }",
            "}",
            ""
        ].join("\n"));
    });

    test.each([false, true, "desktop-first"] as const)("is idempotent with sort: %s", async sort => {
        const input = `
            @layer base, components;

            /* Tablet */
            @media (min-width: 768px) { .a { color: blue } }

            .a {
                color: red;
                @media (min-width: 1024px) { color: green }
                .b { @supports (display: grid) { @media (max-width: 767px) { display: grid } } }
            }

            @container card (width > 400px) { @media print { .c { display: none } } }
            @media (min-width: 768px) { @layer components { .d { color: red } } }
            @media (min-width: 640px) { @layer theme { .e { color: red } } }

            @media screen {
                @media (min-width: 1024px) { .f { color: red } }
                .g { color: red }
                @media (min-width: 768px) { .h { color: red } }
            }

            @layer base {
                @media (max-width: 767px) { .i { color: red } }
                .j { color: red }
                @media (min-width: 768px) { .k { color: red } }
            }

            .l { color: red }
        `;

        const first = await pack(input, { sort });
        const second = await pack(first.raw, { sort });

        expect(second.raw).toBe(first.raw);
        expect(second.warnings).toEqual(first.warnings);
    });

    test("processes each root of a document independently", async () => {
        const document = postcss.document();
        document.append(postcss.parse("@media (min-width: 768px) { .a { color: red } } .b { color: red }"));
        document.append(postcss.parse("@media (min-width: 768px) { .c { color: red } } .d { color: red }"));

        await postcss([mqpacker()]).process(document, { from: undefined });
        const roots = document.nodes.map(root => format(root.toString()));

        expect(roots).toEqual([
            format(".b { color: red } @media (min-width: 768px) { .a { color: red } }"),
            format(".d { color: red } @media (min-width: 768px) { .c { color: red } }")
        ]);
    });

    test("tracks the layers and sorts the media queries of each root of a document", async () => {
        const document = postcss.document();
        document.append(postcss.parse(`
            @layer theme;
            @media (min-width: 1024px) { @layer theme { .a { color: red } } }
            @media (min-width: 768px) { .b { color: red } }
            .c { color: red }
        `));
        document.append(postcss.parse(`
            @media (min-width: 1024px) { .d { color: red } }
            @media (min-width: 768px) { @layer utilities { .e { color: red } } }
            @media (min-width: 640px) { .f { color: red } }
            .g { color: red }
        `));

        const result = await postcss([mqpacker({ sort: true })]).process(document, { from: undefined });
        const roots = document.nodes.map(root => format(root.toString()));

        expect(roots).toEqual([
            format(`
                @layer theme;
                .c { color: red }
                @media (min-width: 768px) { .b { color: red } }
                @media (min-width: 1024px) { @layer theme { .a { color: red } } }
            `),
            format(`
                @media (min-width: 768px) { @layer utilities { .e { color: red } } }
                .g { color: red }
                @media (min-width: 640px) { .f { color: red } }
                @media (min-width: 1024px) { .d { color: red } }
            `)
        ]);
        expect(result.warnings().map(warning => warning.text)).toEqual([
            expect.stringContaining(`cascade layer "utilities"`)
        ]);
    });

    test("treats null options as the defaults", async () => {
        const { css } = await pack(`
            @media (min-width: 1024px) { .a { color: red } }
            @media (min-width: 768px) { .b { color: red } }
            @media (min-width: 1024px) { .c { color: red } }
        `, null as never);

        expect(css).toBe(format(`
            @media (min-width: 768px) { .b { color: red } }
            @media (min-width: 1024px) { .a { color: red } .c { color: red } }
        `));
    });

    test("can be used with the plugin name", () => {
        expect((mqpacker() as Plugin).postcssPlugin).toBe("@ramstack/mqpacker");
        expect(mqpacker.postcss).toBe(true);
    });

    test("exports the plugin as module.exports for require()", async () => {
        const namespace = await import("@/mqpacker");
        expect(namespace["module.exports"]).toBe(mqpacker);
    });
});
