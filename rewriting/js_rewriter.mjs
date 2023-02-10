//MathJax-span-5
// NOTE - webfont does appear to be loading properly. However, there's a callback that is NOT firing????
// Or maybe somethign to do with timer or Callback

import { readFileSync, writeFileSync } from 'fs';

import { TextStream, is_whitespace } from './utility.mjs';
import assert from 'assert';

const SUS_ATTRIBUTES = ['href', 'location', 'hostname', 'host', 'pathname', 'protocol', 'reload', 'replace', 'pushState', 'replaceState'];
const SANITIZE_STR = 'window.sanitized_access(';

const reserved_keywords = ["break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null", "return", "super", "switch", "throw", "true", "try", "typeof", "var", "void", "while", "with", "let", "static", "yield"];
const identifier_start_chars = /^(?:[a-zA-Z_$])/;
const identifier_chars = /^(?:[a-zA-Z0-9_$])/;
const ASSIGNMENT_OPERATORS = ['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '^=', '|=', '&&=', '||=', '??=', '++', '--'];
// list of prefixes that can't start an access **chain**
const BANNED_PREFIXES = ['++', '--', 'new', 'delete', '.', ']'];
const INTEGER_REGEX = /^(?:\d|\s)+$/;

export class JSRewriter {
    constructor(input) {
        this.input = new TextStream(input);
        this.rewrites = [];
        this.is_rewritten = false;
    }
    rewrite() {
        this.parse(undefined, undefined);

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
    parse(constrain_start, constrain_end) {        
        let reader = this.input;
        reader.save();
        if (typeof constrain_start != 'undefined') { reader.seek(constrain_start); }
        let end_index = reader.length();
        if (typeof constrain_end != 'undefined') { end_index = constrain_end; }

        let parens = {
            level: 0,
            marks: [reader.mark()],
            is_empty: [true],
        };
        while ((!reader.is_empty()) && (reader.mark() < end_index)) {
            let start_mark = reader.mark();
            let ch = reader.at();
            let nontrivial_item_found = true;
            
            if (this.expect_trivial_escape() || is_whitespace(ch)) {
                nontrivial_item_found = false;
            }
            else if (this.expect_value_escape()) {}
            else if (ch == '(') {
                parens.level += 1;
                if (parens.marks.length <= parens.level) {
                    parens.marks.push(reader.mark());
                    parens.is_empty.push(true);
                }
                else {
                    parens.marks[parens.level] = reader.mark();
                    parens.is_empty[parens.level] = true;
                }
                // Parens aren't, by themselves, nontrivial
                // (((()))) is still trivial
                nontrivial_item_found = false;
            }
            else if ((ch == ')') && (parens.level > 0)) {
                let paren_open_mark = parens.marks[parens.level];
                parens.level -= 1;
            }
            else {
                this.process_access_unit(parens);
            }

            if (nontrivial_item_found) {
                parens.is_empty[parens.level] = false;
            }
            if (reader.mark() == start_mark) { reader.next(); }
        }
        reader.restore();
    }
    process_access_unit(parens) {
        let reader = this.input;
        
        let prefix_start = reader.mark();
        let base = this.expect_identifier();
        if (base == undefined) { return; }

        while (true) {
            let chained_calls = this.expect_nested('(', ')');
            if (typeof chained_calls == 'undefined') { break; }
            this.parse(chained_calls.from, chained_calls.to);
        }
        
        let is_prefix_valid = this.check_prefix(prefix_start);
        this.process_access_chain(
            base.from, base.data(), is_prefix_valid, parens
        );
    }
    process_access_chain(base_start, base_name, handle_rewrites, parens) {
        // List of indices to re-write even if this chain isn't suspicious
        let rewrites = [];
        let is_sus = false;
        if (typeof base_name != 'undefined') {
            is_sus = this.is_sus(base_name);
        }
        while (true) {
            let processed = this.process_access(parens);
            if (typeof processed == 'undefined') { break; }
            is_sus = is_sus || processed.is_sus;
            rewrites.push(processed);
        }

        if (rewrites.length == 0) { return false; }
        if (!is_sus) {
            for (const rewrite of rewrites) {
                for (const fallback_rewrite of rewrite.fallback_rewrites) {
                    this.parse(fallback_rewrite.from, fallback_rewrite.to);
                }
            }
            return false;
        }

        if (!handle_rewrites) { return true; }
        
        this.insert_mark(SANITIZE_STR.repeat(rewrites.length), base_start, base_start);
        for (const rewrite of rewrites) {
            this.insert_mark(rewrite.rewrite, rewrite.start, rewrite.end);
        }
        return true;
    }
    /// Looks for a property access (either direct or computed)
    process_access(parens) {
        let reader = this.input;
        reader.save();
        let rewrite_start = reader.mark();

        let is_sus = false;
        let fallback_rewrites = [];
        let accessed_field = '';
        
        let access = this.expect_dot_access();
        if (typeof access != 'undefined') {
            accessed_field = '"' + access.data().trim().substring(1) + '"';
            is_sus = this.is_sus(accessed_field);
        }
        else {
            access = this.expect_indirect_access();
            if (typeof access == 'undefined') {
                return reader.restore_return(undefined);
            }
            fallback_rewrites.push(access.clone());
            accessed_field = access.data();
            accessed_field = (new JSRewriter(accessed_field)).rewrite();
            is_sus = !INTEGER_REGEX.test(accessed_field);
        }

        let empty_parens = this.skip_empty_parens(parens);

        let function_call_slice = this.expect_nested('(', ')');
        let function_call = 'undefined';
        if (typeof function_call_slice != 'undefined') {
            fallback_rewrites.push(function_call_slice.clone());
            function_call = function_call_slice.data();
            function_call = (new JSRewriter(function_call)).rewrite();
            function_call =  "[" + function_call + "]";
        }

        let rewrite_end = reader.mark();
        
        while (typeof this.expect_nested('(', ')') != 'undefined') {}
        let chained_calls_end = reader.mark();
        if (chained_calls_end != rewrite_end) {
            this.parse(rewrite_end, chained_calls_end);
        }

        for (let j = 0; j < ASSIGNMENT_OPERATORS.length; j++) {
            let expected = reader.expect_pattern([ASSIGNMENT_OPERATORS[j]], { skip_ws: true });
            if (expected) { return reader.restore_return(undefined); }
        }

        let rewrite = ',' + 
            accessed_field + ',' + 
            function_call + ')' + empty_parens;
        return reader.pop_return({
            is_sus: is_sus,
            rewrite: rewrite,
            start: rewrite_start, 
            end: rewrite_end,
            fallback_rewrites: fallback_rewrites
        });
    }
    /// Skips empty close parens - e.g. for the expression (((abc[d]))), the last 3 close parens
    /// can be skipped. Returns an object with 2 fields:
    ///     * val: a string of the parens skipped
    ///     * is_poisoned: whether any of these parenthesis has an invalid paren group prefix.
    ///       This is needed because if we have String(abc[d]), we can just *not* skip the last paren
    ///       and re-write the inner - no problems here. However, if we have something like 
    ///       (abc[d])(), we ***cannot*** re-write the inside, because that would break the `this`
    skip_empty_parens(parens) {
        let reader = this.input;
        reader.save();

        let paren_count = 0;
        while ((parens.level > 0) && parens.is_empty[parens.level]) {
            if (!this.check_prefix(parens.marks[parens.level])) {
                break;
            }
            let paren_expect = reader.expect_pattern([')'], { skip_ws: true });
            if (!paren_expect) { break; }
            parens.level -= 1;
            paren_count += 1;
        }
        return reader.pop_return(')'.repeat(paren_count));
    }
    /// Checks to make sure the prefix of `reader` is not an increment/decrement operator
    /// This is because ++window.sanitize_value(...) is illegal
    /// Returns `true` if the prefix is OK, otherwise `false`
    check_prefix(mark) {
        let reader = this.input;
        for (const prefix of BANNED_PREFIXES) {
            let look_index = prefix.length-1;
            for (let j = mark-1; j >= 0; j--) {
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
    expect_indirect_access() {
        let reader = this.input;
        reader.save();

        let access = this.expect_nested('[', ']');
        if (typeof access == 'undefined') {
            return reader.restore_return(undefined);
        }
        return reader.pop_return(access);
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

        let name = reader.expect_until_criterion((ch) => { return !identifier_chars.test(ch); });

        if (name == undefined) { return reader.restore_return(undefined); }
        if (name.to == name.from) { return reader.restore_return(undefined); }
        // We shouldn't have to call .trim() here because identifier_chars doesn't include
        // any whitespace, so the result of expect_until_criterion shouldn't return anything with
        // whitespace, either
        let name_str = name.data();
        if (!identifier_start_chars.test(name_str[0])) { return reader.restore_return(undefined); }
        if (reserved_keywords.includes(name_str)) { return reader.restore_return(undefined); }

        return reader.pop_return(name);
    }
    expect_closure_decl() {
        let reader = this.input;
        reader.save();
        reader.skip_ws();
        
        let args = typeof this.expect_nested('(', ')') != 'undefined';
        if (!args) {
            let arg = this.expect_identifier();
            args = typeof arg != 'undefined';
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
        if (!expect_start) { return reader.restore_return(undefined); }
        let start_index = reader.mark();
        
        let nesting_level = 1;
        let end_index = reader.mark();
        while ((nesting_level > 0) && (!reader.is_empty())) {
            let escape = this.expect_trivial_escape() || this.expect_value_escape();
            if (escape) { continue; }

            let mark = reader.mark();
            if (reader.expect_pattern([start], { skip_ws: true })) {
                nesting_level += 1;
            }
            else if (reader.expect_pattern([end], { skip_ws: true })) {
                nesting_level -= 1;
                end_index = mark;
            }
            else { reader.next(); }
        }
        if (nesting_level == 0) {
            return reader.pop_return(reader.slice(start_index, end_index));
        }
        return reader.restore_return(undefined);
    }
    expect_trivial_escape() {
        let reader = this.input;
        let ch = reader.at();
        
        if (ch === '/') {
            let expect_multiline_comment = reader.expect_string('/*', '*/', false, false);
            if (expect_multiline_comment) { return true; }
            let expect_singleline_comment = reader.expect_string('//', '\n', false, false);
            if (expect_singleline_comment) { return true; }
        }
        return false;
    }
    expect_value_escape() {
        let reader = this.input;
        let ch = reader.at();
        
        if (
            (ch === '`') ||
            (ch === '"') ||
            (ch === "'") ||
            (ch === '/')
        ) {
            if (this.expect_regex()) { return true; }
            if (this.expect_backtick_str()) { return true; }
            let expect_single_quote = reader.expect_string("'", "'", true, false);
            if (expect_single_quote) { return true; }
            let expect_double_quote = reader.expect_string('"', '"', true, false);
            if (expect_double_quote) { return true; }
        }
        
        //if (this.expect_destructuring_assign()) { return true; }
        //if (this.expect_for_of_loop()) { return true; }
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
                if (typeof this.expect_nested('${', '}') != 'undefined') { continue; }
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
        let nested = typeof this.expect_nested('[', ']') != 'undefined';
        if (!nested) {
            nested = typeof this.expect_nested('{', '}') != 'undefined';
        }
        if (!nested) { return reader.restore_return(false); }

        let equals = reader.expect_pattern(['='], { skip_ws: true });
        if (!equals) {
            return reader.restore_return(false);
        }
        return reader.pop_return(true);
    }
    expect_for_of_loop() {
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
        if (typeof array == 'undefined') { return reader.restore_return(false); }
        return reader.pop_return(true);
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

    /// Returns whether a mark `a` should go before a mark `b`
    /// In the event of a tie, bias towards the first one being first (i.e. return true)
    mark_is_before_other(a, b) {
        if (a.from == b.from) {
            return a.to <= b.to;
        }
        return a.from < b.from;
    }
    insert_mark(text, from, to) {
        let mark = {
            text: text,
            from: from,
            to: to
        };
        if (this.rewrites.length == 0) {
            this.rewrites.push(mark);
            return;
        }
        if (this.mark_is_before_other(this.rewrites[this.rewrites.length-1], mark)) {
            this.rewrites.push(mark);
            return;
        }
        let splice_after = this.rewrites.length-1;
        while (splice_after >= 0) {
            if (this.mark_is_before_other(this.rewrites[splice_after], mark)) {
                break;
            }
            splice_after -= 1;
        }
        this.rewrites.splice(splice_after+1, 0, mark);
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
    assert(rewriter_2.expect_trivial_escape());
    
    let rewriter_3 = new JSRewriter('asdf.firstProp.secondProp[compute_indirect()[5]].fourthProp');
    assert(rewriter_3.expect_identifier().data() == "asdf");
    assert(rewriter_3.expect_dot_access().data() == ".firstProp");
    assert(rewriter_3.expect_dot_access().data() == ".secondProp");
    assert(rewriter_3.expect_indirect_access().data() == "compute_indirect()[5]");
    assert(rewriter_3.expect_dot_access().data() == ".fourthProp");

    let rewriter_4 = new JSRewriter('for (const asdf of[1,2,3,4,5]) {}');
    assert(rewriter_4.expect_for_of_loop() == true);

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
    let data = readFileSync('validationSamples/googlesyndication.js', { encoding: 'utf8' });
    let rewriter = new JSRewriter(data);
    console.log(rewriter.rewrite());
    /*
    for (let j = 0; j < 3; j++) {
        let start = Date.now();
        let rewriter = new JSRewriter(data);
        rewriter.rewrite();
        let end = Date.now();
        console.log(end - start);
    }
    */
})();