/**
 * Specifies a predefined order of packed media queries.
 *
 * - `"mobile-first"` places queries with a lower width bound (`min-width`, `width >= ...`)
 *   first, in ascending order of the bound.
 * - `"desktop-first"` places queries with an upper width bound (`max-width`, `width <= ...`)
 *   first, in descending order of the bound.
 *
 * In both cases, the remaining queries follow in their original order.
 */
export type SortOrder = "mobile-first" | "desktop-first";

/**
 * Compares two media query lists (the `params` of `@media` rules).
 * Follows the contract of the `Array.prototype.sort` compare function.
 */
export type QueryComparer = (a: string, b: string) => number;

/**
 * Describes the width range a media query list applies to, in pixels.
 */
interface Bounds {
    min: number | undefined;
    max: number | undefined;
}

/**
 * Delimiters that separate tokens of a media query.
 */
const DELIMITERS = "():,<>=/";

/**
 * Delimiters that make surrounding whitespace insignificant.
 */
const SPACE_INSENSITIVE = ":,<>=/";

const LOGICAL_OPERATOR = /(?:^|[\s()])(?:not|or)(?=[\s(])/;
const MEDIA_TYPE = /^(?:only )?([a-z-]+)(?: and |$)/;
const MEDIA_FEATURE = /\(([^()]*)\)/g;
const RANGE_OPERATOR = /(<=|>=|<|>|=)/;
const LENGTH = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(px|em|rem)?$/;

/**
 * Returns the canonical form of a media query list, used to detect equal queries.
 *
 * Comments are removed, insignificant whitespace is collapsed, and identifiers are
 * lowercased, except for dashed identifiers (e.g. custom media queries) and strings.
 *
 * @param query - The media query list.
 * @returns The canonical form of the query list.
 *
 * @example
 * ```ts
 * normalize_query("SCREEN   AND ( MIN-WIDTH : 768PX ), (--Narrow)");
 * // output: "screen and (min-width:768px),(--Narrow)"
 * ```
 */
export function normalize_query(query: string): string {
    let result = "";
    let space = false;
    let whitespace = false;
    let i = 0;

    while (i < query.length) {
        const ch = query[i];

        if (ch === "/" && query[i + 1] === "*") {
            const end = query.indexOf("*/", i + 2);
            i = end < 0 ? query.length : end + 2;
            space = true;
            continue;
        }

        if (is_whitespace(ch)) {
            space = true;
            whitespace = true;
            i++;
            continue;
        }

        let token: string;

        if (ch === "\"" || ch === "'") {
            let j = i + 1;
            while (j < query.length && query[j] !== ch) {
                j += query[j] === "\\" ? 2 : 1;
            }

            token = query.slice(i, j + 1);
            i = j + 1;
        }
        else if (DELIMITERS.includes(ch)) {
            token = ch;
            i++;
        }
        else {
            let j = i;
            while (j < query.length && is_word_char(query[j])) {
                j += query[j] === "\\" ? 2 : 1;
            }

            token = query.slice(i, j);
            if (!token.startsWith("--")) {
                token = token.toLowerCase();
            }

            i = j;
        }

        if (space && result && needs_space(result[result.length - 1], token[0], whitespace)) {
            result += " ";
        }

        result += token;
        space = false;
        whitespace = false;
    }

    return result;
}

/**
 * Creates a compare function for the specified `sort` option.
 *
 * @param sort - The value of the `sort` option.
 * @returns The compare function, or `undefined` if the queries should not be sorted.
 */
export function resolve_comparer(sort: boolean | SortOrder | QueryComparer | null | undefined): QueryComparer | undefined {
    if (sort === false) {
        return undefined;
    }

    if (typeof sort === "function") {
        return sort;
    }

    if (sort === undefined || sort === null || sort === true || sort === "mobile-first") {
        return create_comparer(true);
    }

    if (sort === "desktop-first") {
        return create_comparer(false);
    }

    throw new TypeError(`[@ramstack/mqpacker] Invalid "sort" option: ${String(sort)}`);
}

function create_comparer(mobile_first: boolean): QueryComparer {
    const cache = new Map<string, Bounds>();

    const get = (query: string) => {
        let bounds = cache.get(query);
        if (!bounds) {
            bounds = get_query_bounds(query);
            cache.set(query, bounds);
        }

        return bounds;
    };

    return (a, b) => {
        const x = mobile_first ? get(a).min : get(a).max;
        const y = mobile_first ? get(b).min : get(b).max;

        if (x === undefined || y === undefined) {
            // Queries without the bound go last; the sort is stable,
            // so they keep their original order.
            return (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0);
        }

        return mobile_first ? x - y : y - x;
    };
}

/**
 * Returns the width range of a media query list. For a list, the range is the union
 * of the ranges of the queries that have the corresponding bound.
 *
 * @param query_list - The media query list.
 * @returns The width range.
 */
function get_query_bounds(query_list: string): Bounds {
    const result: Bounds = { min: undefined, max: undefined };

    for (const query of split_list(normalize_query(query_list))) {
        const { min, max } = get_bounds(query);

        if (min !== undefined && (result.min === undefined || min < result.min)) {
            result.min = min;
        }

        if (max !== undefined && (result.max === undefined || max > result.max)) {
            result.max = max;
        }
    }

    return result;

    /**
     * Returns the width range of a single normalized media query.
     * Queries with negation, `or`, or media types other than `all` and `screen`
     * are treated as having no width range.
     */
    function get_bounds(query: string): Bounds {
        const bounds: Bounds = { min: undefined, max: undefined };

        if (LOGICAL_OPERATOR.test(query)) {
            return bounds;
        }

        const type = MEDIA_TYPE.exec(query);
        if (type && type[1] !== "all" && type[1] !== "screen") {
            return bounds;
        }

        for (const [, feature] of query.matchAll(MEDIA_FEATURE)) {
            const colon = feature.indexOf(":");

            if (colon >= 0) {
                const name = feature.slice(0, colon);
                const value = parse_length(feature.slice(colon + 1));

                if (name === "min-width") {
                    apply_bound(bounds, ">=", value);
                }
                else if (name === "max-width") {
                    apply_bound(bounds, "<=", value);
                }
                else if (name === "width") {
                    apply_bound(bounds, "=", value);
                }

                continue;
            }

            // Range syntax: (width >= 768px), (768px <= width < 1024px), etc.
            const parts = feature.split(RANGE_OPERATOR);
            for (let i = 1; i + 1 < parts.length; i += 2) {
                const operator = parts[i];
                const left = parts[i - 1];
                const right = parts[i + 1];

                if (left === "width") {
                    apply_bound(bounds, operator, parse_length(right));
                }
                else if (right === "width") {
                    apply_bound(bounds, reverse_operator(operator), parse_length(left));
                }
            }
        }

        return bounds;
    }

    /**
     * Narrows the range by the condition `width <operator> value`.
     */
    function apply_bound(bounds: Bounds, operator: string, value: number | undefined): void {
        if (value === undefined) {
            return;
        }

        if (operator !== "<" && operator !== "<=") {
            bounds.min = bounds.min === undefined ? value : Math.max(bounds.min, value);
        }

        if (operator !== ">" && operator !== ">=") {
            bounds.max = bounds.max === undefined ? value : Math.min(bounds.max, value);
        }
    }
}

function reverse_operator(operator: string): string {
    switch (operator) {
        case "<": return ">";
        case "<=": return ">=";
        case ">": return "<";
        case ">=": return "<=";
        default: return operator;
    }
}

/**
 * Converts a length to pixels. Font-relative units are resolved against
 * the initial font size of 16px, as browsers do in media queries.
 *
 * @returns The length in pixels, or `undefined` if the value is not a supported length.
 */
function parse_length(value: string): number | undefined {
    const match = LENGTH.exec(value);
    if (!match) {
        return undefined;
    }

    const number = Number(match[1]);
    const unit = match[2];

    if (!unit) {
        return number === 0 ? 0 : undefined;
    }

    return unit === "px" ? number : number * 16;
}

/**
 * Splits a normalized media query list by top-level commas.
 */
function split_list(query: string): string[] {
    const list: string[] = [];
    let depth = 0;
    let start = 0;
    let quote = "";

    for (let i = 0; i < query.length; i++) {
        const ch = query[i];

        if (quote) {
            if (ch === "\\") {
                i++;
            }
            else if (ch === quote) {
                quote = "";
            }
        }
        else if (ch === "\"" || ch === "'") {
            quote = ch;
        }
        else if (ch === "(") {
            depth++;
        }
        else if (ch === ")") {
            depth--;
        }
        else if (ch === "," && depth === 0) {
            list.push(query.slice(start, i));
            start = i + 1;
        }
    }

    list.push(query.slice(start));
    return list;
}

function needs_space(previous: string, next: string, whitespace: boolean): boolean {
    if (next === "=" && (previous === "<" || previous === ">")) {
        // "<=" and ">=" are operators only without whitespace between the characters;
        // with whitespace, the query is invalid. Comments between them are ignored.
        return whitespace;
    }

    return previous !== "("
        && next !== ")"
        && !SPACE_INSENSITIVE.includes(previous)
        && !SPACE_INSENSITIVE.includes(next);
}

function is_whitespace(ch: string): boolean {
    return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

function is_word_char(ch: string): boolean {
    return !is_whitespace(ch)
        && !DELIMITERS.includes(ch)
        && ch !== "\""
        && ch !== "'";
}
