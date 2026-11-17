import postcss from "postcss";
import type { Root } from "postcss";
import mqpacker from "@/mqpacker";
import type { Options } from "@/mqpacker";

/**
 * Reformats CSS to a single line with default whitespace, so that tests
 * do not depend on the formatting of the plugin output.
 */
export function format(css: string): string {
    const root = postcss.parse(css);
    root.walk(node => {
        node.cleanRaws();
        delete (node.raws as { semicolon?: boolean }).semicolon;
    });

    return root.toString().replace(/\s+/g, " ").trim();
}

/**
 * Processes CSS or a prebuilt stylesheet root with the plugin.
 */
export async function pack(css: string | Root, options?: Options): Promise<{ css: string, raw: string, warnings: string[] }> {
    const result = await postcss([mqpacker(options)]).process(css, { from: undefined });

    return {
        css: format(result.css),
        raw: result.css,
        warnings: result.warnings().map(warning => warning.text)
    };
}
