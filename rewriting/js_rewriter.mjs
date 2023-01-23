import { readFileSync } from 'fs';

import { TextStream, is_whitespace } from './utility.mjs';
import assert from 'assert';

const SUS_ATTRIBUTES = ['href', 'location', 'hostname', 'host', 'pathname', 'protocol', 'reload', 'replace', 'pushState', 'replaceState'];
const SANITIZE_STR = 'window.sanitized_access(';

const reserved_keywords = ["break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null", "return", "super", "switch", "throw", "true", "try", "typeof", "var", "void", "while", "with", "let", "static", "yield"];
const identifier_start_chars = /^(?:[a-zA-Z_$])/;
const identifier_chars = /^(?:[a-zA-Z0-9_$])/;
const ASSIGNMENT_OPERATORS = ['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '^=', '|=', '&&=', '||=', '??=', '++', '--'];
// list of prefixes that can't start an access **chain**
const BANNED_PREFIXES = ['++', '--', 'new', '.', ']', ')', '}'];

export class JSRewriter {
    constructor(input) {
        this.input = new TextStream(input);
        this.rewrites = [];
        this.is_rewritten = false;
    }
    rewrite() {
        this.parse();

        this.is_rewritten = this.rewrites.length != 0;
        if (!this.is_rewritten) { return this.input.raw_input(); }
        
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
    parse() {
        let reader = this.input;
        while (!reader.is_empty()) {
            let escape = this.expect_escape();
            if (escape) { continue; }
            if (this.process_access_chain()) { continue; }
            reader.next();
        }
    }
    process_access_chain() {
        let reader = this.input;
        let is_prefix_valid = this.check_prefix();

        let base = this.expect_identifier();
        if (typeof base == 'undefined') { return false; }        
        let replacement_start = base.from;
        
        let rewrite_text = base.data();
        // List of indices to re-write even if this chain isn't suspicious
        let fallback_rewrites = [];
        let is_sus = false;
        let access_count = 0;
        while (true) {
            let processed = this.process_access(rewrite_text);
            if (typeof processed == 'undefined') { break; }
            access_count += 1;
            is_sus = is_sus || processed.is_sus;
            rewrite_text = processed.rewrite;
            fallback_rewrites = fallback_rewrites.concat(processed.fallback_rewrites);
        }
        let replacement_end = reader.mark();
            
        if (access_count == 0) { return false; }
        if (!is_prefix_valid) { return false; }
        if (!is_sus) {
            for (const fallback_rewrite of fallback_rewrites) {
                let fallback_rewriter = new JSRewriter(fallback_rewrite.data());
                let fallback_rewritten = fallback_rewriter.rewrite();
                if (!fallback_rewriter.is_rewritten) { continue; }
                this.insert_mark(fallback_rewritten, fallback_rewrite.from, fallback_rewrite.to);
            }
            return false;
        }

        this.insert_mark(rewrite_text, replacement_start, replacement_end);
        return true;
    }
    // Checks to make sure the prefix of `reader` is not an increment/decrement operator
    // This is because ++window.sanitize_value(...) is illegal
    // Returns `true` if the prefix is OK, otherwise `false`
    check_prefix() {
        let reader = this.input;
        for (const prefix of BANNED_PREFIXES) {
            let look_index = prefix.length-1;
            for (let j = reader.mark()-1; j >= 0; j--) {
                let ch = reader.get_char(j);
                if (is_whitespace(ch)) { continue; }
                if (prefix[look_index] == ch) { look_index -= 1; }
                else { break; }
                if (look_index < 0) { break; }
            }
            if (look_index < 0) { return false; }
        }
        return true;
    }
    /// Looks for a property access (either direct or computed), a string that's a running accumulator
    /// of the rewritten version of the current access chain.
    /// Returns 3 values:
    ///     * is_sus: whether the access is suspicious or not
    ///     * rewrite: the new re-written string, after reading this access
    ///     * fallback_rewrites: the list of things that should be re-written, even if the chain isn't suspicious
    process_access(input_string) {
        let reader = this.input;
        reader.save();

        let accessed_field = '';
        let is_sus = false;
        let fallback_rewrites = [];
        
        let access = this.expect_dot_access();
        if (typeof access != 'undefined') {
            accessed_field = '"' + access.data().trim().substring(1) + '"';
            is_sus = this.is_sus(accessed_field);
        }
        else {
            access = this.expect_indirect_access();
            if (typeof access == 'undefined') { return reader.restore_return(undefined); }
            fallback_rewrites.push(access.clone());
            accessed_field = access.data().trim().slice(1, -1);
            accessed_field = (new JSRewriter(accessed_field)).rewrite();
            is_sus = true;
        }

        let function_call_start = reader.mark();
        let has_function_call = this.expect_nested('(', ')');
        let function_call_end = reader.mark();
        let function_call = 'undefined';
        if (has_function_call) {
            let function_call_slice = reader.slice(function_call_start, function_call_end);
            fallback_rewrites.push(function_call_slice.clone());
            function_call = function_call_slice.data().trim().slice(1, -1);
            function_call = (new JSRewriter(function_call)).rewrite();
            function_call =  "[" + function_call + "]";
        }

        for (let j = 0; j < ASSIGNMENT_OPERATORS.length; j++) {
            let expected = reader.expect_pattern([ASSIGNMENT_OPERATORS[j]], { skip_ws: true });
            if (expected) { return reader.restore_return(undefined); }
        }

        let rewrite = SANITIZE_STR + input_string + ',' + accessed_field + ',' + function_call + ')';
        return reader.pop_return({
            is_sus: is_sus,
            rewrite: reader.pop_return(rewrite),
            fallback_rewrites: fallback_rewrites
        });
    }
    is_sus(name) {
        if ((name == null) || (typeof name == 'undefined')) {
            return false;
        }
        let lowered = name.toLowerCase();
        for (let j = 0; j < SUS_ATTRIBUTES.length; j++) {
            if (lowered.includes(SUS_ATTRIBUTES[j])) { return true; }
        }
        return false;
    }
    insert_mark(input, from, to) {
        this.rewrites.push({
            to: to,
            from: from,
            text: input
        });
    }
    expect_indirect_access() {
        let reader = this.input;
        reader.save();

        let access_start = reader.mark();
        let access = this.expect_nested('[', ']');
        if (!access) { return reader.restore_return(undefined); }
        let access_end = reader.mark();

        return reader.pop_return(reader.slice(access_start, access_end));
    }
    expect_dot_access() {
        let reader = this.input;
        reader.save();

        let access_start = reader.mark();
        if (!reader.expect_pattern(['.'], { skip_ws: true })) { return reader.restore_return(undefined); }
        let name = this.expect_identifier();
        if (typeof name == 'undefined') { return reader.restore_return(undefined); }
        let access_end = reader.mark();

        return reader.pop_return(reader.slice(access_start, access_end));
    }
    expect_identifier() {
        let reader = this.input;
        reader.save();
        reader.skip_ws();

        if (reader.index > 0) {
            if (identifier_chars.test(reader.get_char(reader.mark() - 1))) {
                return reader.restore_return(undefined);
            }
        }

        let name_start = reader.mark();
        let name = reader.expect_until_criterion((ch) => { return !identifier_chars.test(ch); });
        let name_end = reader.mark();
        
        if (typeof name == 'undefined') { return reader.restore_return(undefined); }
        name = name.data().trim();
        if (name.length == 0) { return reader.restore_return(undefined); }
        if (!identifier_start_chars.test(name[0])) { return reader.restore_return(undefined); }
        if (reserved_keywords.includes(name)) { return reader.restore_return(undefined); }

        return reader.pop_return(reader.slice(name_start, name_end));
    }
    expect_closure_decl() {
        let reader = this.input;
        reader.save();
        reader.skip_ws();
        
        let args = this.expect_nested('(', ')');
        if (!args) {
            let arg = this.expect_identifier();
            if (typeof arg == 'undefined') { args = false; }
            else { args = true; }
        }
        if (!args) { return reader.restore_return(false); }

        let arrow = this.expect_pattern(['=>'], { skip_ws: true });
        if (!arrow) { return reader.restore_return(false); }
        
        return reader.pop_return(true);
    }
    expect_function_decl() {
        let reader = this.input;
        reader.save();

        let function_start = reader.expect_pattern(['function'], { skip_ws: true });
        if (!function_start) { return reader.restore_return(false); }

        let name = this.expect_identifier();
        let args = this.expect_nested('(', ')');
        let open_brace = reader.expect_pattern(['{'], { skip_ws: true });
        if (!open_brace) { return reader.restore_return(false); }
        return reader.pop_return(true);
    }
    expect_nested(start, end) {
        let reader = this.input;
        reader.save();

        let expect_start = reader.expect_pattern([start], { skip_ws: true});
        if (!expect_start) { return reader.restore_return(false); }

        let nesting_level = 1;
        while ((nesting_level > 0) && (!reader.is_empty())) {
            let escape = this.expect_escape();
            if (escape) { continue; }

            if (reader.expect_pattern([start], { skip_ws: true })) { nesting_level += 1; }
            else if (reader.expect_pattern([end], { skip_ws: true })) { nesting_level -= 1; }
            else { reader.next(); }
        }
        if (nesting_level == 0) {
            return reader.pop_return(true);
        }
        return reader.restore_return(false);
    }
    /// Either a string, comment or regex
    expect_escape() {
        if (this.expect_regex()) { return true; }
        if (this.expect_backtick_str()) { return true; }
        //if (this.expect_destructuring_assign()) { return true; }
        //if (this.expect_weird_minified_for_of_loop()) { return true; }

        let reader = this.input;
        let expect_single_quote = reader.expect_string("'", "'", true, false);
        if (expect_single_quote) { return true; }
        let expect_double_quote = reader.expect_string('"', '"', true, false);
        if (expect_double_quote) { return true; }
        let expect_multiline_comment = reader.expect_string('/*', '*/', false, false);
        if (expect_multiline_comment) { return true; }
        let expect_singleline_comment = reader.expect_string('//', '\n', false, false);
        if (expect_singleline_comment) { return true; }
        return false;
    }
    expect_backtick_str() {
        let reader = this.input;
        reader.save();

        let start_tick = reader.expect_pattern(['`'], { skip_ws: true });
        if (!start_tick) { return reader.restore_return(false); }
        
        let is_escape = false;
        while (!reader.is_empty()) {
            if (!is_escape) {
                let nesting = this.expect_nested('${', '}');
                if (nesting) { continue; }
            }

            let ch = reader.at();
            reader.next();
            
            if (is_escape) { is_escape = false; }
            else if (ch == '\\') { is_escape = true; }
            else if (ch == '`') {
                return reader.pop_return(true);
            }
        }
        return reader.restore_return(false);
    }
    expect_regex() {
        let reader = this.input;
        reader.save();

        // Don't match slashes which act as operators - e.g. 5 / 2
        for (let j = reader.index-1; j >= 0; j--) {
            let lookbehind_ch = reader.get_char(j);
            if (is_whitespace(lookbehind_ch)) { continue; }
            if (
                identifier_chars.test(lookbehind_ch) ||
                /^(:?[")\]])/.test(lookbehind_ch)
            ) {
                return reader.restore_return(false);
            }
            break;
        }
        
        let start_slash = reader.expect_pattern(['/'], { skip_ws: true });
        if (!start_slash) { return reader.restore_return(false); }

        let is_escape = false;
        let end_slash_found = false;
        let is_regex_empty = true;
        while (!reader.is_empty()) {
            if (!is_escape) {
                let expect_charset = reader.expect_string('[', ']', true);
                if (expect_charset) { is_regex_empty = false; continue; }
            }

            let ch = reader.at();
            reader.next();
            
            if (is_escape) { is_escape = false; }
            else if (ch == '\\') { is_escape = true; }
            else if ((ch == '/') && (!is_regex_empty)) { end_slash_found = true; break; }
            is_regex_empty = false;
        }
        if (end_slash_found) {
            reader.expect_until_criterion((ch) => { return /[^a-zA-Z]/.test(ch); });
            return reader.pop_return(true);
        }
        return reader.restore_return(false);
    }
    expect_destructuring_assign() {
        let reader = this.input;
        reader.save();

        let start = reader.expect_pattern(['let'], { skip_ws: true });
        if (!start) {
            start = reader.expect_pattern(['var'], { skip_ws: true });
        }
        if (!start) {
            start = reader.expect_pattern(['const'], { skip_ws: true });
        }

        reader.skip_ws();
        let nested = this.expect_nested('[', ']');
        if (!nested) {
            nested = this.expect_nested('{', '}');
        }
        if (!nested) { return reader.restore_return(false); }

        let equals = reader.expect_pattern(['='], { skip_ws: true });
        if (!equals) {
            return reader.restore_return(false);
        }
        return reader.pop_return(true);
    }
    // I have no other words. This is beyond weird. The following statement is legal JS:
    // for (const asdf of[1,2,3,4,5]) {}
    expect_weird_minified_for_of_loop() {
        let reader = this.input;
        reader.save();

        let start = reader.expect_pattern(['for', '('], { skip_ws: true });
        if (!start) { return reader.restore_return(false); }

        let declaration = reader.expect_pattern(['let'], { skip_ws: true });
        if (!declaration) {
            declaration = reader.expect_pattern(['const'], { skip_ws: true });
        }
        if (!declaration) {
            declaration = reader.expect_pattern(['var'], { skip_ws: true });
        }

        let identifier = this.expect_identifier();
        if (typeof identifier == 'undefined') { return reader.restore_return(false); }

        let of_statement = reader.expect_pattern(['of'], { skip_ws: true });
        if (!of_statement) { return reader.restore_return(false); }

        let array = this.expect_nested('[', ']');
        if (!array) { return reader.restore_return(false); }
        return reader.pop_return(true);
    }
}

(function() {
    let rewriter_1 = new JSRewriter(
        '`This is a backtick string. ${"asdf" + `nesting!${5+5}`}`/as[/\\]]d\\/f/'
    );
    assert(rewriter_1.expect_backtick_str());
    assert(rewriter_1.expect_regex());

    let rewriter_2 = new JSRewriter(
        'function asdf(input, closure=function(a, b, c) { return a + b + c }) {' +
        '/* this is an escape */' +
        '}'
    );
    assert(rewriter_2.expect_function_decl());
    assert(rewriter_2.expect_escape());
    
    let rewriter_3 = new JSRewriter('asdf.firstProp.secondProp[compute_indirect()[5]].fourthProp');
    assert(rewriter_3.expect_identifier().data() == "asdf");
    assert(rewriter_3.expect_dot_access().data() == ".firstProp");
    assert(rewriter_3.expect_dot_access().data() == ".secondProp");
    assert(rewriter_3.expect_indirect_access().data() == "[compute_indirect()[5]]");
    assert(rewriter_3.expect_dot_access().data() == ".fourthProp");

    let rewriter_4 = new JSRewriter('for (const asdf of[1,2,3,4,5]) {}');
    assert(rewriter_4.expect_weird_minified_for_of_loop() == true);

    let rewriter_5 = new JSRewriter('let [a, b, ...rest]=');
    assert(rewriter_5.expect_destructuring_assign() == true);
})();

(function() {
    let rewriter_1 = new JSRewriter('do_some_stuff();window.location("bruh").href = "https://www.google.com"');
    assert(
        rewriter_1.rewrite()
        ==
        'do_some_stuff();window.sanitized_access(window,"location",["bruh"]).href = "https://www.google.com"'
    );

    let rewriter_2 = new JSRewriter('++window.location.href');
    assert(rewriter_2.rewrite() == '++window.location.href');

    let rewriter_3 = new JSRewriter('new asdf[bsdf](csdf)');
    assert(rewriter_3.rewrite() == 'new asdf[bsdf](csdf)');
})();

(function() {
    return;
    let data3 = readFileSync('github.js', { encoding: 'utf8' });
    let rewriter3 = new JSRewriter(data3);
    console.log(rewriter3.rewrite());
    return;
    //N=C.currency,S=C.decimal,ba=C.numerals?I0(C.numerals):J0,ea=C.percent||"%";return{format:z,formatPrefix:function(ia,Fa){var Ca=z((ia=wO(ia),ia.type="f",ia));ia=3*Math.max(-8,Math.min(8,Math.floor(jia(Fa)/3)));var Ga=Math.pow(10,-ia),Ka=K0[8+ia/3];return function($a){return Ca(Ga*$a)+Ka}}}}	
    //N=C.currency,S=C.decimal,ba=C.numerals?I0(C.numerals):J0,ea=C.percent||"%";return{format:z,formatPrefix:function(ia,Fa){var Ca=z((ia=wO(ia),ia.type="f",ia));ia=3*Math.max(-8,Math.min(8,Math.floor(jia(Fa)/3)));var Ga=Math.pow(10,-ia),Ka=window.sanitized_access(K0,8+ia/3];return function($a){return Ca(Ga*$a)+Ka}}}}
    return;
    let data2 = readFileSync('youtube.js', { encoding: 'utf8' });
    let rewriter2 = new JSRewriter(data2);
    console.log(rewriter2.rewrite());

    return;
    let data = readFileSync('moomoo.js', { encoding: 'utf8' });
    let rewriter = new JSRewriter(data);
    console.log(rewriter.rewrite());
})();
