import { readFileSync } from 'fs';

import assert from 'assert';
import { TextStream, is_whitespace } from './utility.mjs';
import * as urls from '../hooks/urls.mjs';
import { get_hook } from '../hooks/build.mjs';

import * as js_rewriter from './js_rewriter.mjs';
import * as css_rewriter from './css_rewriter.mjs';

const TAG_NAME_CHARACTERS = 'abcdefghijklmnopqrstuvwxyz0123456789-_!';
const BANNED_ATTR_WORD_VALUE_CHARS = '"\'=<>`';
const BANNED_ATTR_NAME_CHARS = '/<>"\'=';
const RAW_TAGS = ['script', 'style'];

const PROXY_ATTRIBS = [['href', undefined], ['src', undefined], ['action', 'form']];
const REMOVE_ATTRIBS = ['integrity', 'nonce'];

function is_tag_name_end(input) {
    return input == '>' || is_whitespace(input);
}
function is_invalid_attrib_name_char(input) {
    return BANNED_ATTR_NAME_CHARS.includes(input) || is_whitespace(input);
}
function is_invalid_attrib_wordvalue_char(input) {
    return BANNED_ATTR_WORD_VALUE_CHARS.includes(input) || is_whitespace(input);
}

export class HTMLRewriter {
    constructor(input) {
        this.input = new TextStream(input);
        this.original = input;
        this.rewrites = [];
        this.hook_inserted = false;
        this.doctype_end = 0;
    }

