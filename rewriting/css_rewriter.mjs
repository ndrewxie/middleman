import {TextStream, is_whitespace} from './utility.mjs';
import * as urls from '../hooks/urls.mjs';
import * as fs from 'fs';

// ignores case, skips trailing whitespace
function string_ends_with(input, search) {
    let actual_search = search.toLowerCase();
    let index = input.length - 1;
    while ((index >= 0) && is_whitespace(input[index])) {
        if (index > 0) {
            index -= 1;
        }
    }
    let search_start = index - actual_search.length + 1;
    if (search_start < 0) {
        return false;
    }
    for (let j = 0; j < actual_search.length; j++) {
        if (input[search_start + j].toLowerCase() != actual_search[j]) {
            return false;
        }
    }
    return true;
}

export class CSSRewriter {
    constructor(input) {
        this.input = new TextStream(input);
        this.rewrites = [];
    }
    rewrite() {
        this.parse();
        let acc = '';
        let last_copied_index = 0;
        for (let j = 0; j < this.rewrites.length; j++) {
            let rewrite = this.rewrites[j];
            acc += this.input.substring(last_copied_index, rewrite.from);
            acc += rewrite.text;
            last_copied_index = rewrite.to;
        }
        acc += this.input.substring(last_copied_index, this.input.length());
        return acc;
    }
    rewrite_url(url) {
        let value = url.data();
        let quote = '';
        if ((value[0] == '"') && (value.slice(-1) == '"')) { quote = '"'; }
        if ((value[0] == "'") && (value.slice(-1) == "'")) { quote = "'"; }
        let extracted_url = value.substring(quote.length, value.length - quote.length);
        
        this.rewrites.push({
            from: url.from,
            to: url.to,
            text: quote + urls.encode_url(extracted_url) + quote
        });
    }
    parse() {
        let reader = this.input;
        while (!reader.is_empty()) {
            if (reader.expect_string('/*', '*/', false, true)) { continue; }
            if (this.expect_url()) { continue; }
            if (this.expect_import()) { continue; }
            reader.next();
        }
    }
    expect_quoted() {
        let quoted = undefined;
        if (!quoted) { quoted = this.input.expect_string('"', '"', true, true); }
        if (!quoted) { quoted = this.input.expect_string("'", "'", true, true); }
        return quoted;
    }
    expect_import() {
        if (!this.input.expect_pattern(['@import'], { skip_ws: true })) { return false; }
        let payload = this.expect_url();
        if (payload) { return true; }
        payload = this.expect_quoted();
        if (payload) {
            this.rewrite_url(payload);
            return true;
        }
        return false;
    }
    expect_url() {
        if (!this.input.expect_pattern(['url', '('], { skip_ws: true } )) { return false; }
        let url_data = this.expect_quoted();
        if (url_data) {
            this.input.expect_pattern([')'], { skip_ws: true } );
        }
        else {
            url_data = this.input.expect_until_criterion((ch) => {
                return (ch == ')') || is_whitespace(ch);
            });
        }
        this.rewrite_url(url_data);
        return true;
    }
}

(function() {
    return;
    let rewriter = new CSSRewriter(`
        @import "navigation.css";
        @import url("navigation.css");
        #sampleDiv {
            background-image: url('../assets/logo.png');
            background-color: #FFFFDD;
            font-family: Arial;
        }
        .sampleClass {
            background-image: url(../assets/class.png);
        }
        .sampleClassTwo {
            background-image: url(../assets/camera.png prefetch);
        }
        #sampleDivTwo {
            background-image: url(../img/test.png param(--color var(--primary-color)));
        }
    `);
    console.log(rewriter.rewrite());
})();
(function() {
    return;
    let rewriter = new CSSRewriter(`--s-badge-moderator-icon:url("data:image/svg+xml,%3Csvg width='12' height='14' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M5.528.746c.257-.329.675-.327.93 0l4.42 5.66c.258.329.257.864 0 1.192l-4.42 5.66c-.256.328-.674.327-.93 0l-4.42-5.66c-.257-.329-.256-.865 0-1.192l4.42-5.66z' fill='%23fff'/%3E%3C/svg%3E");`);
    console.log(rewriter.rewrite());
})();