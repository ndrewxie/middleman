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
    handle_tag_attrib(tag_name, attrib_name, attrib_value) {
        if (typeof attrib_value == 'undefined') { return; }
        let name = tag_name.data().toLowerCase();
        let attrib = attrib_name.data().toLowerCase();
        let value = attrib_value.data();

        if (REMOVE_ATTRIBS.includes(attrib)) {
            this.rewrites.push({
                from: attrib_name.from,
                to: attrib_value.to,
                text: ''
            });
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
            this.rewrites.push({
                from: attrib_value.from,
                to: attrib_value.to,
                text: quote + urls.encode_url(extracted_url) + quote
            });
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
                        this.rewrites.push({
                            from: this.input.mark(),
                            to: this.input.mark(),
                            text: get_hook()
                        });
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
                    this.rewrites.push({
                        from: force_tagname[1],
                        to: force_tagcontent_end,
                        text: force_tagcontent
                    });
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
            if (!attrib_name) { return reader.restore_return(undefined); }

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
    let rewriter = new HTMLRewriter(`<div class="ff-sans ps-fixed z-nav-fixed ws4 sm:w-auto p32 sm:p16 bg-black-750 fc-white bar-lg b16 l16 r16 js-consent-banner">
                    <svg aria-hidden="true" class="mln4 mb24 sm:d-none svg-spot spotCookieLg" style="color: var(--theme-button-filled-background-color)" width="96" height="96" viewBox="0 0 96 96">
                        <path d="M35 45.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0zM63.5 63a7.5 7.5 0 100-15 7.5 7.5 0 000 15zm-19 19a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" opacity=".2"></path>
                        <path d="M56.99 2.53a23.1 23.1 0 0114.66 6.15h.01l.01.02c.57.55.61 1.27.5 1.74v.07a10.95 10.95 0 01-3.07 4.77 9 9 0 01-6.9 2.5 10.34 10.34 0 01-9.72-10.44v-.08a10 10 0 011.03-3.74l.01-.03.02-.02c.28-.5.82-.92 1.52-.95.63-.02 1.27-.02 1.93.01zm12.04 7.83a20.1 20.1 0 00-12.2-4.83l-.92-.03c-.23.6-.38 1.25-.43 1.94a7.34 7.34 0 006.95 7.34 6 6 0 004.64-1.7c.94-.88 1.6-1.9 1.96-2.72zm15.3 8.76a6.84 6.84 0 00-5.09-.24 7.9 7.9 0 00-3.28 2.05 1.8 1.8 0 00-.3 1.95l.02.02v.02a15.16 15.16 0 008.74 7.47c.64.23 1.32.08 1.8-.33a6.63 6.63 0 001.63-1.97l.01-.03.01-.03c1.67-3.5-.12-7.32-3.54-8.91zm-5.5 3.28c.36-.25.82-.5 1.35-.67.92-.3 1.92-.35 2.89.1 2.14 1 2.92 3.14 2.11 4.88-.12.21-.26.41-.43.6l-.26-.1a12.29 12.29 0 01-5.66-4.81zM32 24a2 2 0 11-4 0 2 2 0 014 0zm12 21a2 2 0 11-4 0 2 2 0 014 0zm36 4a2 2 0 11-4 0 2 2 0 014 0zm-7 21a2 2 0 11-4 0 2 2 0 014 0zM59 81a2 2 0 11-4 0 2 2 0 014 0zM22 63a2 2 0 11-4 0 2 2 0 014 0zm27 7a9 9 0 11-18 0 9 9 0 0118 0zm-3 0a6 6 0 10-12 0 6 6 0 0012 0zM33 41a9 9 0 11-18 0 9 9 0 0118 0zm-15 0a6 6 0 1012 0 6 6 0 00-12 0zm50 11a9 9 0 11-18 0 9 9 0 0118 0zm-3 0a6 6 0 10-12 0 6 6 0 0012 0zM44.08 4.24c.31.48.33 1.09.05 1.58a17.46 17.46 0 00-2.36 8.8c0 9.55 7.58 17.24 16.85 17.24 2.97 0 5.75-.78 8.16-2.15a1.5 1.5 0 012.1.66 12.08 12.08 0 0011 6.74 12.4 12.4 0 007.85-2.75 1.5 1.5 0 012.38.74A45.76 45.76 0 0192 48.16c0 24.77-19.67 44.9-44 44.9S4 72.93 4 48.16C4 25.23 20.84 6.28 42.64 3.58a1.5 1.5 0 011.44.66zM40.22 7C21.32 10.71 7 27.7 7 48.16c0 23.17 18.39 41.9 41 41.9s41-18.73 41-41.9c0-3.52-.42-6.93-1.22-10.2a15.5 15.5 0 01-7.9 2.15c-5.5 0-10.36-2.83-12.97-7.1a19.46 19.46 0 01-8.28 1.85c-11 0-19.86-9.1-19.86-20.24 0-2.7.52-5.26 1.45-7.62zM92 91a2 2 0 100-4 2 2 0 000 4zM7 8.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM82.5 90a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm9.5-7.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM13.5 8a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM80 14.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM53.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"></path>
                    </svg>
                    <p class="fs-body2 fw-bold mb4">
                        Your privacy
                    </p>
                    <p class="mb16 s-anchors s-anchors__inherit s-anchors__underlined">
                        By clicking “Accept all cookies”, you agree Stack Exchange can store cookies on your device and disclose information in accordance with our <a href="https://stackoverflow.com/legal/cookie-policy">Cookie Policy</a>.
                    </p>
                    <div class="d-flex gs8 ai-stretch fd-column sm:fd-row">
                        <button class="flex--item s-btn s-btn__primary js-accept-cookies js-consent-banner-hide">
                            Accept all cookies
                        </button>

                        <button class="flex--item s-btn s-btn__filled js-cookie-settings" data-consent-popup-loader="banner">
                            Customize settings
                        </button>
                    </div>
                </div>`);
    console.log(rewriter.rewrite());
})();
(function(){
    return;
    let rewriter = new HTMLRewriter(`<!DOCTYPE html>
<html>
<head>
  <title>Page Title</title>
  <link rel="stylesheet" href="mystyle.css">
</head>
<body>

<h1>This is a Heading</h1>
<p>This is a paragraph.</p>
  
</body>
</html>
`);
    console.log(rewriter.rewrite());
})();
(function() {
    return;
    console.log("START");
    let data = readFileSync('output.html', { encoding: 'utf8' });
    let rewriter = new HTMLRewriter(data);
    rewriter.rewrite();
    //console.log(rewriter.rewrite());
    console.log("DONE");
})();
(function() {
    return;
    let data = readFileSync('./parser/test2.txt', { encoding: 'utf8' });
    let rewriter = new HTMLRewriter(data);
    console.log(rewriter.rewrite());
    console.log("DONE");
})();