    rewrite() {
        this.parse();
        if (!this.hook_inserted) {
            this.insert_mark(
                '<head>' + get_hook() + '</head>', 
                this.doctype_end, 
                this.doctype_end
            );
            this.hook_inserted = true;
        }
        
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
    handle_tag_attrib(tag_name, attrib_name, attrib_value) {
        if (typeof attrib_value == 'undefined') { return; }
        let name = tag_name.data().toLowerCase();
        let attrib = attrib_name.data().toLowerCase();
        let value = attrib_value.data();

        if (REMOVE_ATTRIBS.includes(attrib)) {
            this.insert_mark('', attrib_name.from, attrib_name.to);
        }
        for (const proxy_attrib of PROXY_ATTRIBS) {
            if (proxy_attrib[0] != attrib) { continue; }
            if (typeof proxy_attrib[1] != 'undefined') {
                if (name != proxy_attrib[1]) { continue; }
            }
            let quote = '';
            if ((value[0] == '"') && (value.slice(-1) == '"')) { quote = '"'; }
            if ((value[0] == "'") && (value.slice(-1) == "'")) { quote = "'"; }
            let extracted_url = value.substring(quote.length, value.length - quote.length);
            this.insert_mark(
                quote + urls.encode_url(extracted_url) + quote,
                attrib_value.from,
                attrib_value.to
            );
        }
    }

    parse() {
        let force_tagname = undefined;
        while (!this.input.is_empty()) {
            if (this.expect_comment()) { continue; }
            if (this.expect_cdata()) { continue; }
            if (typeof force_tagname == 'undefined') {
                let tag_open = this.expect_tag_open();
                if (typeof tag_open != 'undefined') {
                    let tag_name = tag_open.data().toLowerCase();
                    if (RAW_TAGS.includes(tag_name)) {
                        force_tagname = [tag_name, this.input.mark()];
                    }
                    if (tag_name == 'head') {
                        this.insert_mark(get_hook(), this.input.mark(), this.input.mark());
                        this.hook_inserted = true;
                    }
                    if (tag_name == '!doctype') {
                        this.doctype_end = this.input.mark();
                    }
                    continue;
                }
            }
            else {
                let force_tagcontent_end = this.input.mark();
                if (this.expect_tag_close(force_tagname[0])) {
                    let force_tagcontent = this.input.slice(force_tagname[1], force_tagcontent_end).data();
                    if (force_tagname[0] == 'script') {
                        force_tagcontent = (new js_rewriter.JSRewriter(force_tagcontent)).rewrite();
                    }
                    // TODO: implement CSS rewriting
                    this.insert_mark(force_tagcontent, force_tagname[1], force_tagcontent_end);
                    force_tagname = undefined;
                    continue;
                }
            }
            this.input.next();
        }
    }
    
    expect_comment() {
        this.input.save();
        let comment_start = this.input.expect_pattern(['<!--'], { skip_ws: true });
        if (!comment_start) {
            return this.input.restore_return(false);
        }
        while (!this.input.expect_pattern(['-->'])) {
            this.input.next();
            if (this.input.is_empty()) {
                this.input.restore_return(false);
            }
        }
        return this.input.pop_return(true);
    }
    is_tag_name_invalid(input) {
        if ((typeof input == 'undefined') || (input.length <= 0)) { return true; }
        for (let j = 0; j < input.length; j++) {
            if (!TAG_NAME_CHARACTERS.includes(input[j].toLowerCase())) {
                return true;
            }
        }
        return false;
    }
    /// Expects a tag open, and automatically creates rewrite indices
    /// for any attributes that need to be rerouted. Returns the tag name
    expect_tag_open() {
        let reader = this.input;
        reader.save();
        let tag_open = reader.expect_pattern(['<'], { skip_ws: true });
        if (!tag_open) {
            return reader.restore_return(undefined);
        }
        let tag_name = reader.expect_until_criterion(is_tag_name_end);
        if (this.is_tag_name_invalid(tag_name.data())) {
            return reader.restore_return(undefined);
        }
        while (reader.has_next()) {
            let end_pattern = reader.expect_pattern(['/>'], { skip_ws: true });
            if (!end_pattern) { end_pattern = reader.expect_pattern(['>'], { skip_ws: true }); }
            if (end_pattern) { return reader.pop_return(tag_name); }

            reader.skip_ws();
            let attrib_name = reader.expect_until_criterion(is_invalid_attrib_name_char);
            // Dirty hack to fix some malformed HTML where a quote in an attribute
            // isn't escaped correctly *cough archive.org*
            if ((!attrib_name) || (attrib_name.from == attrib_name.to)) {
                reader.next();
                continue;
            }

            let attrib_value = undefined;
            // If key-value pair
            if (reader.expect_pattern(['='], { skip_ws: true })) {
                attrib_value = reader.expect_string('"', '"', false, true);
                if (typeof attrib_value == 'undefined') {
                    attrib_value = reader.expect_string('\'', '\'', false, true);
                }
                if (typeof attrib_value == 'undefined') {
                    attrib_value = reader.expect_until_criterion(is_invalid_attrib_wordvalue_char);
                }
                if (!attrib_value) {
                    return reader.restore_return(undefined);
                }
            }
            this.handle_tag_attrib(tag_name, attrib_name, attrib_value);
        }
        return reader.pop_return(tag_name);
    }
    expect_cdata() {
        let reader = this.input;
        let cdata_open = reader.expect_pattern(['<![CDATA['], { skip_ws: true });
        if (!cdata_open) { return false; }
        let text = reader.expect_until_pattern([']]>'], { skip_ws: true });
        return true;
    }
    expect_tag_close(force_tagname) {
        let reader = this.input;
        let tagclose_begin = reader.expect_pattern(['</'], { skip_ws: true });
        if (!tagclose_begin) { return false; }
        if (typeof force_tagname != 'undefined') {
            reader.expect_pattern([force_tagname], { ignore_case: true });
        }
        else {
            reader.expect_until_criterion(is_tag_name_end);
        }
        let tagclose_end = reader.expect_pattern(['>'], { skip_ws: true });
        return tagclose_end;
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
    let rewriter = new HTMLRewriter(`
         <!--this is a very long comment, and should probably???? work-->
         <script src="thisisadummylink" async>
           <button onclick=bruhhhh hidden>
           <input type="number" id="asdf" name="asdf" min=10 max=100>
        <![CDATA[x<y]]>
         </endtag>
           </script>
         <script>
           <adsf>
         </script>
       `);
    assert(rewriter.expect_comment());
    assert(rewriter.expect_tag_open().data() == 'script');
    assert(rewriter.expect_tag_open().data() == 'button');
    assert(rewriter.expect_tag_open().data() == 'input');
    assert(rewriter.expect_cdata());
    assert(rewriter.expect_tag_close());
    assert(rewriter.expect_tag_close('SCRIPT'));
    assert(rewriter.expect_tag_open().data() == 'script');
    assert(rewriter.expect_tag_open().data() == 'adsf');
    assert(rewriter.expect_tag_close('script'));
})();
(function() {
    return;
    let data = readFileSync('validationSamples/archiveorg.html', { encoding: 'utf8' });
    let rewriter = new HTMLRewriter(data);
    console.log(rewriter.rewrite());
})();