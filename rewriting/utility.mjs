import assert from 'assert';

export function string_eq_nocase(a, b) {
    return a.toLowerCase().trim() == b.toLowerCase().trim();
}
export function is_whitespace(input) {
    if (typeof input == 'undefined') {
        return false;
    }
    return input.trim() == '';
}
export function is_newline(input) {
    if (typeof input == 'undefined') {
        return false;
    }
    return (input == '\n') || (input == '\r') || (input == '\u2028') || (input == '\u2029');
}

export class Slice {
    constructor(from, to, stream) {
        this.from = from;
        this.to = to;
        this.stream = stream;
    }
    data() {
        return this.stream.substring(this.from, this.to);
    }
    clone() {
        return new Slice(this.from, this.to, this.stream);
    }
}
export class TextStream {
    constructor(input) {
        this.input = input;
        this.index = 0;
        this.save_queue = [];
    }

    remainder() {
        return this.input.substring(this.index);
    }
    context() {
        return this.input.substring(Math.max(0, this.index), Math.min(this.input.length, this.index + 100));
    }
    length() { return this.input.length; }
    substring(start, end) { return this.input.substring(start, end); }
    get_char(indx) { return this.input[indx]; }
    at() { return this.get_char(this.index); }
    
    save() { this.save_queue.push(this.index); return this.index; }
    restore() { this.index = this.save_queue.pop(); }
    pop_save() { this.save_queue.pop(); }
    restore_return(val) {
        this.restore();
        return val;
    }
    pop_return(val) {
        this.pop_save();
        return val;
    }
    mark() { return this.index; }
    seek(index) { this.index = index; }
    slice(from, to) { return new Slice(from, to, this); }
    
    is_empty() { return this.index >= this.input.length; }
    has_next() { return this.index + 1 < this.input.length; }
    next() {
        this.index += 1;
        return !this.is_empty();
    }

    /// Checks if the input buffer starting at this.index starts with a given string, with the option of
    /// ignoring case
    starts_with(to_match, ignore_case=false) {
        let actual_match = ignore_case ? to_match.toLowerCase() : to_match;
        for (let j = 0; j < actual_match.length; j++) {
            let ch = this.get_char(this.index + j);
            if (ignore_case && (typeof ch != 'undefined')) {
                ch = ch.toLowerCase();
            }
            if (ch != actual_match[j]) {
                return false;
            }
        }
        return true;
    }
    /// Advances along the stream until either the end is reached, or stop(ch) returns true, for the 
    /// current char ch
    expect_until_criterion(stop) {
        let start = this.mark();
        while (!this.is_empty()) {
            if (stop(this.at())) {
                return this.slice(start, this.mark());
            }
            this.next();
        }
        return this.slice(start, this.mark());
    }
    skip_ws() {
        return this.expect_until_criterion((ch) => { return !is_whitespace(ch); });
    }
    /// Expects a sequence of strings, with the following options:
    ///     * ignore_case: ignores case when matching
    ///     * skip_ws: skips whitespace before and between patterns
    expect_pattern(input, options={}) {
        this.save();
        for (let j = 0; j < input.length; j++) {
            if (!!options.skip_ws) { this.skip_ws(); }
            if (!this.starts_with(input[j], !!options.ignore_case)) {
                return this.restore_return(false);
            }
            for (let k = 0; k < input[j].length; k++) { this.next(); }
        }
        return this.pop_return(true);
    }
    /// Reads until the next space, with the option to skip whitespace
    expect_word(skip_ws=false) {
        if (skip_ws) { this.skip_ws(); }
        return this.expect_until_criterion(is_whitespace);
    }
    expect_until_pattern(delims, options={}) {
        let start = this.mark();
        while (!this.is_empty()) {
            let end = this.mark();
            if (this.expect_pattern(delims, options)) {
                return this.slice(start, end);
            }
            this.next();
        }
        return undefined;
    }
    /// Expects a string, defined as a delimiter (start), some data, and then another delimiter (end).
    /// Has the option to allow escaping, with only the backslash character being supported.
    /// Has the option to skip leading whitespace
    expect_string(start_token, end_token, can_escape=true, skip_leading_whitespace=false) {
        this.save();
        let start = this.mark();
        if (!this.expect_pattern([start_token], { skip_ws: skip_leading_whitespace })) {
            return this.restore_return(undefined);
        }

        let is_escaped = false;
        while (!this.is_empty()) {
            if (is_escaped) {
                is_escaped = false;
                this.next();
                continue;
            }
            if (this.expect_pattern([end_token], {})) {
                return this.pop_return(this.slice(start, this.mark()));
            }
            if (can_escape && (this.at() == '\\')) {
                is_escaped = true;
            }
            this.next();
        }
        return this.restore_return(undefined);
    }
}

/*
***************
* BEGIN TESTS *
***************
*/
(function() {
    let text_stream_a = new TextStream('    <div>');
    text_stream_a.save();
    assert(text_stream_a.remainder() == '    <div>');
    text_stream_a.skip_ws();
    assert(text_stream_a.remainder() == '<div>');
    text_stream_a.next();
    assert(text_stream_a.remainder() == 'div>');
    let mark1 = text_stream_a.mark();
    text_stream_a.next();
    text_stream_a.seek(mark1);
    assert(text_stream_a.remainder() == 'div>');
    text_stream_a.restore();
    assert(text_stream_a.remainder() == '    <div>');

    let text_stream_b = new TextStream(' ');
    text_stream_b.skip_ws();
    assert(text_stream_b.remainder() == '');
})();
(function() {
    let text_stream_a = new TextStream(' < !--');
    text_stream_a.expect_pattern(['<', '!', '-', '-'], { skip_ws: true });
    assert(text_stream_a.remainder().length == 0);
    let text_stream_b = new TextStream(' < div   >');
    text_stream_b.expect_pattern(['<', '!', '-', '-'], { skip_ws: true });
    assert(text_stream_b.remainder() == ' < div   >');
    text_stream_b.expect_pattern('<div>', { skip_ws: true });
    assert(text_stream_b.remainder().length == 0);
})();
(function() {
    let text_stream_a = new TextStream('"asd\'fggg"');
    assert(text_stream_a.expect_string('"', '"').data() == '"asd\'fggg"');
    let text_stream_b = new TextStream('"asdf\\"fffff"');
    assert(text_stream_b.expect_string('"', '"').data() == '"asdf\\"fffff"');
    let text_stream_c = new TextStream('[\\\\.*+^$?{}|()[\\]]aaaaaaaaa');
    assert(text_stream_c.expect_string('[', ']', true).data() == '[\\\\.*+^$?{}|()[\\]]');
})();
(function() {
    let text_stream = new TextStream('thisshouldntrunyetASDFoknowthisshouldalsoworkasdfokweshouldkeepgoingasdf stop');
    assert(
        text_stream.expect_until_pattern(['ASDF'], { ignore_case: false }).data()
            == 
        'thisshouldntrunyet'
    );
    assert(
        text_stream.expect_until_pattern(['ASDF', 'STOP'], { ignore_case: true, skip_ws: true }).data()
            == 
        'oknowthisshouldalsoworkasdfokweshouldkeepgoing'
    );
})();