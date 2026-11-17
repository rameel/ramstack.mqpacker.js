import { describe, expect, test } from "vitest";
import postcss from "postcss";
import type { AtRule } from "postcss";
import { format, pack } from "./helpers";

describe("cascade layers", () => {
    test("packs media queries within a layer without moving them out of it", async () => {
        const { css, warnings } = await pack(`
            @layer base {
                @media (min-width: 768px) { .a { color: red } }
                .b { color: red }
                @media (min-width: 768px) { .c { color: red } }
            }
            .d { color: red }
            @media (min-width: 768px) { .e { color: red } }
        `);

        expect(css).toBe(format(`
            @layer base {
                .b { color: red }
                @media (min-width: 768px) { .a { color: red } .c { color: red } }
            }
            .d { color: red }
            @media (min-width: 768px) { .e { color: red } }
        `));
        expect(warnings).toEqual([]);
    });

    test("packs media queries within a layer nested in a conditional at-rule", async () => {
        const { css } = await pack(`
            @supports (display: grid) {
                @layer base {
                    @media (min-width: 768px) { .a { color: red } }
                    .b { color: red }
                    @media (min-width: 768px) { .c { color: red } }
                }
                @media (min-width: 768px) { .d { color: red } }
            }
            .e { color: red }
        `);

        expect(css).toBe(format(`
            @supports (display: grid) {
                @layer base {
                    .b { color: red }
                    @media (min-width: 768px) { .a { color: red } .c { color: red } }
                }
            }
            .e { color: red }
            @media (min-width: 768px) { @supports (display: grid) { .d { color: red } } }
        `));
    });

    test("does not merge media queries of different layer blocks", async () => {
        const { css } = await pack(`
            @layer base { @media (min-width: 768px) { .a { color: red } } }
            @layer base { @media (min-width: 768px) { .b { color: red } } }
            @layer { @media (min-width: 768px) { .c { color: red } } }
        `);

        expect(css).toBe(format(`
            @layer base { @media (min-width: 768px) { .a { color: red } } }
            @layer base { @media (min-width: 768px) { .b { color: red } } }
            @layer { @media (min-width: 768px) { .c { color: red } } }
        `));
    });

    test("packs media queries within a layer nested in a style rule", async () => {
        const { css } = await pack(`
            .a {
                @layer base {
                    @media (min-width: 768px) { color: red }
                    padding: 0;
                    @media (min-width: 768px) { margin: 0 }
                }
            }
        `);

        expect(css).toBe(format(`
            .a { @layer base { padding: 0; @media (min-width: 768px) { color: red; margin: 0 } } }
        `));
    });

    test("does not move a media query that declares a new layer", async () => {
        const { css, warnings } = await pack(`
            @media (min-width: 768px) { @layer components { .a { color: red } } }
            @layer utilities { .b { color: red } }
            @media (min-width: 768px) { .c { color: red } }
        `);

        expect(css).toBe(format(`
            @media (min-width: 768px) { @layer components { .a { color: red } } }
            @layer utilities { .b { color: red } }
            @media (min-width: 768px) { .c { color: red } }
        `));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`cascade layer "components"`);
        expect(warnings[0]).toContain(`@layer components;`);
    });

    test("does not move media queries past a media query with the same query list that stays in place", async () => {
        const { css, warnings } = await pack(`
            @media (min-width: 768px) { .a { color: blue } }
            @media print { .a { color: black } }
            @media (min-width: 768px) { @layer theme { .b { color: red } } .a { color: red } }
            .c { color: red }
            @media (min-width: 768px) { .d { color: red } }
            @media print { .e { color: black } }
        `, { sort: false });

        expect(css).toBe(format(`
            @media (min-width: 768px) { .a { color: blue } }
            @media (min-width: 768px) { @layer theme { .b { color: red } } .a { color: red } }
            .c { color: red }
            @media print { .a { color: black } .e { color: black } }
            @media (min-width: 768px) { .d { color: red } }
        `));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`cascade layer "theme"`);
        expect(warnings[0]).toContain("The preceding @media rule with the same query was also left in place");
    });

    test("reports the media queries held in place by each media query that stays in place", async () => {
        const { css, warnings } = await pack(`
            @media (min-width: 768px) { .a { color: red } }
            @media (min-width: 768px) { @layer base { .b { color: red } } }
            @media (min-width: 768px) { .c { color: red } }
            @media (min-width: 768px) { .d { color: red } }
            @media (min-width: 768px) { @layer theme { .e { color: red } } }
            @media (min-width: 768px) { .f { color: red } }
            .g { color: red }
            @media (min-width: 768px) { .h { color: red } }
        `);

        expect(css).toBe(format(`
            @media (min-width: 768px) { .a { color: red } }
            @media (min-width: 768px) { @layer base { .b { color: red } } }
            @media (min-width: 768px) { .c { color: red } }
            @media (min-width: 768px) { .d { color: red } }
            @media (min-width: 768px) { @layer theme { .e { color: red } } }
            .g { color: red }
            @media (min-width: 768px) { .f { color: red } .h { color: red } }
        `));
        expect(warnings).toHaveLength(2);
        expect(warnings[0]).toMatch(/"base".* The preceding @media rule with the same query was also left in place/);
        expect(warnings[1]).toMatch(/"theme".* The 2 preceding @media rules with the same query were also left in place/);
    });

    test("sorts only the media queries that are moved", async () => {
        const { css, warnings } = await pack(`
            @media (min-width: 1024px) { .a { color: red } }
            @media (min-width: 768px) { .b { color: red } }
            @media (min-width: 768px) { @layer theme { .c { color: red } } }
            @media (min-width: 768px) { .d { color: red } }
            @media (min-width: 640px) { .e { color: red } }
            .f { color: red }
        `, { sort: true });

        expect(css).toBe(format(`
            @media (min-width: 768px) { .b { color: red } }
            @media (min-width: 768px) { @layer theme { .c { color: red } } }
            .f { color: red }
            @media (min-width: 640px) { .e { color: red } }
            @media (min-width: 768px) { .d { color: red } }
            @media (min-width: 1024px) { .a { color: red } }
        `));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`cascade layer "theme"`);
    });

    test("moves a media query whose layers are declared before it", async () => {
        const { css, warnings } = await pack(`
            @layer components, utilities;
            @media (min-width: 768px) { @layer components { .a { color: red } } }
            @layer utilities { .b { color: red } }
            @media (min-width: 768px) { .c { color: red } }
        `);

        expect(css).toBe(format(`
            @layer components, utilities;
            @layer utilities { .b { color: red } }
            @media (min-width: 768px) { @layer components { .a { color: red } } .c { color: red } }
        `));
        expect(warnings).toEqual([]);
    });

    test("takes into account layers declared by a block or an import", async () => {
        const { css, warnings } = await pack(`
            @import url("theme.css") layer(theme);
            @layer base { .x { color: red } }
            @media (min-width: 768px) { @layer base { .a { color: red } } @layer theme { .b { color: red } } }
            .c { color: red }
        `);

        expect(css).toBe(format(`
            @import url("theme.css") layer(theme);
            @layer base { .x { color: red } }
            .c { color: red }
            @media (min-width: 768px) { @layer base { .a { color: red } } @layer theme { .b { color: red } } }
        `));
        expect(warnings).toEqual([]);
    });

    test("ignores conditional layer declarations", async () => {
        const { css, warnings } = await pack(`
            @import url("theme.css") layer(theme) screen;
            @media print { @layer base; }
            @media (min-width: 768px) { @layer base { .a { color: red } } }
            @media (min-width: 768px) { @layer theme { .b { color: red } } }
            .c { color: red }
        `);

        expect(css).toBe(format(`
            @import url("theme.css") layer(theme) screen;
            @media print { @layer base; }
            @media (min-width: 768px) { @layer base { .a { color: red } } }
            @media (min-width: 768px) { @layer theme { .b { color: red } } }
            .c { color: red }
        `));

        // "@media print" itself declares the layer conditionally, so it stays in place as well.
        expect(warnings).toHaveLength(3);
    });

    test("recognizes layer() of an import in any case and treats supports() as a condition", async () => {
        const { css, warnings } = await pack(`
            @import url("base.css") LAYER(base);
            @import url("theme.css") layer(theme) supports(display: grid);
            @media (min-width: 768px) { @layer base { .a { color: red } } }
            @media (min-width: 1024px) { @layer theme { .b { color: red } } }
            .c { color: red }
        `);

        expect(css).toBe(format(`
            @import url("base.css") LAYER(base);
            @import url("theme.css") layer(theme) supports(display: grid);
            @media (min-width: 1024px) { @layer theme { .b { color: red } } }
            .c { color: red }
            @media (min-width: 768px) { @layer base { .a { color: red } } }
        `));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`cascade layer "theme"`);
    });

    test("ignores layer declarations that follow the media query", async () => {
        const { css, warnings } = await pack(`
            @media (min-width: 768px) { @layer base { .a { color: red } } }
            @layer base, theme;
            .c { color: red }
        `);

        expect(css).toBe(format(`
            @media (min-width: 768px) { @layer base { .a { color: red } } }
            @layer base, theme;
            .c { color: red }
        `));
        expect(warnings).toHaveLength(1);
    });

    test("resolves nested layer names", async () => {
        const declared = await pack(`
            @layer base { @layer reset, typography; }
            @media (min-width: 768px) { @layer base.typography { .a { color: red } } }
            @media (min-width: 768px) { @layer base { @layer reset { .b { color: red } } } }
            .c { color: red }
        `);

        expect(declared.warnings).toEqual([]);
        expect(declared.css).toBe(format(`
            @layer base { @layer reset, typography; }
            .c { color: red }
            @media (min-width: 768px) {
                @layer base.typography { .a { color: red } }
                @layer base { @layer reset { .b { color: red } } }
            }
        `));

        const undeclared = await pack(`
            @layer base;
            @media (min-width: 768px) { @layer base.typography { .a { color: red } } }
            .c { color: red }
        `);

        expect(undeclared.warnings).toHaveLength(1);
        expect(undeclared.warnings[0]).toContain(`"base.typography"`);
    });

    test("suggests declaring the full name of a nested layer", async () => {
        const { warnings } = await pack(`
            @media (min-width: 768px) { @layer base.typography { .a { color: red } } }
            @media print { @layer reset, theme.dark; }
            @layer { @media (min-width: 768px) { @layer theme.dark { .b { color: red } } } }
            .c { color: red }
        `);

        expect(warnings).toHaveLength(3);
        expect(warnings[0]).toContain(`cascade layer "base.typography"`);
        expect(warnings[0]).toContain(`(e.g. "@layer base.typography;")`);
        expect(warnings[1]).toContain(`cascade layer "reset"`);
        expect(warnings[1]).toContain(`(e.g. "@layer reset;")`);
        expect(warnings[2]).toContain(`cascade layer "<anonymous>.theme.dark"`);
        expect(warnings[2]).toContain(`(e.g. "@layer theme.dark;")`);
    });

    test("qualifies layer names by the enclosing layer", async () => {
        const { css, warnings } = await pack(`
            @layer base, theme;
            @layer theme {
                @media (min-width: 768px) { @layer base { .a { color: red } } }
                .b { color: red }
            }
        `);

        expect(css).toBe(format(`
            @layer base, theme;
            @layer theme {
                @media (min-width: 768px) { @layer base { .a { color: red } } }
                .b { color: red }
            }
        `));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`"theme.base"`);
    });

    test("does not move a media query that contains an anonymous layer", async () => {
        const { css, warnings } = await pack(`
            @media (min-width: 768px) { @layer { .a { color: red } } }
            .b { color: red }
        `);

        expect(css).toBe(format(`
            @media (min-width: 768px) { @layer { .a { color: red } } }
            .b { color: red }
        `));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("anonymous cascade layer");
    });

    test("suggests declaring a layer nested in an anonymous layer inside it", async () => {
        const undeclared = await pack(`
            @layer { @layer base; }
            @layer {
                @media (min-width: 768px) { @layer base { .a { color: red } } }
                .b { color: red }
            }
            @layer {
                @layer theme {
                    @layer {
                        @media (min-width: 768px) { @layer base { .c { color: red } } }
                        .d { color: red }
                    }
                }
            }
        `);

        expect(undeclared.warnings).toHaveLength(2);
        expect(undeclared.warnings[0]).toContain(`cascade layer "<anonymous>.base"`);
        expect(undeclared.warnings[0]).toContain(`in the nearest enclosing anonymous layer (e.g. "@layer base;")`);
        expect(undeclared.warnings[1]).toContain(`cascade layer "<anonymous>.theme.<anonymous>.base"`);
        expect(undeclared.warnings[1]).toContain(`in the nearest enclosing anonymous layer (e.g. "@layer base;")`);

        const declared = await pack(`
            @layer {
                @layer base;
                @media (min-width: 768px) { @layer base { .a { color: red } } }
                .b { color: red }
            }
        `);

        expect(declared.warnings).toEqual([]);
        expect(declared.css).toBe(format(`
            @layer {
                @layer base;
                .b { color: red }
                @media (min-width: 768px) { @layer base { .a { color: red } } }
            }
        `));
    });

    test("handles anonymous layers created by other plugins", async () => {
        const root = postcss.parse(`
            @media print { .a { color: red } }
            .b { color: red }
            @media (min-width: 768px) { .c { color: red } }
        `);

        // Unlike the parser, PostCSS leaves the params of created at-rules undefined.
        (root.first as AtRule).append(postcss.atRule({ name: "layer" }).append(".d { color: red }"));
        root.append(postcss.atRule({ name: "layer" }).append(`
            @layer base;
            @media (min-width: 768px) { .e { color: red } }
            .f { color: red }
        `));

        const { css, warnings } = await pack(root);

        expect(css).toBe(format(`
            @media print { .a { color: red } @layer { .d { color: red } } }
            .b { color: red }
            @layer { @layer base; .f { color: red } @media (min-width: 768px) { .e { color: red } } }
            @media (min-width: 768px) { .c { color: red } }
        `));
        expect(warnings).toEqual(["@media print was left in place because it contains an anonymous cascade layer."]);
    });

    test("packs media queries nested in a media query that stays in place", async () => {
        const { css } = await pack(`
            @media screen {
                @layer components { .a { color: red } }
                @media (min-width: 768px) { .b { color: red } }
                .c { color: red }
                @media (min-width: 768px) { .d { color: red } }
            }
            .e { color: red }
        `);

        expect(css).toBe(format(`
            @media screen {
                @layer components { .a { color: red } }
                .c { color: red }
                @media (min-width: 768px) { .b { color: red } .d { color: red } }
            }
            .e { color: red }
        `));
    });

    test("does not repeat the warning for media queries nested in the one left in place", async () => {
        const input = `
            @media (min-width: 768px) {
                .a {
                    @media (hover: hover) {
                        .b { @media (pointer: fine) { @layer components { .c { color: red } } } }
                    }
                }
                .d { @media print { @layer theme { .e { color: red } } } }
            }
        `;

        const { css, warnings } = await pack(input);

        expect(css).toBe(format(input));
        expect(warnings).toHaveLength(2);
        expect(warnings[0]).toMatch(/^@media \(min-width: 768px\) .* "components"/);
        expect(warnings[1]).toMatch(/^@media print .* "theme"/);
    });
});
